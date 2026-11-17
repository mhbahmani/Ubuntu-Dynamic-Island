import {roundedCover} from './artwork-model.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Cogl from 'gi://Cogl';
import {hashUri} from './format.js';
import {checkUrl, classifyHost} from './urlguard.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const CACHE_LIMIT = 24;

// Bounded, asynchronous artwork loading. file:// URIs are read straight from
// disk; remote art goes through a size/MIME-checked, host-validated,
// disk-cached Soup request. Nothing here blocks the Shell main loop, requests
// are cancelled on track change, and SVG is never accepted (active content).
export class ArtLoader {
    load(uri, sizePx, onContent, {cover = true} = {}) {
        this.cancel();
        const request = new ArtworkRequest(cover);
        this._request = request;
        request.load(uri, sizePx, content => {
            if (this._request === request) onContent(content);
        });
    }

    cancel() {
        this._request?.cancel();
        this._request = null;
    }

    destroy() { this.cancel(); }
}

// Each request owns its cancellable. A callback from an old track can never
// start work with the new track's cancellable or replace its cover.
class ArtworkRequest {
    constructor(cover = true) {
        this._cover = cover;
        this._session = null;
        this._cancellable = null;
        this._trustedHosts = new Set(); // hostnames whose DNS answers proved safe
        this._cacheDir = null;
        this._cacheFile = null;
        this._pruning = false;
    }

    load(uri, sizePx, onContent) {
        this.cancel();
        if (!uri) {
            onContent(null);
            return;
        }
        this._cancellable = new Gio.Cancellable();
        if (uri.startsWith('file://')) {
            this._loadFile(Gio.File.new_for_uri(uri), sizePx, onContent, true);
        } else if (/^https?:\/\//i.test(uri)) {
            this._loadRemote(uri, sizePx, onContent);
        } else {
            onContent(null);
        }
    }

    cancel() {
        this._cancellable?.cancel();
    }

    destroy() {
        this.cancel();
    }

    _loadFile(file, sizePx, onContent, strictMime) {
        file.query_info_async('standard::size,standard::content-type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable,
            (source, result) => {
                try {
                    const info = source.query_info_finish(result);
                    if (info.get_size() > MAX_BYTES) throw new Error('file exceeds 2 MiB');
                    const mime = info.get_content_type() ?? '';
                    if (strictMime && mime && !ALLOWED_MIME.includes(mime))
                        throw new Error(`type ${mime} not allowed`);
                    source.read_async(GLib.PRIORITY_DEFAULT_IDLE, this._cancellable, (f, res2) => {
                        try {
                            this._pixbufFromStream(f.read_finish(res2), sizePx, onContent);
                        } catch (e) {
                            this._fail(e, onContent);
                        }
                    });
                } catch (e) {
                    this._fail(e, onContent);
                }
            });
    }

    _loadRemote(uri, sizePx, onContent) {
        const verdict = checkUrl(uri);
        if (!verdict.ok) {
            console.log(`[Ubuntu Island] Artwork skipped: ${verdict.reason}`);
            onContent(null);
            return;
        }
        const fetch = () => this._fetchOrCache(uri, sizePx, onContent);
        if (!verdict.needsDns || this._trustedHosts.has(verdict.host)) {
            fetch();
            return;
        }
        // Resolve before connecting so hostnames pointing at private,
        // loopback, or link-local space can never be fetched.
        Gio.Resolver.get_default().lookup_by_name_async(verdict.host, this._cancellable,
            (resolver, result) => {
                try {
                    const addresses = resolver.lookup_by_name_finish(result);
                    if (!addresses.length) throw new Error('host did not resolve');
                    if (addresses.some(address => classifyHost(address.to_string()) === 'block'))
                        throw new Error('host resolves to a blocked address');
                    this._trustedHosts.add(verdict.host);
                    fetch();
                } catch (e) {
                    this._fail(e, onContent);
                }
            });
    }

    _fetchOrCache(uri, sizePx, onContent) {
        const cached = this._cacheFileFor(uri);
        cached.query_info_async('standard::size', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT_IDLE, this._cancellable, (file, result) => {
                let hit = false;
                try {
                    hit = file.query_info_finish(result).get_size() > 0;
                } catch {
                    // No cache entry yet.
                }
                if (hit) {
                    // Cached bytes were MIME-validated before storing.
                    this._loadFile(file, sizePx, onContent, false);
                } else {
                    this._fetchRemote(uri, sizePx, onContent);
                }
            });
    }

    _fetchRemote(uri, sizePx, onContent) {
        this._session ??= new Soup.Session({timeout: 8, user_agent: 'ubuntu-island/4'});
        const message = Soup.Message.new('GET', uri);
        // Do not follow redirects to an unvalidated address. Stream in bounded
        // chunks instead of allocating an unbounded body before checking size.
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        this._session.send_async(message, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable,
            (session, result) => {
                let stream;
                try {
                    stream = session.send_finish(result);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    // Re-check the actual URI even though redirects are disabled.
                    const finalHost = message.get_uri()?.get_host?.() ?? '';
                    if (!finalHost || classifyHost(finalHost) === 'block')
                        throw new Error('redirected to a blocked host');
                    const headers = message.get_response_headers();
                    const mime = (headers.get_one('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
                    if (!ALLOWED_MIME.includes(mime)) throw new Error(`type ${mime} not allowed`);
                    if (headers.get_content_length() > MAX_BYTES) throw new Error('artwork exceeds 2 MiB');
                    this._readBounded(stream, uri, sizePx, onContent);
                } catch (e) {
                    stream?.close_async(GLib.PRIORITY_DEFAULT_IDLE, null, (source, res) => {
                        try { source.close_finish(res); } catch { /* best effort */ }
                    });
                    this._fail(e, onContent);
                }
            });
    }

    _readBounded(stream, uri, sizePx, onContent) {
        const chunks = [];
        let total = 0;
        const close = () => stream.close_async(GLib.PRIORITY_DEFAULT_IDLE, null, (source, result) => {
            try { source.close_finish(result); } catch { /* best effort */ }
        });
        const read = () => stream.read_bytes_async(64 * 1024, GLib.PRIORITY_DEFAULT_IDLE,
            this._cancellable, (source, result) => {
                try {
                    const bytes = source.read_bytes_finish(result);
                    const size = bytes.get_size();
                    total += size;
                    if (total > MAX_BYTES) throw new Error('artwork exceeds 2 MiB');
                    if (size) { chunks.push(bytes.get_data()); read(); return; }
                    close();
                    if (!total) throw new Error('empty artwork');
                    const data = new Uint8Array(total);
                    let offset = 0;
                    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
                    const body = new GLib.Bytes(data);
                    this._storeCache(this._cacheFileFor(uri), body);
                    this._pixbufFromStream(Gio.MemoryInputStream.new_from_bytes(body), sizePx, onContent);
                } catch (error) { close(); this._fail(error, onContent); }
            });
        read();
    }

    _pixbufFromStream(stream, sizePx, onContent) {
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, sizePx, sizePx, true,
            this._cancellable, (source, result) => {
                try {
                    stream.close(null);
                } catch {
                    // The decoder owns the stream; closing failures are harmless.
                }
                try {
                    onContent(this._toContent(GdkPixbuf.Pixbuf.new_from_stream_finish(result)));
                } catch (e) {
                    this._fail(e, onContent);
                }
            });
    }

    _toContent(pixbuf) {
        if (!pixbuf) return null;
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        if (width <= 0 || height <= 0) return null;
        // Sprite atlases must retain every pixel and their rectangular geometry.
        // Album-cover cropping shifts tile boundaries and exposes adjacent frames.
        if (!this._cover) {
            const content = St.ImageContent.new_with_preferred_size(width, height);
            content.set_data(pixbuf.get_pixels(), pixbuf.get_has_alpha()
                ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            width, height, pixbuf.get_rowstride());
            return content;
        }
        const rounded = roundedCover(pixbuf.get_pixels(), width, height, pixbuf.get_rowstride(), pixbuf.get_n_channels());
        const content = St.ImageContent.new_with_preferred_size(rounded.side, rounded.side);
        try {
            content.set_data(rounded.data, Cogl.PixelFormat.RGBA_8888, rounded.side, rounded.side, rounded.side * 4);
            // Sample a small fixed grid once per decoded cover, never per frame.
            const pixels = pixbuf.get_pixels();
            const stride = pixbuf.get_rowstride(), channels = pixbuf.get_n_channels();
            const sum = [0, 0, 0];
            let weight = 0;
            for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 12)))
                for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 12))) {
                    const at = y * stride + x * channels;
                    if (channels === 4 && pixels[at + 3] < 128) continue;
                    const rgb = [pixels[at], pixels[at + 1], pixels[at + 2]];
                    const saturation = Math.max(...rgb) - Math.min(...rgb);
                    const w = 1 + saturation / 32;
                    rgb.forEach((v, i) => { sum[i] += v * w; });
                    weight += w;
                }
            content._islandAccent = weight ? sum.map(v => Math.round(v / weight)) : null;
            return content;
        } catch (e) {
            console.warn(`[Ubuntu Island] Artwork decode: ${e.message}`);
            return null;
        }
    }

    _cacheFileFor(uri) {
        if (!this._cacheFile) {
            this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntu-island', 'art']);
            GLib.mkdir_with_parents(this._cacheDir, 0o700);
            this._cacheFile = Gio.File.new_for_path(this._cacheDir);
        }
        return Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, `${hashUri(uri)}.img`]));
    }

    _storeCache(file, bytes) {
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
            this._cancellable, (source, result) => {
                try {
                    source.replace_contents_finish(result);
                    this._pruneCache();
                } catch (e) {
                    console.warn(`[Ubuntu Island] Artwork cache write: ${e.message}`);
                }
            });
    }

    // Keeps at most CACHE_LIMIT entries, dropping the least recently written.
    _pruneCache() {
        if (this._pruning || !this._cacheFile) return;
        this._pruning = true;
        this._cacheFile.enumerate_children_async('standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable, (dir, result) => {
                const done = () => {
                    this._pruning = false;
                };
                let enumerator;
                try {
                    enumerator = dir.enumerate_children_finish(result);
                } catch {
                    done();
                    return;
                }
                const entries = [];
                const collect = () => {
                    enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable, (en, res) => {
                        try {
                            const infos = en.next_files_finish(res);
                            if (infos.length) {
                                for (const info of infos)
                                    entries.push({name: info.get_name(), mtime: info.get_attribute_uint64('time::modified')});
                                collect();
                                return;
                            }
                        } catch {
                            // Fall through to pruning whatever was collected.
                        }
                        enumerator.close(null);
                        entries.sort((a, b) => a.mtime - b.mtime);
                        for (const victim of entries.slice(0, Math.max(0, entries.length - CACHE_LIMIT))) {
                            const target = Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, victim.name]));
                            target.delete_async(GLib.PRIORITY_DEFAULT_IDLE, this._cancellable, (f, res) => {
                                try {
                                    f.delete_finish(res);
                                } catch {
                                    // Racing eviction is fine.
                                }
                            });
                        }
                        done();
                    });
                };
                collect();
            });
    }

    _fail(e, onContent) {
        if (this._cancellable?.is_cancelled()) return;
        console.warn(`[Ubuntu Island] Artwork: ${e.message}`);
        onContent(null);
    }
}
