import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {estimatePositionSec} from './format.js';
import {selectPlayer, mediaTitle} from './presentation.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';
const TRACKS = 'org.mpris.MediaPlayer2.TrackList';
const COMMANDS = ['Previous', 'PlayPause', 'Next', 'Play', 'Stop'];
const unpack = value => value?.deep_unpack?.() ?? value;
const monotonicSec = () => GLib.get_monotonic_time() / 1e6;

export class MediaService {
    constructor(onChange, onQueue = () => {}) {
        this._onChange = onChange;
        this._onQueue = onQueue;
        this._roots = new Map();
        this._preferred = null;
        this._queueGeneration = 0;
        this._seekGeneration = 0;
        this._positionGeneration = 0;
        this._positionCancel = null;
        this._positionProxy = null;
        this._pending = new Set();
        this._error = '';
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
                    this._forgetRoot(name);
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
                            this._forgetRoot(name);
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
                    this._addRoot(name, proxy);
                    this._sync();
                } catch (e) {
                    console.warn(`[Ubuntu Island] MPRIS player ${name}: ${e.message}`);
                }
            });
    }

    _prop(proxy, name) {
        return proxy ? unpack(proxy.get_cached_property(name)) : undefined;
    }

    _rebasePosition(proxy, us = null) {
        this._cancelPositionRead();
        const value = us ?? this._prop(proxy, 'Position');
        this._positionUs = Number.isFinite(value) ? value : 0;
        this._positionAt = monotonicSec();
    }

    _cancelPositionRead() {
        this._positionGeneration++;
        this._positionCancel?.cancel();
        this._positionCancel = null;
    }

    _refreshPosition(proxy) {
        // MPRIS Position does not emit PropertiesChanged. A proxy's cached
        // value may still be the sample taken when the player was discovered.
        this._cancelPositionRead();
        const generation = this._positionGeneration, trackId = this._trackId;
        this._positionCancel = new Gio.Cancellable();
        proxy.call('org.freedesktop.DBus.Properties.Get',
            new GLib.Variant('(ss)', [PLAYER, 'Position']), Gio.DBusCallFlags.NONE,
            2500, this._positionCancel, (p, result) => {
                let value;
                try { value = unpack(p.call_finish(result).deep_unpack()[0]); }
                catch { /* Keep the last estimate if this player cannot answer. */ }
                if (!this._alive || generation !== this._positionGeneration ||
                    this._proxies.get(this._selected) !== p || trackId !== this._trackId) return;
                this._positionCancel = null;
                if (!Number.isFinite(value) || value < 0) return;
                this._rebasePosition(p, value);
                this._sync();
            });
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
        const eligible = players.filter(p => p.status === 'Playing' || (p.status === 'Paused' && p.title));
        if (!eligible.some(p => p.name === this._preferred)) this._preferred = null;
        const selected = eligible.find(p => p.name === this._preferred) ?? selectPlayer(players, this._selected);
        if (!selected) {
            this._cancelPositionRead();
            this._positionProxy = null;
            this._selected = null;
            this._playing = false;
            this._positionUs = 0;
            this._lengthUs = 0;
            this._trackId = null;
            this._canSeek = false;
            this._dropQueue();
            this._onChange({available: false});
            return;
        }
        const {name, proxy} = selected;
        const meta = this._prop(proxy, 'Metadata') ?? {};
        const trackId = unpack(meta['mpris:trackid']) ?? null;
        const changed = name !== this._selected || proxy !== this._positionProxy || trackId !== this._trackId;
        const status = this._prop(proxy, 'PlaybackStatus') || 'Stopped';
        const playbackChanged = this._playing !== (status === 'Playing');
        if (changed) {
            // New player or new track: restart the progress model.
            this._error = '';
            this._pending.clear();
            this._selected = name;
            this._positionProxy = proxy;
            this._trackId = trackId;
            this._lengthUs = Number(unpack(meta['mpris:length']) ?? 0);
            this._rebasePosition(proxy);
        } else {
            this._lengthUs = Number(unpack(meta['mpris:length']) ?? this._lengthUs);
        }
        // Freeze the estimated position at pause and restart its clock at play.
        // A cached Position is often stale when only PlaybackStatus changes.
        if (!changed && playbackChanged) {
            this._positionUs = this.positionSec() * 1e6;
            this._positionAt = monotonicSec();
        }
        this._playing = status === 'Playing';
        if (changed || playbackChanged) this._refreshPosition(proxy);
        const canControl = Boolean(this._prop(proxy, 'CanControl'));
        const artists = unpack(meta['xesam:artist']);
        this._canSeek = canControl && Boolean(this._prop(proxy, 'CanSeek'));
        const root = this._roots.get(name);
        const playerName = this._prop(root, 'Identity') || name.replace(PREFIX, '').split('.')[0];
        this._onChange({
            available: true,
            playerName, playerId: name, trackId, pinned: this._preferred,
            players: eligible.map(p => ({id: p.name,
                name: this._prop(this._roots.get(p.name), 'Identity') || p.name.replace(PREFIX, '').split('.')[0],
                status: p.status})),
            album: String(unpack(meta['xesam:album']) || ''),
            canRaise: Boolean(this._prop(root, 'CanRaise')),
            hasTrackList: Boolean(this._prop(root, 'HasTrackList')),
            shuffle: typeof this._prop(proxy, 'Shuffle') === 'boolean' ? this._prop(proxy, 'Shuffle') : null,
            loopStatus: ['None', 'Track', 'Playlist'].includes(this._prop(proxy, 'LoopStatus'))
                ? this._prop(proxy, 'LoopStatus') : null,
            pending: [...this._pending], error: this._error,
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
            canPlayPause: canControl && this._prop(proxy, status === 'Playing' ? 'CanPause' : 'CanPlay') !== false,
        });
        this._syncQueue();
    }

    // Live position estimate; the UI polls this once per second while expanded.
    positionSec() {
        return estimatePositionSec(this._positionUs, this._positionAt, monotonicSec(), this._playing);
    }

    seek(seconds) {
        const proxy = this._proxies.get(this._selected);
        if (!proxy || !this._canSeek || !this._trackId || !Number.isFinite(seconds)) return;
        let us = Math.max(0, Math.round(seconds * 1e6));
        if (this._lengthUs > 0) us = Math.max(0, Math.min(this._lengthUs - 1, us));
        const generation = ++this._seekGeneration, trackId = this._trackId;
        const previous = [this._positionUs, this._positionAt];
        this._cancelPositionRead();
        proxy.call('SetPosition', new GLib.Variant('(ox)', [this._trackId, us]),
            Gio.DBusCallFlags.NONE, 2500, this._cancellable, (p, result) => {
                if (!this._alive) return;
                try {
                    p.call_finish(result);
                } catch {
                    if (generation !== this._seekGeneration || trackId !== this._trackId || this._proxies.get(this._selected) !== p) return;
                    [this._positionUs, this._positionAt] = previous;
                    this._error = 'Could not seek in this player.';
                    this._sync();
                }
            });
        // Optimistic rebase; the player confirms it with a Seeked signal.
        this._positionUs = us;
        this._positionAt = monotonicSec();
        this._sync();
    }

    command(method) {
        if (!COMMANDS.includes(method)) return;
        const proxy = this._proxies.get(this._selected);
        if (!proxy) return;
        if (!this._prop(proxy, 'CanControl')) return;
        if (method === 'PlayPause' && this._prop(proxy, this._playing ? 'CanPause' : 'CanPlay') === false) return;
        if (method === 'Previous' && !this._prop(proxy, 'CanGoPrevious')) return;
        if (method === 'Next' && !this._prop(proxy, 'CanGoNext')) return;
        this._call(proxy, method, null, 'Playback');
    }

    _addRoot(name, player) {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE,
            null, name, PATH, ROOT, this._cancellable, (source, result) => {
                if (!this._alive || this._proxies.get(name) !== player) return;
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._forgetRoot(name);
                    proxy._islandSignal = proxy.connect('g-properties-changed', () => this._sync());
                    this._roots.set(name, proxy);
                    this._sync();
                } catch { /* Some minimal players expose only Player. */ }
            });
    }

    _forgetRoot(name) {
        const root = this._roots.get(name);
        if (root) root.disconnect(root._islandSignal);
        this._roots.delete(name);
    }

    select(name = null) {
        if (name !== null && !this._proxies.has(name)) return;
        this._preferred = name;
        this._sync();
    }

    raise() {
        const root = this._roots.get(this._selected);
        if (this._prop(root, 'CanRaise')) this._call(root, 'Raise', null, 'Open player');
    }

    setProperty(property, value) {
        const proxy = this._proxies.get(this._selected);
        if (!proxy || !this._prop(proxy, 'CanControl') || this._pending.has(property)) return;
        if (property === 'Shuffle' && (typeof value !== 'boolean' || typeof this._prop(proxy, property) !== 'boolean')) return;
        if (property === 'LoopStatus' && (!['None', 'Track', 'Playlist'].includes(value) || this._prop(proxy, property) == null)) return;
        if (!['Shuffle', 'LoopStatus'].includes(property)) return;
        this._pending.add(property);
        this._call(proxy, 'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [PLAYER, property, new GLib.Variant(property === 'Shuffle' ? 'b' : 's', value)]), property);
        this._sync();
    }

    _call(proxy, method, parameters, operation) {
        const name = this._selected;
        this._error = '';
        proxy.call(method, parameters, Gio.DBusCallFlags.NONE, 2500, this._cancellable, (p, result) => {
            if (!this._alive) return;
            let failed = false;
            try { p.call_finish(result); } catch { failed = true; }
            if (name !== this._selected || ![this._roots.get(name), this._proxies.get(name), this._queueProxy].includes(p)) return;
            this._pending.delete(operation);
            if (failed) this._error = `${operation} is unavailable in this player.`;
            this._sync();
        });
    }

    setQueueActive(active) {
        this._queueActive = Boolean(active);
        this._syncQueue();
    }

    _dropQueue() {
        this._queueGeneration++;
        this._queueCancel?.cancel();
        this._queueCancel = null;
        if (this._queueProxy) for (const id of this._queueSignals) this._queueProxy.disconnect(id);
        this._queueProxy = null;
        this._queueName = null;
        this._queueIds = [];
        this._queueBusy = false;
        this._queueDirty = false;
    }

    _syncQueue() {
        if (!this._queueActive || !this._alive || !this._selected) {
            if (this._queueName) this._dropQueue();
            return;
        }
        const supported = Boolean(this._prop(this._roots.get(this._selected), 'HasTrackList'));
        if (this._queueName === this._selected && this._queueTrack === this._trackId && this._queueSupported === supported) return;
        this._dropQueue();
        this._queueName = this._selected;
        this._queueTrack = this._trackId;
        this._queueSupported = supported;
        if (!supported) {
            this._onQueue({message: 'This player does not share its track list.', tracks: []});
            return;
        }
        this._onQueue({message: 'Loading tracks…', tracks: []});
        this._queueCancel = new Gio.Cancellable();
        const generation = this._queueGeneration;
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE,
            null, this._selected, PATH, TRACKS, this._queueCancel, (source, result) => {
                if (generation !== this._queueGeneration || !this._alive) return;
                try {
                    this._queueProxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._queueSignals = [this._queueProxy.connect('g-properties-changed', () => this._refreshQueue()),
                        this._queueProxy.connect('g-signal', (p, sender, signal, args) => this._queueSignal(signal, args))];
                    this._refreshQueue();
                } catch { this._onQueue({message: 'Track list unavailable.', tracks: []}); }
            });
    }

    _queueSignal(signal, args) {
        // Tracks does not emit PropertiesChanged in MPRIS. Maintain its cached
        // value from the mandatory TrackList signals before requesting metadata.
        let ids = [...(this._prop(this._queueProxy, 'Tracks') ?? [])];
        const values = args.deep_unpack();
        if (signal === 'TrackListReplaced') ids = values[0];
        else if (signal === 'TrackRemoved') ids = ids.filter(id => id !== values[0]);
        else if (signal === 'TrackAdded') {
            const id = unpack(values[0]['mpris:trackid']);
            if (id && !ids.includes(id)) ids.splice(ids.indexOf(values[1]) + 1, 0, id);
        }
        this._queueProxy.set_cached_property('Tracks', new GLib.Variant('ao', ids));
        this._refreshQueue();
    }

    _refreshQueue() {
        if (this._queueBusy) { this._queueDirty = true; return; }
        const proxy = this._queueProxy;
        if (!proxy) return;
        const all = this._prop(proxy, 'Tracks') ?? [];
        const start = Math.max(0, all.indexOf(this._trackId) + 1);
        const ids = all.slice(start, start + 20);
        this._queueIds = ids;
        if (!ids.length) { this._onQueue({message: 'No upcoming tracks shared by this player.', tracks: []}); return; }
        this._queueBusy = true;
        const generation = this._queueGeneration;
        proxy.call('GetTracksMetadata', new GLib.Variant('(ao)', [ids]), Gio.DBusCallFlags.NONE,
            2500, this._queueCancel, (p, result) => {
                if (generation !== this._queueGeneration || !this._alive) return;
                this._queueBusy = false;
                try {
                    const [metadata] = p.call_finish(result).deep_unpack();
                    this._onQueue({message: 'Player order · shuffle may differ', tracks: metadata.slice(0, 20).map((meta, i) => ({
                        id: ids[i], title: String(unpack(meta['xesam:title']) || 'Untitled track').slice(0, 512),
                        artist: String(unpack(meta['xesam:artist']) || '').slice(0, 512),
                        canPlay: Boolean(this._prop(this._proxies.get(this._selected), 'CanControl')),
                    }))});
                } catch { this._onQueue({message: 'Could not read the track list.', tracks: []}); }
                if (this._queueDirty) { this._queueDirty = false; this._refreshQueue(); }
            });
    }

    playTrack(id) {
        if (!this._queueIds?.includes(id) || !this._prop(this._proxies.get(this._selected), 'CanControl')) return;
        this._call(this._queueProxy, 'GoTo', new GLib.Variant('(o)', [id]), 'Play track');
    }

    stop() {
        this._alive = false;
        this._cancelPositionRead();
        this._positionProxy = null;
        this._dropQueue();
        for (const name of this._roots.keys()) this._forgetRoot(name);
        this._pending.clear();
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
