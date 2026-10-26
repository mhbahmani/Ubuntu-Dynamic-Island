import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selectPlayer} from '../services/presentation.js';
import {estimatePositionSec} from '../services/format.js';

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
