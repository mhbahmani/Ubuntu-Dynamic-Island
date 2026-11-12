import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import EData from 'gi://EDataServer?version=1.2';
import ECal from 'gi://ECal?version=2.0';
import ICal from 'gi://ICalGLib?version=3.0';
import {builtinZone, timezoneIds, expandSeries} from './occurrences.js';
import {normalizeOccurrences, calendarColor, isGoogleHolidayCalendar} from '../../services/calendar-events-model.js';

const resultValue = result => Array.isArray(result) && typeof result[0] === 'boolean' ? result[1] : result;
const call = (object, name, args, cancel) => new Promise((resolve, reject) => object[name](...args, cancel,
    (source, result) => { try { resolve(resultValue(source[`${name}_finish`](result))); } catch (error) { reject(error); } }));
const idle = () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const timestamp = ms => new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const errorStatus = error => {
    for (const name of ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_FAILED'])
        if (EData.ClientError[name] !== undefined && error.matches?.(EData.ClientError, EData.ClientError[name])) return 'authentication-required';
    return 'disconnected';
};

// Own registry/view subscriptions and generation cancellation. Source metadata
// never changes other applications' selections; only explicit request UIDs open.
export class EDSReader {
    constructor(emit) { this.emit = emit; this.serial = 0; this.signals = []; this.views = []; this.pendingViews = new Set(); }
    async start(request) {
        this.request = request;
        if (!this.registry) {
            this.registryCancel = new Gio.Cancellable();
            this.registry = await new Promise((resolve, reject) => EData.SourceRegistry.new(this.registryCancel, (_s, r) => {
                try { resolve(EData.SourceRegistry.new_finish(r)); } catch (e) { reject(e); }
            }));
            if (this.closed) { this.registry.run_dispose(); this.registry = null; return; }
            this.registrySignals = ['source-added','source-removed','source-changed','source-enabled','source-disabled']
                .map(signal => this.registry.connect(signal, () => this._schedule()));
        }
        if (!this.closed) await this.refresh();
    }
    _schedule() {
        if (this.closed || this.debounce) return;
        this.debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this.debounce = 0;
            const work = this.refresh(), serial = this.serial;
            work.catch(() => {
                if (!this.closed && this.serial === serial) this.emit({v:1,generation:this.request.generation,
                    status:'error',sources:[],occurrences:[],coverage:[],incomplete:true});
            });
            return GLib.SOURCE_REMOVE;
        });
    }
    _clearQueries() {
        this.cancel?.cancel();
        for (const reject of this.pendingViews) reject(Error('Calendar query cancelled'));
        this.pendingViews.clear();
        for (const [object, signal] of this.signals) object.disconnect(signal);
        this.signals = [];
        for (const view of this.views) { try { view.stop(); } catch {} }
        this.views = [];
    }
    catalog() {
        const all = this.registry.list_sources(EData.SOURCE_EXTENSION_CALENDAR);
        const sources = all.slice(0,64).map(source => {
            let parent = source, account = '', depth = 0;
            while (parent.get_parent() && depth++ < 8) {
                parent = this.registry.ref_source(parent.get_parent());
                if (!parent) break;
                account = parent.get_display_name();
            }
            return {uid:source.get_uid(), name:source.get_display_name().slice(0,128),
                account:account.slice(0,128),
                holiday:source.has_extension(EData.SOURCE_EXTENSION_RESOURCE) &&
                    isGoogleHolidayCalendar(source.get_extension(EData.SOURCE_EXTENSION_RESOURCE).get_identity()),
                color:calendarColor(source.get_extension(EData.SOURCE_EXTENSION_CALENDAR).get_color()),
                enabled:this.registry.check_enabled(source)};
        });
        return {sources, incomplete:all.length > 64};
    }
    async refresh() {
        if (this.closed || !this.registry) return;
        this._clearQueries();
        const serial = ++this.serial, request = this.request;
        const cancel = this.cancel = new Gio.Cancellable();
        const current = () => !this.closed && this.serial === serial && !cancel.is_cancelled();
        const {sources, incomplete:catalogIncomplete} = this.catalog();
        const base = {v:1, generation:request.generation, sources, occurrences:[], coverage:[], incomplete:true, sourceStates:[]};
        if (request.catalog) {
            this.emit({...base, status:sources.length ? 'ready' : 'no-sources', incomplete:catalogIncomplete}); return;
        }
        if (!request.sources.length) { this.emit({...base,status:'no-selection'}); return; }
        this.emit({...base,status:'loading'});
        const zone = request.timezone === 'UTC' ? ICal.Timezone.get_utc_timezone() : builtinZone(request.timezone);
        if (!zone) { this.emit({...base,status:'error'}); return; }
        let records = [], incomplete = catalogIncomplete;
        const sourceStates = [];
        for (const uid of request.sources) {
            if (!current()) return;
            const source = this.registry.ref_source(uid);
            if (!source?.has_extension(EData.SOURCE_EXTENSION_CALENDAR) || !this.registry.check_enabled(source)) {
                sourceStates.push({uid,status:'disconnected'}); incomplete = true; continue;
            }
            try {
                const client = await new Promise((resolve,reject) => ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, 5, cancel,
                    (_s,r) => { try { resolve(ECal.Client.connect_finish(r)); } catch (e) { reject(e); } }));
                if (!current()) return;
                client.set_default_timezone(zone);
                let email = '';
                try { email = await call(client, 'get_backend_property', [ECal.BACKEND_PROPERTY_CAL_EMAIL_ADDRESS], cancel) || ''; } catch {}
                if (!current()) return;
                this.signals.push([client,client.connect('notify::online', () => this._schedule())]);
                this.signals.push([client,client.connect('backend-died', () => this._schedule())]);
                for (const range of request.ranges) {
                    const query = `(occur-in-time-range? (make-time "${timestamp(range.startMs)}") (make-time "${timestamp(range.endMs)}"))`;
                    const view = await call(client, 'get_view', [query], cancel);
                    if (!current()) return;
                    this.views.push(view);
                    await new Promise((resolve,reject) => {
                        this.pendingViews.add(reject);
                        let ready = false;
                        for (const signal of ['objects-added','objects-modified','objects-removed'])
                            this.signals.push([view,view.connect(signal, () => { if (ready) this._schedule(); })]);
                        this.signals.push([view,view.connect('complete', (_view,error) => {
                            if (ready) return;
                            ready = true;
                            this.pendingViews.delete(reject);
                            if (error) reject(error); else resolve();
                        })]);
                        try { view.start(); } catch (error) { this.pendingViews.delete(reject); reject(error); }
                    });
                    if (!current()) return;
                    const matching = await call(client, 'get_object_list_as_comps', [query], cancel);
                    const uids = [...new Set(matching.slice(0,501).map(comp => comp.get_uid()))];
                    if (matching.length > 500) incomplete = true;
                    for (const eventUid of uids) {
                        if (!current()) return;
                        if (records.length >= 500) { incomplete = true; break; }
                        // Fetch the entire bounded series so a moved/deleted
                        // detached occurrence can suppress its original slot.
                        const series = await call(client, 'get_objects_for_uid', [eventUid], cancel);
                        if (series.length > 500) { incomplete = true; continue; }
                        const components = series.map(comp => comp.get_icalcomponent());
                        const zones = new Map();
                        const ids = [...new Set(components.flatMap(timezoneIds))];
                        if (ids.length > 64) { incomplete = true; continue; }
                        let missingZone = false;
                        for (const id of ids) {
                            try { zones.set(id, builtinZone(id) || await call(client,'get_timezone',[id],cancel)); }
                            catch { missingZone = true; }
                        }
                        if (!current()) return;
                        if (missingZone) { incomplete = true; continue; }
                        const expanded = expandSeries(components, range, {sourceUid:uid,zone,zones,email,cancel,limit:500 - records.length});
                        records.push(...expanded.occurrences); incomplete ||= expanded.incomplete;
                        await idle();
                    }
                }
                const offline = !client.is_online();
                incomplete ||= offline;
                sourceStates.push({uid,status:'ready',offline});
            } catch (error) {
                if (!current()) return;
                sourceStates.push({uid,status:errorStatus(error)}); incomplete = true;
            }
        }
        if (!current()) return;
        const batch = normalizeOccurrences(records, {sourceUids:request.sources,incomplete});
        const succeeded = sourceStates.some(s => s.status === 'ready');
        const offline = sourceStates.some(s => s.offline);
        const status = !batch.incomplete ? 'ready' : offline ? 'offline' : succeeded ? 'partial' :
            sourceStates.some(s => s.status === 'authentication-required') ? 'authentication-required' : 'disconnected';
        this.emit({...base,...batch,status,sourceStates,coverage:request.ranges,receivedAt:Date.now()});
    }
    stop() {
        this.closed = true; ++this.serial; this.registryCancel?.cancel(); this._clearQueries();
        if (this.debounce) GLib.Source.remove(this.debounce);
        this.debounce = 0;
        for (const signal of this.registrySignals || []) this.registry.disconnect(signal);
        this.registrySignals = [];
        // EDS's registry owns a D-Bus thread and iterates its context during
        // disposal. Release it while GJS callbacks are still alive, before the
        // helper tears down its JavaScript context.
        this.registry?.run_dispose(); this.registry = null;
    }
}
