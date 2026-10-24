import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {estimatePositionSec} from './format.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const COMMANDS = ['Previous', 'PlayPause', 'Next', 'Play', 'Stop'];
const unpack = value => value?.deep_unpack?.() ?? value;
const monotonicSec = () => GLib.get_monotonic_time() / 1e6;

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
        // Progress model: players rarely push Position updates, so the live
        // position is estimated from the last known sample plus elapsed time.
        this._positionUs = 0;
        this._positionAt = 0;
        this._playing = false;
        this._lengthUs = 0;
        this._canSeek = false;
        this._trackId = null;
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
                            for (const id of proxy._islandSignals) proxy.disconnect(id);
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
                    proxy._islandSignals = [
                        proxy.connect('g-properties-changed', (p, changed) => {
                            const names = changed.deep_unpack();
                            if ('Position' in names) this._rebasePosition(p);
                            this._sync();
                        }),
                        proxy.connect('g-signal', (p, sender, signalName, params) => {
                            if (signalName !== 'Seeked') return;
                            const [position] = params?.deep_unpack?.() ?? [];
                            this._rebasePosition(p, position);
                            this._sync();
                        }),
                    ];
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

    _rebasePosition(proxy, us = null) {
        const value = us ?? this._prop(proxy, 'Position');
        this._positionUs = Number.isFinite(value) ? value : 0;
        this._positionAt = monotonicSec();
    }

    _sync() {
        if (!this._alive) return;
        const players = [...this._proxies.entries()];
        const playing = players.find(([, p]) => this._prop(p, 'PlaybackStatus') === 'Playing');
        // Prefer a currently playing player, otherwise preserve selection.
        const selected = playing ?? players.find(([name]) => name === this._selected) ?? players[0];
        if (!selected) {
            this._selected = null;
            this._playing = false;
            this._positionUs = 0;
            this._lengthUs = 0;
            this._trackId = null;
            this._onChange({available: false});
            return;
        }
        const [name, proxy] = selected;
        const meta = this._prop(proxy, 'Metadata') ?? {};
        const trackId = unpack(meta['mpris:trackid']) ?? null;
        if (name !== this._selected || trackId !== this._trackId) {
            // New player or new track: restart the progress model.
            this._selected = name;
            this._trackId = trackId;
            this._lengthUs = Number(unpack(meta['mpris:length']) ?? 0);
            this._rebasePosition(proxy);
        } else {
            this._lengthUs = Number(unpack(meta['mpris:length']) ?? this._lengthUs);
        }
        const status = this._prop(proxy, 'PlaybackStatus') || 'Stopped';
        this._playing = status === 'Playing';
        this._canSeek = Boolean(this._prop(proxy, 'CanSeek'));
        this._onChange({
            available: true,
            title: unpack(meta['xesam:title']) || 'Unknown title',
            artist: (unpack(meta['xesam:artist']) || []).join(', ') || 'Unknown artist',
            artUrl: unpack(meta['mpris:artUrl']) || '',
            status,
            lengthSec: this._lengthUs > 0 ? this._lengthUs / 1e6 : null,
            canSeek: this._canSeek,
            canPrevious: Boolean(this._prop(proxy, 'CanGoPrevious')),
            canNext: Boolean(this._prop(proxy, 'CanGoNext')),
            canControl: Boolean(this._prop(proxy, 'CanControl')),
        });
    }

    // Live position estimate; the UI polls this once per second while expanded.
    positionSec() {
        return estimatePositionSec(this._positionUs, this._positionAt, monotonicSec(), this._playing);
    }

    seek(seconds) {
        const proxy = this._proxies.get(this._selected);
        if (!proxy || !this._canSeek || !this._trackId) return;
        let us = Math.round(seconds * 1e6);
        if (this._lengthUs > 0) us = Math.max(0, Math.min(this._lengthUs - 1, us));
        proxy.call('SetPosition', new GLib.Variant('(ox)', [this._trackId, us]),
            Gio.DBusCallFlags.NONE, 2500, this._cancellable, (p, result) => {
                if (!this._alive) return;
                try {
                    p.call_finish(result);
                } catch (e) {
                    console.warn(`[Ubuntu Island] Seek: ${e.message}`);
                }
            });
        // Optimistic rebase; the player confirms it with a Seeked signal.
        this._positionUs = us;
        this._positionAt = monotonicSec();
    }

    command(method) {
        if (!COMMANDS.includes(method)) return;
        const proxy = this._proxies.get(this._selected);
        if (!proxy) return;
        proxy.call(method, null, Gio.DBusCallFlags.NONE, 2500,
            this._cancellable, (p, result) => {
                if (!this._alive) return;
                try {
                    p.call_finish(result);
                } catch (e) {
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
        for (const proxy of this._proxies.values())
            for (const id of proxy._islandSignals) proxy.disconnect(id);
        this._proxies.clear();
        this._adding.clear();
        this._selected = null;
    }
}
