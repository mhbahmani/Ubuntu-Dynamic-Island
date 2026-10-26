import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Evaluate the real service classes with GI boundaries replaced by fakes.
// No Shell session, D-Bus changes, or developer-machine hardware is required.
function service(file, name, dependencies) {
    const source = readFileSync(new URL(`../services/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    return vm.runInNewContext(`${source}\n${name}`, {...dependencies, console});
}

test('audio seeds existing devices, removes stale outputs, and disconnects without closing the shared mixer', () => {
    let id = 0;
    const signals = new Map();
    const device = value => ({get_id: () => value, get_description: () => `Output ${value}`, get_origin: () => '', has_ports: () => true, port_available: true, connect: (name, cb) => { signals.set(`port-${value}`, cb); return ++id; }, disconnect() {}});
    const devices = new Map([[1, device(1)], [2, device(2)]]);
    const sink = {volume: 50, is_muted: false, connect: () => ++id, disconnect() {}};
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return ++id; },
        disconnect() {}, get_sinks: () => [...devices.keys()].map(value => ({device: value})),
        lookup_device_from_stream: stream => devices.get(stream === sink ? 1 : stream.device),
        lookup_output_id: value => devices.get(value),
        get_default_sink: () => sink, get_state: () => 1, get_vol_max_norm: () => 100,
        close() { assert.fail('must not close the shared mixer'); },
    };
    const Audio = service('audio', 'AudioService', {
        Gvc: {MixerControlState: {READY: 1}}, Volume: {getMixerControl: () => control},
    });
    let state;
    const audio = new Audio(value => { state = value; });
    audio.start();
    assert.deepEqual(Array.from(state.outputs, output => output.id), [1, 2]);
    assert.equal(state.outputs[0].active, true);
    signals.get('output-removed')(control, 2);
    assert.equal(state.outputs.length, 1);
    signals.get('output-added')(control, 2);
    assert.equal(state.outputs.length, 2);
    devices.get(2).port_available = false;
    signals.get('port-2')();
    assert.equal(state.outputs.length, 1, 'Disconnected HDMI connector must be hidden');
    devices.get(2).port_available = true;
    signals.get('port-2')();
    assert.equal(state.outputs.length, 2, 'Hotplug must restore the connector');
    devices.get(2).has_ports = () => false;
    devices.get(2).port_available = false;
    signals.get('port-2')();
    assert.equal(state.outputs.length, 2, 'Portless outputs must remain visible');
    audio.stop();
    assert.equal(audio._outputs.size, 0);
    assert.equal(audio._outputSignals.size, 0);
    assert.equal(audio._signals.length, 0);
});
