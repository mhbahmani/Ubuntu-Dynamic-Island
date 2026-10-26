import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selectPlayer} from '../services/presentation.js';
import {estimatePositionSec, formatTime, clampFraction} from '../services/format.js';

// Evaluate the real service classes with GI boundaries replaced by fakes.
// No Shell session, D-Bus changes, or developer-machine hardware is required.
function service(file, name, dependencies) {
    const source = readFileSync(new URL(`../services/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    return vm.runInNewContext(`${source}\n${name}`, {...dependencies, console});
}

test('media position freezes on pause, resumes without jumping, and ignores idle registrations', () => {
    let now = 10;
    let state;
    const Media = service('media', 'MediaService', {
        selectPlayer, estimatePositionSec, GLib: {get_monotonic_time: () => now * 1e6},
    });
    const media = new Media(value => { state = value; });
    const props = {PlaybackStatus: 'Playing', Position: 2e6,
        Metadata: {'xesam:title': 'Song', 'xesam:artist': 'Artist', 'mpris:trackid': '/track/1', 'mpris:length': 100e6},
        CanControl: true, CanSeek: true};
    media._alive = true;
    media._proxies.set('music', {get_cached_property: name => props[name]});
    media._sync();
    assert.equal(state.artist, 'Artist');
    now = 15;
    assert.equal(media.positionSec(), 7);
    props.PlaybackStatus = 'Paused';
    media._sync();
    now = 20;
    assert.equal(media.positionSec(), 7);
    props.PlaybackStatus = 'Playing';
    media._sync();
    now = 23;
    assert.equal(media.positionSec(), 10);
    props.PlaybackStatus = 'Stopped';
    media._sync();
    assert.equal(state.available, false);
    assert.equal(media._canSeek, false);
});

test('media updates render seek, pause, resume and new tracks without a zero frame', () => {
    const source = readFileSync(new URL('../card.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Card = vm.runInNewContext(`${source}\nCard`, {
        formatTime, clampFraction, setEnabled() {},
    });
    const card = Object.create(Card.prototype);
    Object.assign(card, {
        _pages: new Map([['media', {available: true}]]),
        _mediaSection: {setVisible() {}},
        _track: {}, _artist: {}, _source: {}, _play: {child: {}},
        _previous: {}, _next: {}, _elapsed: {}, _total: {},
        _progressTrack: {value: 0},
    });
    let now = 10;
    const calls = [];
    const Media = service('media', 'MediaService', {
        selectPlayer, estimatePositionSec,
        GLib: {get_monotonic_time: () => now * 1e6,
            Variant: class { constructor(type, value) { this.value = value; } }},
        Gio: {DBusCallFlags: {NONE: 0}},
    });
    const media = new Media(state => card.renderMedia(state));
    const props = {PlaybackStatus: 'Playing', Position: 30e6,
        Metadata: {'xesam:title': 'Song', 'mpris:trackid': '/track/1', 'mpris:length': 100e6},
        CanControl: true, CanSeek: true};
    const proxy = {get_cached_property: name => props[name],
        call: (method, params) => calls.push([method, Array.from(params.value)])};
    media._alive = true;
    media._proxies.set('music', proxy);
    media._sync();
    assert.equal(card._progressTrack.value, 0.3);

    now = 15;
    props.PlaybackStatus = 'Paused';
    media._sync();
    assert.equal(card._elapsed.text, '0:35');
    assert.equal(card._progressTrack.value, 0.35);
    now = 20;
    props.PlaybackStatus = 'Playing';
    media._sync();
    assert.equal(card._progressTrack.value, 0.35);

    media.seek(70);
    assert.deepEqual(calls, [['SetPosition', ['/track/1', 70e6]]]);
    // Seeked causes a full media refresh before the next one-second UI tick.
    media._rebasePosition(proxy, 70e6);
    media._sync();
    assert.equal(card._elapsed.text, '1:10');
    assert.equal(card._progressTrack.value, 0.7);

    card._draggingProgress = true;
    card._progressTrack.value = 0.8;
    media._sync();
    assert.equal(card._progressTrack.value, 0.8, 'Updates must not move a dragged thumb');
    card._draggingProgress = false;
    props.Metadata['mpris:trackid'] = '/track/2';
    props.Position = 0;
    media._sync();
    assert.equal(card._progressTrack.value, 0, 'A new track must not retain old progress');
});
