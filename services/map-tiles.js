import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';

// Preferences only. Soup honors HTTP cache validators, expiry and cache size.
export class MapTiles {
    constructor() {
        const path = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntu-island', 'map-tiles']);
        GLib.mkdir_with_parents(path, 0o700);
        this.cache = new Soup.Cache({cache_dir: path, cache_type: Soup.CacheType.SINGLE_USER});
        this.cache.set_max_size(32 * 1024 * 1024); this.cache.load();
        this.session = new Soup.Session({timeout: 12, max_conns: 4, max_conns_per_host: 4,
            user_agent: 'UbuntuIsland/11 RouteEditor (https://github.com/mhbahmani/ubuntu-dynamic-island)'});
        this.session.add_feature(this.cache);
        this.cancel = new Gio.Cancellable();
    }
    async get(key) {
        const message = Soup.Message.new('GET', `https://tile.openstreetmap.org/${key}.png`);
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        const stream = await new Promise((resolve, reject) => this.session.send_async(message, GLib.PRIORITY_DEFAULT,
            this.cancel, (s, r) => { try { resolve(s.send_finish(r)); } catch (e) { reject(e); } }));
        try {
            if (message.status_code !== 200 || message.get_response_headers().get_content_length() > 512 * 1024)
                throw new Error('Map tile unavailable');
            const chunks = []; let size = 0;
            while (true) {
                const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT,
                    this.cancel, (s, r) => { try { resolve(s.read_bytes_finish(r)); } catch (e) { reject(e); } }));
                if (!bytes.get_size()) break;
                size += bytes.get_size(); if (size > 512 * 1024) throw new Error('Map tile too large');
                chunks.push(bytes.get_data());
            }
            const data = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
            const input = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data));
            return await new Promise((resolve, reject) => GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(input,
                256, 256, false, this.cancel, (_s, r) => {
                    try { resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(r)); } catch (e) { reject(e); }
                }));
        } finally {
            stream.close_async(GLib.PRIORITY_DEFAULT, null, (s, r) => { try { s.close_finish(r); } catch { /* Closing. */ } });
        }
    }
    stop() { this.cancel.cancel(); this.session.abort(); this.cache.dump(); }
}
