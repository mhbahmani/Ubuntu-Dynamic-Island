import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {estimatePositionSec} from './format.js';
import {selectPlayer, mediaTitle} from './presentation.js';

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
        this._nameWatch = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [name, , owner] = params.deep_unpack();
                if (!this._alive || !name.startsWith(PREFIX)) return;
                const old = this._proxies.get(name);
                if (old) {
                    for (const id of old._islandSignals) old.disconnect(id);
                    this._proxies.delete(name);
                }
                if (owner && !this._adding.has(name)) this._add(name);
                this._sync();
            });
        this._discover();
    }

    _discover() {
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
                    this._onChange({available: false});
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
                    if (!proxy.g_name_owner) return;
                    proxy._islandSignals = [
                        proxy.connect('g-properties-changed', (p, changed) => {
                            const names = changed.deep_unpack();
                            if ('Position' in names && this._selected === name) this._rebasePosition(p);
                            this._sync();
                        }),
                        proxy.connect('g-signal', (p, sender, signalName, params) => {
                            if (signalName !== 'Seeked') return;
                            const [position] = params?.deep_unpack?.() ?? [];
                            if (this._selected === name) this._rebasePosition(p, position);
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
        const players = [...this._proxies.entries()].map(([name, proxy]) => {
            const meta = this._prop(proxy, 'Metadata') ?? {};
            return {
                name, proxy,
                status: this._prop(proxy, 'PlaybackStatus'),
                title: mediaTitle(
                    unpack(meta['xesam:title']),
                    unpack(meta['xesam:url']) ?? '',
                    ''),
            };
        });
        const selected = selectPlayer(players, this._selected);
        if (!selected) {
            this._selected = null;
            this._playing = false;
            this._positionUs = 0;
            this._lengthUs = 0;
            this._trackId = null;
            this._canSeek = false;
            this._onChange({available: false});
            return;
        }
        const {name, proxy} = selected;
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
        // Freeze the estimated position at pause and restart its clock at play.
        // A cached Position is often stale when only PlaybackStatus changes.
        if (this._playing !== (status === 'Playing')) {
            this._positionUs = this.positionSec() * 1e6;
            this._positionAt = monotonicSec();
        }
        this._playing = status === 'Playing';
        const canControl = Boolean(this._prop(proxy, 'CanControl'));
        const artists = unpack(meta['xesam:artist']);
        this._canSeek = canControl && Boolean(this._prop(proxy, 'CanSeek'));
        const playerName = name.slice(PREFIX.length).split('.')[0];
        this._onChange({
            available: true,
            playerName,
            // Local video players often expose only a media URI; the file
            // name makes a usable title, then the player name as last resort.
            title: mediaTitle(
                unpack(meta['xesam:title']),
                unpack(meta['xesam:url']) ?? '',
                playerName),
            artist: (Array.isArray(artists) ? artists.join(', ') : String(artists ?? '')) || '',
            artUrl: unpack(meta['mpris:artUrl']) || '',
            status,
            positionSec: this.positionSec(),
            lengthSec: this._lengthUs > 0 ? this._lengthUs / 1e6 : null,
            canSeek: this._canSeek,
            canPrevious: canControl && Boolean(this._prop(proxy, 'CanGoPrevious')),
            canNext: canControl && Boolean(this._prop(proxy, 'CanGoNext')),
            canControl,
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
        if (!this._prop(proxy, 'CanControl')) return;
        if (method === 'Previous' && !this._prop(proxy, 'CanGoPrevious')) return;
        if (method === 'Next' && !this._prop(proxy, 'CanGoNext')) return;
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
        if (this._nameWatch) Gio.DBus.session.signal_unsubscribe(this._nameWatch);
        this._nameWatch = 0;
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const proxy of this._proxies.values())
            for (const id of proxy._islandSignals) proxy.disconnect(id);
        this._proxies.clear();
        this._adding.clear();
        this._selected = null;
    }
}
