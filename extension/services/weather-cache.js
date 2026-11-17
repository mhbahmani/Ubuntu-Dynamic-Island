import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {PROVIDERS} from './weather-model.js';

const LIMIT = 32 * 1024;
// One versioned location/result, replaced atomically; no unbounded cache history.
export class WeatherCache {
    constructor() {
        this.directory = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntu-island']));
        this.file = this.directory.get_child('weather-v1.json');
        this.cancellable = new Gio.Cancellable();
    }
    cancel() { this.cancellable.cancel(); this.cancellable = new Gio.Cancellable(); }
    async load(location) {
        const cancellable = this.cancellable;
        let stream;
        try {
            stream = await new Promise((resolve, reject) => this.file.read_async(GLib.PRIORITY_DEFAULT_IDLE,
                cancellable, (f, r) => { try { resolve(f.read_finish(r)); } catch (e) { reject(e); } }));
            const chunks = [];
            let total = 0;
            while (true) {
                const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(4096,
                    GLib.PRIORITY_DEFAULT_IDLE, cancellable, (s, r) => {
                        try { resolve(s.read_bytes_finish(r)); } catch (e) { reject(e); }
                    }));
                if (!bytes.get_size()) break;
                total += bytes.get_size();
                if (total > LIMIT) return null;
                chunks.push(bytes.get_data());
            }
            const bytes = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            const cache = JSON.parse(new TextDecoder().decode(bytes));
            const data = cache.data;
            if (cache.version !== 1 || cache.location !== JSON.stringify(location) ||
                !PROVIDERS.includes(data?.provider) || !Number.isFinite(data.updatedAt) ||
                data.updatedAt > Date.now() || !Number.isFinite(data.current?.temperature) ||
                typeof data.current.condition !== 'string' || !Array.isArray(data.hourly) || data.hourly.length > 24 ||
                data.hourly.some(h => typeof h.time !== 'string' || !Number.isFinite(h.temperature))) return null;
            return data;
        } catch { return null; }
        finally {
            stream?.close_async(GLib.PRIORITY_DEFAULT_IDLE, null, (s, r) => {
                try { s.close_finish(r); } catch { /* best effort */ }
            });
        }
    }
    async save(location, data) {
        const cancellable = this.cancellable;
        try {
            await new Promise((resolve, reject) => this.directory.make_directory_async(GLib.PRIORITY_DEFAULT_IDLE,
                cancellable, (f, r) => {
                    try { f.make_directory_finish(r); resolve(); }
                    catch (e) { if (e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS)) resolve(); else reject(e); }
                }));
            const bytes = new TextEncoder().encode(JSON.stringify({version: 1, location: JSON.stringify(location), data}));
            if (bytes.length > LIMIT) return;
            await new Promise((resolve, reject) => this.file.replace_contents_bytes_async(new GLib.Bytes(bytes), null,
                false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable, (f, r) => {
                    try { f.replace_contents_finish(r); resolve(); } catch (e) { reject(e); }
                }));
        } catch { /* Cache failures never prevent live weather. */ }
    }
}
