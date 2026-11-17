import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CommuteController} from '../extension/services/commute-model.js';

const response = {code: 'Ok', routes: [{duration: 1920, distance: 18400}]};
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(fetch = async () => response) {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
    const Extension = vm.runInNewContext(`${source}\nUbuntuIsland`, {Extension: class {}});
    const extension = new Extension();
    let now = 1000000, next = 0, calls = 0;
    const timers = new Map();
    const settings = {'pill-show-commute': true};
    extension._enabled = true;
    extension._states = {};
    extension._island = {actor: {mapped: true}, expanded: false, invalidateBackdrop() {}};
    extension._card = {actor: {mapped: false}, _page: 'media', quickAskOpen: false};
    extension._settings = {get_boolean: key => Boolean(settings[key])};
    extension._renderPill = () => {};
    const controller = new CommuteController({
        fetch: (...args) => { calls++; return fetch(...args); }, cancel() {},
        keys: async () => ({}), emit: state => { extension._states.commute = state; },
        now: () => now,
        schedule: (delay, cb) => { timers.set(++next, {delay, cb}); return next; },
        unschedule: id => timers.delete(id),
    });
    controller.configure({id: 'home', originMode: 'fixed',
        origin: {latitude: 35.7, longitude: 51.3}, destination: {latitude: 35.8, longitude: 51.4}});
    extension._commute = {setActive: active => controller.setActive(active)};
    return {extension, controller, settings, timers, calls: () => calls,
        connect: state => extension._renderConnectivity(state), advance: ms => { now += ms; }};
}

test('startup waits for internet then loads the notch ETA without opening Commute', async () => {
    const h = harness();
    h.extension._syncWeather(); await flush();
    assert.equal(h.calls(), 0, 'Unknown startup connectivity must not start a request');
    for (const state of ['offline', 'limited', 'portal']) {
        h.connect(state); await flush();
        assert.equal(h.calls(), 0);
        assert.equal(h.timers.size, 0);
    }
    h.connect('online'); await flush();
    assert.equal(h.calls(), 1);
    assert.equal(h.extension._states.commute.data.seconds, 1920);
    assert.equal(h.extension._island.expanded, false);
    assert.equal(h.extension._card._page, 'media');
    assert.equal([...h.timers.values()][0].delay, 900000);
    h.controller.stop();
});

test('reconnection retries a failed startup ETA without waiting for the refresh interval', async () => {
    let fail = true;
    const h = harness(async () => { if (fail) throw new Error('No connection'); return response; });
    h.connect('online'); await flush();
    assert.equal(h.controller.state.status, 'error');
    const before = h.calls();
    h.connect('offline');
    assert.equal(h.timers.size, 0);
    h.advance(6000); fail = false;
    h.connect('online'); await flush();
    assert.equal(h.calls(), before + 1);
    assert.equal(h.controller.state.status, 'ready');
    h.controller.stop();
});

test('online signals reuse fresh ETA and do not activate hidden consumers', async () => {
    const h = harness();
    h.connect('online'); await flush();
    h.connect('offline'); h.advance(6000); h.connect('online'); await flush();
    h.connect('online'); await flush();
    assert.equal(h.calls(), 1, 'Fresh cache must survive reconnects');
    h.settings['pill-show-commute'] = false;
    h.extension._syncWeather();
    h.advance(900001); h.connect('offline'); h.connect('online'); await flush();
    assert.equal(h.calls(), 1);
    assert.equal(h.timers.size, 0);
    h.extension._island.expanded = true;
    h.extension._card.actor.mapped = true;
    h.extension._card._page = 'commute';
    h.extension._syncWeather(); await flush();
    assert.equal(h.calls(), 2, 'Opening Commute still refreshes an expired ETA');
    h.extension._island.actor.mapped = false;
    h.extension._syncWeather();
    h.connect('offline'); h.connect('online'); await flush();
    assert.equal(h.timers.size, 0, 'Unmapped consumers must remain suspended');
    h.controller.stop();
});

test('going offline cancels the active generation and ignores its late response', async () => {
    let resolve;
    const h = harness(() => new Promise(done => { resolve = done; }));
    h.connect('online'); await flush();
    h.connect('offline');
    resolve(response); await flush();
    assert.equal(h.controller.state.data, undefined);
    assert.equal(h.timers.size, 0);
    h.controller.stop();
});
