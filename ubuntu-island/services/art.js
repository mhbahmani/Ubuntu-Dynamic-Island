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
    constructor() {
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
        this._cancellable = null;
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
        GLib.Resolver.get_default().lookup_by_name_async(verdict.host, this._cancellable,
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
        this._session ??= new Soup.Session({timeout: 8, user_agent: 'ubuntu-island/2'});
        const message = Soup.Message.new('GET', uri);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    // Redirects may have landed on another host; re-validate the
                    // final URI. (DNS of the redirect target is not re-resolved;
                    // literal private targets are still refused.)
                    const finalHost = message.get_uri()?.get_host?.() ?? '';
                    if (!finalHost || classifyHost(finalHost) === 'block')
                        throw new Error('redirected to a blocked host');
                    let mime = '';
                    try {
                        [mime] = message.get_response_headers().get_content_type(null);
                    } catch {
                        // Pixbuf decoding still validates the actual bytes.
                    }
                    if (mime && !ALLOWED_MIME.includes(mime)) throw new Error(`type ${mime} not allowed`);
                    const size = bytes.get_size();
                    if (size <= 0 || size > MAX_BYTES) throw new Error('unexpected artwork size');
                    this._storeCache(this._cacheFileFor(uri), bytes);
                    this._pixbufFromStream(Gio.MemoryInputStream.new_from_bytes(bytes), sizePx, onContent);
                } catch (e) {
                    this._fail(e, onContent);
                }
            });
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
        const content = new St.ImageContent();
        const format = pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
        try {
            content.set_data(pixbuf.get_pixels(), format, width, height, pixbuf.get_rowstride());
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
        file.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
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
        this._cacheFile.enumerate_children_async('standard::name,standard::mtime',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT_IDLE, null, (dir, result) => {
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
                    enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT_IDLE, null, (en, res) => {
                        try {
                            const infos = en.next_files_finish(res);
                            if (infos.length) {
                                for (const info of infos)
                                    entries.push({name: info.get_name(), mtime: info.get_attribute_uint64('standard::mtime')});
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
                            target.delete_async(GLib.PRIORITY_DEFAULT_IDLE, null, (f, res) => {
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
        console.warn(`[Ubuntu Island] Artwork: ${e.message}`);
        onContent(null);
    }
}
