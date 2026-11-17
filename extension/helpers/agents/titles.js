// Provider metadata I/O belongs to the broker process, never GNOME Shell or the
// pure session model. Only the small title record is opened; never a transcript.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readBounded} from './io.js';

export function titleLocation(source, session) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(session) || typeof source?.root !== 'string' ||
        typeof source.transcript !== 'string' || source.root.length > 2048 || source.transcript.length > 4096 ||
        !source.root.startsWith('/') || /[\0\r\n]/.test(source.root + source.transcript)) return null;
    const root = GLib.canonicalize_filename(source.root, null);
    const path = GLib.canonicalize_filename(source.transcript, null);
    const prefix = `${root}/projects/`;
    if (!path.startsWith(prefix)) return null;
    const parts = path.slice(prefix.length).split('/');
    if (parts.length !== 2 || parts[1] !== `${session}.jsonl` || !parts[0]) return null;
    const project = `${prefix}${parts[0]}`;
    return {root, project, directory:`${project}/${session}`, path:`${project}/${session}/custom-title.json`};
}
function info(file, cancel) {
    return new Promise((resolve, reject) => file.query_info_async('standard::type,standard::is-symlink,standard::size,unix::uid',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancel,
        (f, r) => { try { resolve(f.query_info_finish(r)); } catch (e) { reject(e); } }));
}
async function safe(path, type, cancel) {
    const file = Gio.File.new_for_path(path), value = await info(file, cancel);
    if (value.get_is_symlink() || value.get_file_type() !== type ||
        value.get_attribute_uint32('unix::uid') !== new Gio.Credentials().get_unix_user()) throw new Error('Invalid metadata');
    return {file, value};
}

export class AgentTitles {
    constructor(store, changed) { this.store = store; this.changed = changed; this.sources = new Map(); this.active = false; }
    remember(event, source) {
        const id = JSON.stringify([event.provider, event.profile || 'default', event.session]);
        const location = event.provider === 'claude' ? titleLocation(source, event.session) : null;
        if (!location || !this.store.rows.has(id)) return;
        const old = this.sources.get(id);
        if (old?.path === location.path) return;
        if (old) this._stop(old);
        const entry = {...location, id, monitors:[], generation:0};
        this.sources.set(id, entry);
        if (this.active) this._queue(entry);
    }
    sync() {
        for (const [id, entry] of this.sources) {
            const row = this.store.rows.get(id);
            // Hidden parents still supply the attribution of a visible child.
            const needed = row && row.state !== 'closed' && (!row.hidden || [...this.store.rows.values()].some(child =>
                !child.hidden && child.state !== 'closed' && this.store._parent(child) === row));
            if (!row) { this._stop(entry); this.sources.delete(id); }
            else if (!this.active || !needed) this._stop(entry);
            else if (!entry.cancel) this._queue(entry);
        }
    }
    setActive(active) { this.active = active; this.sync(); }
    _stop(entry) {
        entry.generation++;
        if (entry.tick) GLib.Source.remove(entry.tick);
        if (entry.deadline) GLib.Source.remove(entry.deadline);
        entry.tick = entry.deadline = 0;
        entry.cancel?.cancel(); entry.cancel = null;
        for (const monitor of entry.monitors) monitor.cancel();
        entry.monitors = [];
    }
    _queue(entry) {
        if (!this.active) return;
        // Cancel an earlier read immediately; atomic replacement bursts share
        // one short, one-shot debounce. There is no repeating refresh source.
        this._stop(entry);
        const generation = entry.generation;
        entry.tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            entry.tick = 0; void this._refresh(entry, generation); return GLib.SOURCE_REMOVE;
        });
    }
    async _refresh(entry, generation) {
        const cancel = new Gio.Cancellable(); entry.cancel = cancel;
        entry.deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            entry.deadline = 0; cancel.cancel(); return GLib.SOURCE_REMOVE;
        });
        const current = () => this.active && entry.generation === generation && !cancel.is_cancelled();
        let stream;
        try {
            // Validate every directory below the profile before attaching even
            // a monitor. Unsupported/missing layouts keep the stable fallback.
            await safe(entry.root, Gio.FileType.DIRECTORY, cancel);
            await safe(`${entry.root}/projects`, Gio.FileType.DIRECTORY, cancel);
            const {file:project} = await safe(entry.project, Gio.FileType.DIRECTORY, cancel);
            if (!current()) return;
            const watch = (file, name) => {
                const monitor = file.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, cancel);
                monitor.connect('changed', (_m, first, second) => {
                    if (!current()) return;
                    if (first?.get_basename() === name || second?.get_basename() === name) this._queue(entry);
                });
                entry.monitors.push(monitor);
            };
            watch(project, GLib.path_get_basename(entry.directory));
            const {file:directory} = await safe(entry.directory, Gio.FileType.DIRECTORY, cancel);
            if (!current()) return;
            watch(directory, 'custom-title.json');
            const {file, value} = await safe(entry.path, Gio.FileType.REGULAR, cancel);
            if (value.get_size() > 8192) return;
            stream = await new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, cancel,
                (f, r) => { try { resolve(f.read_finish(r)); } catch (e) { reject(e); } }));
            const metadata = JSON.parse(await readBounded(stream, 8192, cancel));
            if (current() && this.store.setTitle(entry.id, metadata.customTitle ?? metadata.title)) this.changed();
        } catch { /* Missing, malformed, inaccessible and unsupported metadata are normal. */ }
        finally {
            try { stream?.close(null); } catch {}
            if (entry.generation === generation && entry.deadline) {
                GLib.Source.remove(entry.deadline); entry.deadline = 0;
            }
        }
    }
    stop() { this.active = false; for (const entry of this.sources.values()) this._stop(entry); this.sources.clear(); }
}
