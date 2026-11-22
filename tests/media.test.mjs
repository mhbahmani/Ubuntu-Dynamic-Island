import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selectPlayer, mediaTitle} from '../extension/services/presentation.js';
import {estimatePositionSec, formatTime, clampFraction} from '../extension/services/format.js';

// Evaluate the real service classes with GI boundaries replaced by fakes.
// No Shell session, D-Bus changes, or developer-machine hardware is required.
function service(file, name, dependencies) {
    const source = readFileSync(new URL(`../extension/services/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    return vm.runInNewContext(`${source}\n${name}`, {...dependencies, console,
        Gio: {DBusCallFlags: {NONE: 0}, Cancellable: class {
            cancel() { this.cancelled = true; }
        }, ...dependencies.Gio},
        GLib: {Variant: class { constructor(type, value) { this.value = value; } }, ...fakeTimers(), ...dependencies.GLib},
    });
}

// Manual GLib timeout sources: tests fire them explicitly with run().
function fakeTimers() {
    const sources = new Map();
    let next = 1;
    return {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, sources,
        timeout_add(priority, ms, callback) { sources.set(next, {ms, callback}); return next++; },
        source_remove(id) { sources.delete(id); },
        run() {
            for (const [id, source] of [...sources]) {
                sources.delete(id);
                source.callback();
            }
        },
    };
}

test('media position freezes on pause, resumes without jumping, and ignores idle registrations', () => {
    let now = 10;
    let state;
    const timers = fakeTimers();
    const Media = service('media', 'MediaService', {
        selectPlayer, mediaTitle, estimatePositionSec, GLib: {...timers, get_monotonic_time: () => now * 1e6},
    });
    const media = new Media(value => { state = value; });
    const props = {PlaybackStatus: 'Playing', Position: 2e6,
        Metadata: {'xesam:title': 'Song', 'xesam:artist': 'Artist', 'mpris:trackid': '/track/1', 'mpris:length': 100e6},
        CanControl: true, CanSeek: true};
    media._alive = true;
    media._proxies.set('music', {get_cached_property: name => props[name], call() {}});
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
    timers.run();
    assert.equal(state.available, false);
    assert.equal(media._canSeek, false);
});

test('a brief player gap during a track change keeps media available', () => {
    let now = 10;
    const states = [];
    const timers = fakeTimers();
    const Media = service('media', 'MediaService', {
        selectPlayer, mediaTitle, estimatePositionSec, GLib: {...timers, get_monotonic_time: () => now * 1e6},
    });
    const media = new Media(value => states.push(value));
    const track = id => ({'xesam:title': `Song ${id}`, 'mpris:trackid': `/track/${id}`, 'mpris:length': 100e6});
    const props = {PlaybackStatus: 'Playing', Position: 0, Metadata: track(1), CanControl: true, CanGoNext: true};
    const browser = {get_cached_property: name => props[name], call() {}, _islandSignals: [], disconnect() {}};
    media._alive = true;
    media._proxies.set('browser', browser);
    media._sync();
    now = 14;
    // Browsers clear metadata and pause, or drop their bus name, while
    // Spotify Web loads the next track.
    props.PlaybackStatus = 'Paused';
    props.Metadata = {};
    media._sync();
    media._proxies.delete('browser');
    media._sync();
    assert.equal(timers.sources.size, 1, 'One bounded grace timer covers the gap');
    assert.ok(states.every(state => state.available), 'The gap must not publish missing media');
    now = 20;
    assert.equal(media.positionSec(), 4, 'The progress clock freezes during the gap');
    props.PlaybackStatus = 'Playing';
    props.Metadata = track(2);
    media._proxies.set('browser', browser);
    media._sync();
    assert.equal(timers.sources.size, 0, 'Recovery cancels the grace timer');
    assert.equal(states.at(-1).title, 'Song 2');
    assert.equal(media.positionSec(), 0);
    assert.ok(states.every(state => state.available));

    // A genuine stop still hides media once the grace period ends.
    props.PlaybackStatus = 'Stopped';
    media._sync();
    assert.equal(states.at(-1).available, true);
    timers.run();
    assert.equal(states.at(-1).available, false);
    assert.equal(timers.sources.size, 0);
    // Idle registrations publish immediately when nothing was showing.
    media._sync();
    assert.equal(timers.sources.size, 0);

    // Stopping the service removes a pending grace timer.
    props.PlaybackStatus = 'Playing';
    media._sync();
    props.PlaybackStatus = 'Stopped';
    media._sync();
    assert.equal(timers.sources.size, 1);
    media.stop();
    assert.equal(timers.sources.size, 0);
});

test('the card returns to a page that left only because it became unavailable', () => {
    const cardUrl = new URL('../extension/ui/card.js', import.meta.url);
    const source = readFileSync(cardUrl, 'utf8')
        .replaceAll('import.meta.url', JSON.stringify(cardUrl.href))
        .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    const iconFile = {get_parent() { return this; }, resolve_relative_path() { return this; }};
    const Card = vm.runInNewContext(`${source}\nCard`, {
        Gio: {File: {new_for_uri: () => iconFile}, FileIcon: class {}},
    });
    const card = Object.create(Card.prototype);
    const page = () => ({available: true, box: {}});
    const styles = {add_style_class_name() {}, remove_style_class_name() {}, set_style_class_name() {}};
    Object.assign(card, {
        _pages: new Map([['media', page()], ['system', page()], ['audio', page()]]),
        _tabs: new Map(), _actions: {}, _scroll: {}, _scrollStack: {}, actor: styles, _body: styles,
        _page: null, _fallbackFrom: null,
        _queueNavigationFit() {}, updateMediaTint() {}, _placeSlider() {}, _revealPage() {}, _queueSliderSnap() {},
    });
    const setMedia = available => { card._pages.get('media').available = available; card._syncPages(); };
    card.selectPage('media');
    setMedia(false);
    assert.equal(card._page, 'system');
    setMedia(true);
    assert.equal(card._page, 'media', 'A returning player restores the selected Media tab');
    setMedia(false);
    card.selectPage('audio');
    setMedia(true);
    assert.equal(card._page, 'audio', 'A later user choice wins over the lost page');
    // Disabling a module removes its page; re-enabling it keeps the current tab.
    const calendar = page();
    card._pages.set('calendar', calendar);
    card.selectPage('calendar');
    card._pages.delete('calendar');
    card._syncPages();
    assert.equal(card._page, 'media');
    card._pages.set('calendar', calendar);
    card._syncPages();
    assert.equal(card._page, 'media', 'Re-enabling a module must not change the current tab');
});

test('media updates render seek, pause, resume and new tracks without a zero frame', () => {
    const cardUrl = new URL('../extension/ui/card.js', import.meta.url);
    const source = readFileSync(cardUrl, 'utf8')
        .replaceAll('import.meta.url', JSON.stringify(cardUrl.href))
        .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    // Navigation's SVG is initialized at module load; keep its GI boundary fake.
    const iconFile = {get_parent() { return this; }, resolve_relative_path() { return this; }};
    const Card = vm.runInNewContext(`${source}\nCard`, {
        formatTime, clampFraction, setEnabled() {},
        Gio: {File: {new_for_uri: () => iconFile}, FileIcon: class {}},
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
        selectPlayer, mediaTitle, estimatePositionSec,
        GLib: {get_monotonic_time: () => now * 1e6,
            Variant: class { constructor(type, value) { this.value = value; } }},
        Gio: {DBusCallFlags: {NONE: 0}},
    });
    const media = new Media(state => card.renderMedia(state));
    const props = {PlaybackStatus: 'Playing', Position: 30e6,
        Metadata: {'xesam:title': 'Song', 'mpris:trackid': '/track/1', 'mpris:length': 100e6},
        CanControl: true, CanSeek: true};
    const proxy = {get_cached_property: name => props[name],
        call: (method, params) => {
            if (method === 'SetPosition') calls.push([method, Array.from(params.value)]);
        }};
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
    card._seekIdentity = card._mediaIdentity;
    card._progressTrack.value = 0.8;
    media._sync();
    assert.equal(card._progressTrack.value, 0.8, 'Updates must not move a dragged thumb');
    assert.equal(card._elapsed.text, '1:20', 'Timer must not overwrite the seek preview');
    card._draggingProgress = false;
    props.Metadata['mpris:trackid'] = '/track/2';
    props.Position = 0;
    media._sync();
    assert.equal(card._progressTrack.value, 0, 'A new track must not retain old progress');

    card._lengthSec = 301;
    card.renderProgress(324);
    assert.equal(card._elapsed.text, '5:01', 'Elapsed text must not exceed the known track length');
    assert.equal(card._progressTrack.value, 1);
    card._lengthSec = null;
    card.renderProgress(324);
    assert.equal(card._elapsed.text, '5:24', 'Unknown-duration streams must retain their position');
    props.Metadata['mpris:length'] = Number(2n ** 63n - 1n);
    media._sync();
    assert.equal(card._total.text, 'Live');
    assert.equal(card._progressTrack.value, 1);
    assert.equal(card._canSeek, false);
    assert.equal(card._lengthSec, null);
    media.seek(50);
    assert.equal(calls.length, 1, 'Live stream emitted an invalid seek');
    props.Metadata['mpris:length'] = 240e6;
    media._sync();
    assert.equal(card._total.text, '4:00');
    assert.equal(card._canSeek, true);
    delete props.Metadata['mpris:length'];
    media._sync();
    assert.equal(card._total.text, '–:––', 'Unknown duration must not inherit live or finite duration');

});

test('manual player selection can pin a paused app and falls back when it disappears', () => {
    let state;
    const Media = service('media', 'MediaService', {selectPlayer, mediaTitle, estimatePositionSec,
        GLib: {get_monotonic_time: () => 0}});
    const media = new Media(value => { state = value; });
    const proxy = (title, status) => ({get_cached_property: name => ({
        Metadata: {'xesam:title': title}, PlaybackStatus: status, CanControl: true,
    })[name], call() {}});
    media._alive = true;
    media._proxies.set('playing', proxy('Song', 'Playing'));
    media._proxies.set('paused', proxy('Podcast', 'Paused'));
    media._sync();
    assert.equal(state.playerId, 'playing');
    media.select('paused');
    assert.equal(state.playerId, 'paused');
    assert.equal(state.pinned, 'paused');
    media.select(null);
    assert.equal(state.playerId, 'playing');
    media.select('paused');
    media._proxies.delete('paused');
    media._sync();
    assert.equal(state.playerId, 'playing');
    assert.equal(state.pinned, null);
    assert.equal(state.shuffle, null);
    assert.equal(state.loopStatus, null);
});

test('failed property changes clear pending state, and unsupported controls never call D-Bus', () => {
    let state, complete;
    const calls = [];
    const Media = service('media', 'MediaService', {selectPlayer, mediaTitle, estimatePositionSec,
        Gio: {DBusCallFlags: {NONE: 0}}, GLib: {get_monotonic_time: () => 0,
            Variant: class { constructor(type, value) { this.value = value; } }}});
    const media = new Media(value => { state = value; });
    const props = {Metadata: {'xesam:title': 'Song'}, PlaybackStatus: 'Paused', CanControl: true};
    const proxy = {get_cached_property: name => props[name],
        call(method, parameters, flags, timeout, cancel, callback) {
            if (method === 'org.freedesktop.DBus.Properties.Get') return;
            calls.push(method); complete = () => callback(proxy, {});
        },
        call_finish() { throw new Error('Unsupported'); }};
    media._alive = true;
    media._proxies.set('music', proxy);
    media._sync();
    media.setProperty('Shuffle', true);
    media.setProperty('Volume', 0);
    media.raise();
    assert.equal(calls.length, 0);
    props.Shuffle = false;
    media.setProperty('Shuffle', true);
    assert.equal(state.pending[0], 'Shuffle');
    complete();
    assert.equal(state.pending.length, 0);
    assert.match(state.error, /unavailable/);
    assert.equal(state.shuffle, false);
    props.CanControl = false;
    media.setProperty('Shuffle', true);
    assert.equal(calls.length, 1);
});

function positionFixture() {
    let now = 10, state;
    const reads = [], seeks = [];
    const Media = service('media', 'MediaService', {
        selectPlayer, mediaTitle, estimatePositionSec,
        GLib: {get_monotonic_time: () => now * 1e6},
    });
    const media = new Media(value => { state = value; });
    media._alive = true;
    const add = (name, status, position) => {
        const props = {PlaybackStatus: status, Position: position * 1e6,
            Metadata: {'xesam:title': name, 'mpris:trackid': '/track/1', 'mpris:length': 300e6},
            CanControl: true, CanSeek: true};
        const proxy = {
            _islandSignals: [],
            get_cached_property: key => props[key],
            call(method, parameters, flags, timeout, cancel, callback) {
                if (method === 'SetPosition') {
                    seeks.push({fail() { callback(proxy, new Error('Old seek failed')); }});
                    return;
                }
                if (method !== 'org.freedesktop.DBus.Properties.Get') return;
                assert.deepEqual(Array.from(parameters.value), ['org.mpris.MediaPlayer2.Player', 'Position']);
                assert.equal(timeout, 2500);
                reads.push({name, cancel, reply(seconds) {
                    callback(proxy, seconds instanceof Error ? seconds : seconds * 1e6);
                }});
            },
            call_finish(result) {
                if (result instanceof Error) throw result;
                return {deep_unpack: () => [{deep_unpack: () => result}]};
            },
        };
        media._proxies.set(name, proxy);
        return {props, proxy};
    };
    const browser = add('browser', 'Playing', 30);
    const telegram = add('telegram', 'Paused', 0);
    return {media, browser, telegram, reads, seeks, get state() { return state; }, advance(seconds) { now += seconds; }};
}

test('external next-track metadata resets a reused track ID without carrying the old position', () => {
    const f = positionFixture();
    f.media._sync();
    f.reads.at(-1).reply(280);
    const reads = f.reads.length;
    const revision = f.state.trackRevision;
    f.advance(44);
    f.browser.props.Metadata['xesam:title'] = 'Next song from headphones';
    f.browser.props.Metadata['mpris:length'] = 301e6;
    // Keep both the track ID and the proxy's discovery-time Position unchanged.
    f.media._sync();
    assert.equal(f.state.positionSec, 0, 'New track inherited old progress');
    assert.notEqual(f.state.trackRevision, revision);
    assert.equal(f.reads.length, reads + 1, 'Metadata transition did not request the live position');
    f.reads.at(-1).reply(7);
    f.advance(2);
    assert.equal(f.media.positionSec(), 9);
    f.browser.props.Metadata['mpris:artUrl'] = 'file:///cover-arrived-later.png';
    f.media._sync();
    assert.equal(f.media.positionSec(), 9, 'Artwork arrival reset playback');
    assert.equal(f.reads.length, reads + 1, 'Artwork caused an unnecessary position read');
});

test('late reads and failed seeks cannot restore the previous track when IDs are reused', () => {
    const f = positionFixture();
    f.media._sync();
    const oldRead = f.reads.at(-1);
    f.browser.props.Metadata['xesam:url'] = 'file:///next.ogg';
    f.media._sync();
    f.reads.at(-1).reply(5);
    oldRead.reply(250);
    assert.equal(f.media.positionSec(), 5);
    f.media.seek(180);
    f.browser.props.Metadata['xesam:url'] = 'file:///third.ogg';
    f.media._sync();
    f.reads.at(-1).reply(2);
    f.seeks.at(-1).fail();
    assert.equal(f.media.positionSec(), 2, 'Old seek error restored the previous track position');
    assert.equal(f.state.error, '');
});

test('playback estimates stay within known duration without truncating unknown-duration streams', () => {
    const f = positionFixture();
    f.media._sync();
    f.reads.at(-1).reply(290);
    f.advance(34);
    assert.equal(f.media.positionSec(), 300);
    f.browser.props.Metadata['mpris:length'] = 0;
    f.media._sync();
    assert.equal(f.media.positionSec(), 324);
});

test('an explicit position received with new metadata wins over the old cached sample', () => {
    const f = positionFixture();
    f.media._sync();
    const reads = f.reads.length;
    f.browser.props.Metadata['xesam:title'] = 'New metadata with position';
    f.media._sync({proxy:f.browser.proxy, us:9e6});
    assert.equal(f.state.positionSec, 9);
    assert.equal(f.reads.length, reads, 'An explicit sample should not trigger a redundant read');
    f.reads.at(-1).reply(240);
    assert.equal(f.state.positionSec, 9, 'Old read overwrote the explicit position');
});

test('switching to a paused player and resuming reads its live position instead of cached zero', () => {
    const f = positionFixture();
    f.media._sync();
    f.reads.at(-1).reply(45);
    f.media.select('telegram');
    assert.equal(f.reads.at(-1).name, 'telegram');
    f.reads.at(-1).reply(82);
    assert.equal(f.state.positionSec, 82);
    f.advance(5);
    assert.equal(f.media.positionSec(), 82);
    f.telegram.props.PlaybackStatus = 'Playing';
    f.media._sync();
    assert.equal(f.state.positionSec, 82, 'Resume must retain progress while fetching');
    f.reads.at(-1).reply(96);
    f.advance(3);
    assert.equal(f.media.positionSec(), 99);
    assert.equal(f.telegram.props.Position, 0, 'Fixture must keep the D-Bus cache stale');
    const count = f.reads.length;
    f.media._sync();
    f.media.positionSec();
    assert.equal(f.reads.length, count, 'Progress ticks and unrelated updates must not poll D-Bus');
    f.media.select('browser');
    f.reads.at(-1).reply(140);
    assert.equal(f.state.positionSec, 140);
});

test('late position replies cannot overwrite a newer selection, track, or seek', () => {
    const f = positionFixture();
    f.media._sync();
    const first = f.reads.at(-1);
    f.media.select('telegram');
    const second = f.reads.at(-1);
    f.media.select('browser');
    f.reads.at(-1).reply(50);
    first.reply(1); second.reply(2);
    assert.equal(f.state.positionSec, 50, 'Switching away and back must invalidate the first request');
    assert.ok(first.cancel.cancelled && second.cancel.cancelled);

    f.browser.props.PlaybackStatus = 'Paused';
    f.media._sync();
    const beforeTrack = f.reads.at(-1);
    f.browser.props.Metadata['mpris:trackid'] = '/track/2';
    f.media._sync();
    const beforeSeek = f.reads.at(-1);
    f.media.seek(120);
    beforeTrack.reply(3); beforeSeek.reply(4);
    assert.equal(f.state.positionSec, 120, 'Old reads must not undo a seek');
    assert.ok(beforeTrack.cancel.cancelled && beforeSeek.cancel.cancelled);

    f.browser.props.PlaybackStatus = 'Playing';
    f.media._sync();
    const beforeSignal = f.reads.at(-1);
    f.media._rebasePosition(f.browser.proxy, 150e6); // Seeked
    f.media._sync();
    beforeSignal.reply(5);
    assert.equal(f.state.positionSec, 150, 'Seeked must win over an outstanding read');
});

test('failed position reads preserve the estimate and stop cancels outstanding reads', () => {
    const f = positionFixture();
    f.media._sync();
    f.reads.at(-1).reply(new Error('Position unavailable'));
    f.advance(2);
    assert.equal(f.media.positionSec(), 32);
    f.media.select('telegram');
    f.reads.at(-1).reply(-1);
    assert.equal(f.media.positionSec(), 0, 'Invalid position must not enter the clock');
    f.media.select('browser');
    const pending = f.reads.at(-1), state = f.state;
    f.media.stop();
    pending.reply(200);
    assert.ok(pending.cancel.cancelled);
    assert.equal(f.state, state, 'Stopped service must not publish late replies');
});
