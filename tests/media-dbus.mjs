// Run with dbus-run-session -- gjs -m tests/media-dbus.mjs. No host players.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {MediaService} from '../services/media.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function until(predicate, message) {
    for (let i = 0; i < 80; i++) { if (predicate()) return; await delay(25); }
    throw new Error(message);
}
const path = '/org/mpris/MediaPlayer2';
const name = 'org.mpris.MediaPlayer2.IslandTest';
const iface = 'org.mpris.MediaPlayer2';
const prop = (name, type, access = 'read') => `<property name="${name}" type="${type}" access="${access}"/>`;
const wrap = (name, members, object) => {
    const exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${name}">${members}</interface></node>`, object);
    exported.export(Gio.DBus.session, path);
    return exported;
};
const metadata = id => ({'mpris:trackid': new GLib.Variant('o', id), 'mpris:length': new GLib.Variant('x', 240e6),
    'xesam:title': new GLib.Variant('s', `Song ${id.split('/').pop()}`), 'xesam:artist': new GLib.Variant('as', ['Sample artist'])});
let raised = 0, queueReads = 0, goto = null, shuffle = false, loopStatus = 'None';
let current = '/track/1', position = 30e6, tracks = ['/track/1', '/track/2', '/track/3'];
const root = wrap(iface, prop('Identity', 's') + prop('CanRaise', 'b') + prop('HasTrackList', 'b') + '<method name="Raise"/>', {
    Identity: 'Island test player', CanRaise: true, HasTrackList: true, Raise() { raised++; },
});
const player = wrap(`${iface}.Player`,
    ['PlaybackStatus:s', 'Metadata:a{sv}', 'Position:x', 'CanControl:b', 'CanSeek:b', 'CanGoPrevious:b', 'CanGoNext:b', 'CanPlay:b', 'CanPause:b']
        .map(p => prop(...p.split(':'))).join('') + prop('Shuffle', 'b', 'readwrite') + prop('LoopStatus', 's', 'readwrite') +
    '<method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>' +
    '<signal name="Seeked"><arg type="x"/></signal>', {
        PlaybackStatus: 'Paused', CanControl: true, CanSeek: true, CanGoNext: true, CanGoPrevious: true, CanPlay: true, CanPause: true,
        get Metadata() { return metadata(current); }, get Position() { return position; },
        get Shuffle() { return shuffle; }, set Shuffle(value) { shuffle = value; player.emit_property_changed('Shuffle', new GLib.Variant('b', value)); },
        get LoopStatus() { return loopStatus; }, set LoopStatus(value) { loopStatus = value; player.emit_property_changed('LoopStatus', new GLib.Variant('s', value)); },
        SetPosition(id, value) { assert(id === current, 'Seek targeted wrong track'); position = value; player.emit_signal('Seeked', new GLib.Variant('(x)', [value])); },
    });
const list = wrap(`${iface}.TrackList`, prop('Tracks', 'ao') +
    '<method name="GetTracksMetadata"><arg type="ao" direction="in"/><arg type="aa{sv}" direction="out"/></method>' +
    '<method name="GoTo"><arg type="o" direction="in"/></method>' +
    '<signal name="TrackListReplaced"><arg type="ao"/><arg type="o"/></signal>', {
        get Tracks() { return tracks; },
        GetTracksMetadataAsync([ids], invocation) { queueReads++; invocation.return_value(new GLib.Variant('(aa{sv})', [ids.map(metadata)])); },
        GoTo(id) { goto = id; },
    });
const owner = Gio.bus_own_name_on_connection(Gio.DBus.session, name, Gio.BusNameOwnerFlags.NONE, null, null);
let state, queue;
const service = new MediaService(value => { state = value; }, value => { queue = value; });
const mainLoop = new GLib.MainLoop(null, false);
let exitCode = 0;
(async () => {
    try {
        service.start();
        await until(() => state?.canRaise, 'Root interface did not load');
        assert(state.playerName === 'Island test player', 'Identity not used');
        assert(state.shuffle === false && state.loopStatus === 'None', 'Optional playback properties missing');
        service.setProperty('Shuffle', true);
        service.setProperty('LoopStatus', 'Track');
        await until(() => state.shuffle && state.loopStatus === 'Track' && !state.pending.length, 'Property writes failed');
        service.raise();
        await until(() => raised === 1, 'Raise failed');
        service.seek(90);
        await until(() => position === 90e6, 'SetPosition failed');
        assert(queueReads === 0, 'Hidden queue fetched metadata');
        service.setQueueActive(true);
        await until(() => queue?.tracks?.length === 2, 'Track list did not load');
        assert(queue.tracks[0].id === '/track/2', 'Queue includes current or wrong track');
        service.playTrack('/track/2');
        await until(() => goto === '/track/2', 'GoTo failed');
        tracks = ['/track/1', '/track/3'];
        list.emit_signal('TrackListReplaced', new GLib.Variant('(aoo)', [tracks, current]));
        await until(() => queue.tracks.length === 1, 'TrackListReplaced did not update cache');
        service.setQueueActive(false);
        const reads = queueReads;
        list.emit_signal('TrackListReplaced', new GLib.Variant('(aoo)', [tracks, current]));
        await delay(80);
        assert(queueReads === reads, 'Hidden queue kept requesting');
        print('PASS: native MPRIS discovery, properties, Raise, seek, track list, GoTo and hidden cleanup');
    } catch (error) { printerr(error.stack); exitCode = 1; }
    finally {
        service.stop();
        root.unexport(); player.unexport(); list.unexport(); Gio.bus_unown_name(owner);
        mainLoop.quit();
    }
})();
mainLoop.run();
System.exit(exitCode);
