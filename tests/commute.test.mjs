import test from 'node:test';
import assert from 'node:assert/strict';
import {routesFrom, point, intervalMs, providerOrder, requestFor, normalizeRoute, CommuteController} from '../services/commute-model.js';
const route = {id: 'home', name: 'Home', originMode: 'fixed', origin: {latitude: 35.72, longitude: 51.33}, destination: {latitude: 35.68, longitude: 51.39}};
const response = {code: 'Ok', routes: [{duration: 1920, distance: 18400}]};
test('route input validation rejects malformed endpoints and limits saved routes', () => {
    assert.equal(point({latitude: null, longitude: 0}), null);
    assert.equal(point({latitude: 86, longitude: 0}), null);
    assert.equal(routesFrom('broken').length, 0);
    assert.equal(routesFrom([route, route]).length, 1);
    assert.equal(routesFrom([{...route, origin: null}]).length, 0);
    assert.equal(routesFrom([{...route, originMode: 'current', origin: null}]).length, 1);
    assert.equal(routesFrom(Array.from({length: 30}, (_, i) => ({...route, id: String(i)}))).length, 12);
});
test('refresh default is 15 minutes and cannot be configured under 10', () => {
    assert.equal(intervalMs(undefined), 900000); assert.equal(intervalMs(1), 600000); assert.equal(intervalMs(20), 1200000);
});
test('provider ordering uses configured independent backups and can disable fallback', () => {
    assert.deepEqual(providerOrder('auto'), ['fossgis', 'osrm']);
    assert.deepEqual(providerOrder('auto', {ors: 'key'}), ['ors', 'fossgis', 'osrm']);
    assert.deepEqual(providerOrder('graphhopper', {}, false), ['graphhopper']);
});
test('provider requests preserve coordinate order and encode keys', () => {
    assert.match(requestFor('fossgis', route.origin, route.destination).url, /51.33,35.72;51.39,35.68/);
    assert.match(requestFor('graphhopper', route.origin, route.destination, 'x&y').url, /key=x%26y/);
    assert.equal(requestFor('ors', route.origin, route.destination, 'key').headers.Authorization, 'key');
});
test('response normalization preserves traffic capability and provider units', () => {
    assert.equal(normalizeRoute('osrm', response).traffic, false);
    assert.equal(normalizeRoute('graphhopper', {paths: [{time: 1920000, distance: 18400}]}).seconds, 1920);
    assert.equal(normalizeRoute('ors', {features: [{properties: {summary: {duration: 10, distance: 30}}}]}).seconds, 10);
    assert.equal(normalizeRoute('neshan', {routes: [{legs: [{duration: {value: 60}, distance: {value: 500}}]}]}).traffic, true);
    assert.throws(() => normalizeRoute('osrm', {code: 'NoRoute'}));
    assert.throws(() => normalizeRoute('osrm', {code: 'Ok', routes: [{duration: null, distance: 10}]}));
});
function harness(fetch = async () => response) {
    let now = 1000000, cancelled = 0;
    const timers = new Map(), events = [];
    let next = 1;
    const controller = new CommuteController({fetch, keys: async () => ({}), locate: async () => route.origin,
        emit: state => events.push(state), now: () => now, cancel: () => cancelled++,
        schedule: (delay, cb) => { const id = next++; timers.set(id, {delay, cb}); return id; }, unschedule: id => timers.delete(id)});
    controller.configure(route);
    return {controller, timers, events, advance: ms => { now += ms; }, cancelled: () => cancelled};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('visible-only requests, cache reuse, manual refresh and 15 minute scheduling', async () => {
    let calls = 0; const h = harness(async () => { calls++; return response; });
    assert.equal(calls, 0); h.controller.setActive(true); await flush();
    assert.equal(calls, 1); assert.equal([...h.timers.values()][0].delay, 900000);
    h.controller.setActive(false); assert.equal(h.timers.size, 0);
    h.controller.setActive(true); await flush(); assert.equal(calls, 1);
    h.advance(6000); await h.controller.refresh(true); assert.equal(calls, 2);
    h.controller.stop(); assert.equal(h.timers.size, 0);
});
test('failed primary falls back and labels the backup honestly', async () => {
    let calls = 0; const h = harness(async () => { if (++calls === 1) throw Error('offline'); return response; });
    h.controller.setActive(true); await flush();
    assert.equal(calls, 2); assert.equal(h.controller.state.data.provider, 'osrm');
    assert.equal(h.controller.state.data.fallback, true); assert.equal(h.controller.state.data.traffic, false);
});
test('late response after hiding cannot publish or restart timers', async () => {
    let resolve; const h = harness(() => new Promise(r => { resolve = r; }));
    h.controller.setActive(true); await flush(); h.controller.setActive(false);
    resolve(response); await flush(); assert.equal(h.controller.state.data, undefined); assert.equal(h.timers.size, 0);
});
test('direction and route changes never reuse the wrong cached estimate', async () => {
    const h = harness(); h.controller.setActive(true); await flush(); h.advance(6000);
    h.controller.configure({...route, origin: route.destination, destination: route.origin}); await flush();
    assert.deepEqual(h.controller.state.data.origin, route.destination);
});
test('errors keep cached results stale and respect the refresh interval', async () => {
    let fail = false; const h = harness(async () => { if (fail) throw Error(); return response; });
    h.controller.setActive(true); await flush(); h.advance(900001); fail = true;
    await h.controller.refresh(); assert.equal(h.controller.state.stale, true); assert.equal(h.controller.state.status, 'error');
});

test('unnamed routes derive their title from endpoints, including reversal', async () => {
    const {routeTitle} = await import('../services/commute-model.js');
    const unnamed = routesFrom([{...route, name: '   ', originName: 'Work', destinationName: 'Home'}])[0];
    assert.equal(unnamed.name, '');
    assert.equal(routeTitle(unnamed), 'Work → Home');
    assert.equal(routeTitle({...unnamed, originName: 'Home', destinationName: 'Work'}), 'Home → Work');
    assert.equal(routeTitle({...unnamed, name: 'Custom'}), 'Custom');
});
test('location failure never silently sends the saved pin, explicit recovery works', async () => {
    const {useSavedStart} = await import('../services/commute-model.js');
    let calls = 0; const h = harness(async () => { calls++; return response; });
    h.controller.locate = async () => { throw Object.assign(new Error('Location Services are off.'), {code: 'location-disabled'}); };
    const moving = {...route, originMode: 'current'};
    h.controller.configure(moving); h.controller.setActive(true); await flush();
    assert.equal(calls, 0);
    assert.equal(h.controller.state.errorCode, 'location-disabled');
    h.advance(6000); h.controller.configure(useSavedStart(moving)); await flush();
    assert.equal(calls, 1); assert.equal(h.controller.state.status, 'ready');
    assert.equal(useSavedStart({...moving, origin: null}), null);
});

test('Mapbox requests traffic for departure now and normalizes seconds honestly', () => {
    const request = requestFor('mapbox', route.origin, route.destination, 'token&x');
    assert.match(request.url, /mapbox\/driving-traffic\/51.33,35.72;51.39,35.68/);
    assert.match(request.url, /depart_at=now/);
    assert.match(request.url, /access_token=token%26x/);
    const data = normalizeRoute('mapbox', {code: 'Ok', routes: [{duration: 1080, distance: 9000, duration_typical: 950}]});
    assert.equal(data.seconds, 1080); assert.equal(data.traffic, true);
    assert.equal(normalizeRoute('mapbox', response).traffic, false);
    assert.throws(() => normalizeRoute('mapbox', {code: 'NoRoute', routes: []}));
    assert.deepEqual(providerOrder('auto', {mapbox: 'token', ors: 'key'}), ['mapbox', 'ors', 'fossgis', 'osrm']);
});
test('Mapbox authorization failure falls back without calling its result traffic-aware', async () => {
    const h = harness(async url => {
        if (url.includes('api.mapbox.com')) throw Object.assign(new Error('HTTP error'), {status: 401});
        return response;
    });
    h.controller.keys = async () => ({mapbox: 'invalid'});
    h.controller.setActive(true); await flush();
    assert.equal(h.controller.state.data.provider, 'fossgis');
    assert.equal(h.controller.state.data.fallback, true); assert.equal(h.controller.state.data.traffic, false);
});
