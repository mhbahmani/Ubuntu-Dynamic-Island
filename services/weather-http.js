import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const LIMIT = 256 * 1024;
// Fixed HTTPS providers, no redirects, bounded streamed bodies and a hard deadline.
export class WeatherHttp {
    constructor() {
        this.session = new Soup.Session({timeout: 12, user_agent: 'ubuntu-island-weather/1'});
        this.requests = new Set();
    }
    cancel() { for (const request of this.requests) request.cancel(); }
    async get(url) {
        const cancellable = new Gio.Cancellable();
        this.requests.add(cancellable);
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        let stream;
        let expired = false;
        const cancelId = cancellable.connect(() => { expired = true; });
        try {
            const message = Soup.Message.new('GET', url);
            message.set_flags(Soup.MessageFlags.NO_REDIRECT);
            stream = await new Promise((resolve, reject) => this.session.send_async(message,
                GLib.PRIORITY_DEFAULT_IDLE, cancellable, (s, r) => {
                    try { resolve(s.send_finish(r)); } catch (e) { reject(e); }
                }));
            if (message.get_status() !== 200) {
                const error = new Error('Weather HTTP error');
                error.status = message.get_status();
                throw error;
            }
            if (message.get_response_headers().get_content_length() > LIMIT) throw new Error('Response too large');
            let size = 0;
            const chunks = [];
            while (true) {
                const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(8192,
                    GLib.PRIORITY_DEFAULT_IDLE, cancellable, (s, r) => {
                        try { resolve(s.read_bytes_finish(r)); } catch (e) { reject(e); }
                    }));
                if (!bytes.get_size()) break;
                size += bytes.get_size();
                if (size > LIMIT) throw new Error('Response too large');
                chunks.push(bytes.get_data());
            }
            const data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
            return JSON.parse(new TextDecoder().decode(data));
        } finally {
            // A cancelled request may still have a live deadline (manual cancel).
            // Find the source rather than removing an already-fired source ID.
            if (!expired || GLib.MainContext.default().find_source_by_id(timer)) GLib.Source.remove(timer);
            cancellable.disconnect(cancelId);
            this.requests.delete(cancellable);
            stream?.close_async(GLib.PRIORITY_DEFAULT_IDLE, null, (s, r) => {
                try { s.close_finish(r); } catch { /* best effort */ }
            });
        }
    }
}
