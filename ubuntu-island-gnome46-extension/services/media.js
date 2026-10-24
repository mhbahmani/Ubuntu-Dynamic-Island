import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const unpack = value => value?.deep_unpack?.() ?? value;

export class MediaService {
    constructor(onChange) {
        this._onChange = onChange;
        this._proxies = new Map();
        this._adding = new Set();
        this._selected = null;
        this._timer = 0;
        this._alive = false;
        this._cancellable = null;
        this._busy = false;
    }

    start() {
        this._alive = true;
        this._cancellable = new Gio.Cancellable();
        this._poll();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _poll() {
        if (!this._alive || this._busy) return;
        this._busy = true;
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 2500,
            this._cancellable, (connection, result) => {
                this._busy = false;
                if (!this._alive) return;
                try {
                    const [names] = connection.call_finish(result).deep_unpack();
                    const active = new Set(names.filter(name => name.startsWith(PREFIX)));
                    for (const [name, proxy] of this._proxies) {
                        if (!active.has(name)) {
                            proxy.disconnect(proxy._islandSignal);
                            this._proxies.delete(name);
                        }
                    }
                    for (const name of active) {
                        if (!this._proxies.has(name) && !this._adding.has(name)) this._add(name);
                    }
                    this._sync();
                } catch (e) {
                    console.warn(`[Ubuntu Island] MPRIS discovery: ${e.message}`);
                }
            });
    }

    _add(name) {
        this._adding.add(name);
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE,
            null, name, PATH, PLAYER, this._cancellable, (source, result) => {
                this._adding.delete(name);
                if (!this._alive) return;
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    proxy._islandSignal = proxy.connect('g-properties-changed', () => this._sync());
                    this._proxies.set(name, proxy);
                    this._sync();
                } catch (e) {
                    console.warn(`[Ubuntu Island] MPRIS player ${name}: ${e.message}`);
                }
            });
    }

    _prop(proxy, name) {
        return unpack(proxy.get_cached_property(name));
    }

    _sync() {
        if (!this._alive) return;
        const players = [...this._proxies.entries()];
        const playing = players.find(([, p]) => this._prop(p, 'PlaybackStatus') === 'Playing');
        // Prefer a currently playing player, otherwise preserve selection when possible.
        const selected = playing ?? players.find(([name]) => name === this._selected) ?? players[0];
        if (!selected) {
            this._selected = null;
            this._onChange({available: false});
            return;
        }
        const [name, proxy] = selected;
        this._selected = name;
        const meta = this._prop(proxy, 'Metadata') ?? {};
        this._onChange({
            available: true,
            title: unpack(meta['xesam:title']) || 'Unknown title',
            artist: (unpack(meta['xesam:artist']) || []).join(', ') || 'Unknown artist',
            artUrl: unpack(meta['mpris:artUrl']) || '',
            status: this._prop(proxy, 'PlaybackStatus') || 'Stopped',
            canPrevious: Boolean(this._prop(proxy, 'CanGoPrevious')),
            canNext: Boolean(this._prop(proxy, 'CanGoNext')),
            canControl: Boolean(this._prop(proxy, 'CanControl')),
        });
    }

    command(method) {
        if (!['Previous', 'PlayPause', 'Next'].includes(method)) return;
        const proxy = this._proxies.get(this._selected);
        if (!proxy) return;
        proxy.call(method, null, Gio.DBusCallFlags.NONE, 2500,
            this._cancellable, (p, result) => {
                if (!this._alive) return;
                try { p.call_finish(result); } catch (e) {
                    console.warn(`[Ubuntu Island] ${method}: ${e.message}`);
                }
            });
    }

    stop() {
        this._alive = false;
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const proxy of this._proxies.values()) proxy.disconnect(proxy._islandSignal);
        this._proxies.clear();
        this._adding.clear();
        this._selected = null;
    }
}
