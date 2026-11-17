import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as model from '../extension/services/commute-model.js';

function harness() {
    const route = {id: 'test', originMode: 'fixed', origin: {latitude: 35.7, longitude: 51.3},
        destination: {latitude: 35.8, longitude: 51.4}, originName: 'Start', destinationName: 'End'};
    const values = {'commute-routes': JSON.stringify([route]), 'commute-selected': 'test',
        'commute-provider': 'auto', 'commute-open-with': 'google', 'commute-fallback': true,
        'commute-interval': 15, 'commute-provider-order': model.PROVIDERS};
    const signals = new Map(); let id = 0;
    const set = (key, value) => { values[key] = value; for (const [signal, callback] of signals.values()) if (signal === `changed::${key}`) callback(); };
    const settings = {get_string: key => values[key], get_int: key => values[key],
        get_strv: key => values[key], get_boolean: key => values[key], set_string: set,
        connect: (signal, callback) => { signals.set(++id, [signal, callback]); return id; },
        disconnect: id => signals.delete(id)};
    const source = readFileSync(new URL('../extension/services/commute.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Service = vm.runInNewContext(`${source}\nCommuteService`, {...model,
        WeatherHttp: class {cancel() {}}, CurrentLocation: class {cancel() {}},
        GLib: {}, Gio: {},
    });
    const events = [], service = new Service(settings, state => events.push(state));
    return {route, service, set, values, events, signals};
}

test('provider, backup and refresh changes preserve the displayed reversed route', () => {
    const h = harness();
    h.service.swap();
    h.service.selectProvider('balad');
    h.set('commute-fallback', false);
    h.set('commute-interval', 20);
    assert.equal(h.service.reversed, true);
    assert.equal(h.service.route.origin.latitude, h.route.destination.latitude);
    assert.equal(h.service.route.destination.latitude, h.route.origin.latitude);
    assert.equal(h.events.at(-1).preferred, 'balad');
    assert.equal(h.events.at(-1).allowFallback, false);
    h.service.swap();
    assert.equal(h.events.at(-1).preferred, 'balad');
    assert.equal(h.service.route.origin.latitude, h.route.origin.latitude);
    h.service.stop(); assert.equal(h.signals.size, 0);
});

test('route app changes do not restart ETA requests or reverse the journey', () => {
    const h = harness(); h.service.swap();
    const generation = h.service.controller.generation;
    h.set('commute-open-with', 'neshan');
    assert.equal(h.events.at(-1).openWith, 'neshan');
    assert.equal(h.service.controller.generation, generation);
    assert.equal(h.service.reversed, true);
    h.service.selectProvider('mapbox');
    assert.equal(h.values['commute-provider'], 'auto', 'Unconfigured providers are not selectable');
    h.service.stop();
});
