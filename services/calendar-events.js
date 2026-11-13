import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readLines, write, encode} from '../helpers/calendar/io.js';
import {normalizeOccurrences, calendarColor} from './calendar-events-model.js';

export const CALENDAR_MESSAGES = {
    disabled: 'Desktop calendar events are off', loading: 'Loading desktop calendars…',
    'missing-dependencies': 'Install the optional EDS calendar bindings',
    'no-sources': 'No desktop calendars found', 'no-selection': 'Choose calendars in preferences',
    ready: '', partial: 'Some calendar data is unavailable', disconnected: 'Calendar connection unavailable',
    offline: 'Cached calendar events · offline',
    'authentication-required': 'Sign in again in Online Accounts', error: 'Calendar reader unavailable',
};

// Recently shown ranges (current month, neighbours, notch week) kept in Shell
// memory only. EDS remains the persistent store; nothing is written to disk.
export const CALENDAR_CACHE_LIMIT = 6;
// An idle reader holds EDS views open and only wakes on EDS change signals.
export const CALENDAR_IDLE_SECONDS = 120;
// Only snapshots carrying event data are worth showing again before revalidation.
const CACHED_STATUSES = new Set(['ready', 'partial', 'offline']);

// One owned reader per consumer owner. watch() replaces the requested ranges
// and shows the last snapshot for an identical request at once while the
// reader revalidates it. suspend() keeps the reader briefly after the last
// consumer hides; stop() ends it, requests EOF, then kills only this child if
// it ignores shutdown. stop() clears cached snapshots unless asked to keep them.
export class CalendarEventsService {
    constructor(path, emit, {helper = `${path}/helpers/calendar/reader.js`, idleSeconds = CALENDAR_IDLE_SECONDS} = {}) {
        this.helper = helper; this.emit = emit; this.generation = 0; this.retiring = new Map();
        this.cache = new Map(); this.idleSeconds = idleSeconds;
    }
    watch(request, {refresh = false} = {}) {
        const signature = JSON.stringify(request);
        // A suspended reader still holds this request's live EDS views, so an
        // identical request needs no new query and no emission.
        this._resume();
        if (!refresh && signature === this.signature) return;
        this.signature = signature;
        const generation = ++this.generation;
        this.request = {...request, v:1, generation};
        // Show the cached copy at once (no loading flash), or an explicit
        // loading state for a range seen for the first time.
        this.emit(this.cache.get(signature) ?? {status:'loading', occurrences:[], sources:[], coverage:[], incomplete:true});
        try {
            if (!this.process) {
                this.cancel = new Gio.Cancellable();
                const process = Gio.Subprocess.new(['/usr/bin/gjs', '-m', this.helper],
                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
                this.process = process;
                readLines(process.get_stdout_pipe(), 2 * 1024 * 1024, this.cancel,
                    snapshot => { if (this.process === process) this._receive(snapshot); })
                    .then(() => { if (this.process === process) this._fail(); })
                    .catch(() => { if (this.process === process) this._fail(); });
                process.wait_async(null, (p, r) => {
                    try { p.wait_finish(r); } catch {}
                    const timer = this.retiring.get(p);
                    if (timer) GLib.Source.remove(timer);
                    this.retiring.delete(p);
                    if (this.process === p) this._fail();
                });
            }
            this._deadline();
            this.pending = this.request;
            void this._write();
        } catch { this._fail(); }
    }
    _deadline() {
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this.timer = 0; this._fail(); return GLib.SOURCE_REMOVE;
        });
    }
    async _write() {
        if (this.writing) return;
        const process = this.process, cancel = this.cancel;
        this.writing = process;
        try {
            while (this.pending && process === this.process) {
                const request = this.pending; this.pending = null;
                await write(process.get_stdin_pipe(), encode(request), cancel);
            }
        } catch { if (process === this.process) this._fail(); }
        finally {
            if (this.writing === process) this.writing = null;
            if (this.pending && this.process) void this._write();
        }
    }
    _receive(value) {
        if (value?.v !== 1 || value.generation !== this.generation) return;
        if (!Object.hasOwn(CALENDAR_MESSAGES, value.status) || !Array.isArray(value.sources) || value.sources.length > 64 ||
            !Array.isArray(value.occurrences) || value.occurrences.length > 500 || !Array.isArray(value.coverage) || value.coverage.length > 2)
            throw Error('Invalid calendar snapshot');
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = 0;
        if (value.status === 'loading') {
            this._deadline();
            // Revalidation keeps the cached copy on screen until real data arrives.
            if (this.cache.has(this.signature)) return;
        }
        const batch = normalizeOccurrences(value.occurrences, {sourceUids:this.request.sources,
            incomplete:value.incomplete !== false || value.status !== 'ready'});
        const coverage = (this.request.ranges || []).filter(wanted => value.coverage.some(range =>
            wanted.startDay === range?.startDay && wanted.endDayExclusive === range?.endDayExclusive));
        const plain = text => String(text || '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gu,' ').slice(0,128);
        const sources = value.sources.filter(source => typeof source.uid === 'string' && source.uid.length <= 1024)
            .map(source => ({uid:source.uid, name:plain(source.name),
                account:plain(source.account), color:calendarColor(source.color), enabled:Boolean(source.enabled),
                holiday:source.holiday === true}));
        const snapshot = {status:value.status, ...batch, sources, coverage, receivedAt:Date.now()};
        this._remember(this.signature, CACHED_STATUSES.has(value.status) ? snapshot : null);
        this.emit(snapshot);
    }
    _remember(signature, snapshot) {
        this.cache.delete(signature);
        if (!snapshot) return;
        this.cache.set(signature, snapshot);
        // Map order is insertion order: drop the least recently stored range.
        while (this.cache.size > CALENDAR_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    }
    _fail() {
        const signature = this.signature;
        this.stop({clear:false}); this.signature = signature;
        this.cache.delete(signature);
        this.emit({status:'error', occurrences:[], sources:[], coverage:[], incomplete:true});
    }
    // The last consumer hid. Keep the idle reader (and its live EDS views) for
    // a short grace period so reopening needs no new process or query.
    suspend() {
        if (!this.process || this.idle) return;
        this.idle = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.idleSeconds, () => {
            this.idle = 0; this.stop({clear:false}); return GLib.SOURCE_REMOVE;
        });
    }
    _resume() {
        if (!this.idle) return false;
        GLib.Source.remove(this.idle); this.idle = 0;
        return true;
    }
    stop({clear = true} = {}) {
        this._resume();
        if (clear) this.cache.clear();
        ++this.generation;
        this.signature = null; this.request = null; this.pending = null;
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = 0;
        const process = this.process;
        this.process = null;
        this.cancel?.cancel(); this.cancel = null;
        if (process) {
            process.get_stdin_pipe().close_async(GLib.PRIORITY_DEFAULT, null, (stream, r) => {
                try { stream.close_finish(r); } catch {}
            });
            const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this.retiring.delete(process);
                try { process.force_exit(); } catch {}
                return GLib.SOURCE_REMOVE;
            });
            this.retiring.set(process, timer);
        }
    }
}
