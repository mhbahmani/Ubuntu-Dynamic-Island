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
    const device = value => ({get_id: () => value, get_description: () => `Output ${value}`, get_origin: () => '', get_profiles: () => [], has_ports: () => true, port_available: true, connect: (name, cb) => { signals.set(`port-${value}`, cb); return ++id; }, disconnect() {}});
    const devices = new Map([[1, device(1)], [2, device(2)]]);
    const sink = {volume: 50, is_muted: false, connect: () => ++id, disconnect() {}};
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return ++id; },
        disconnect() {}, get_sinks: () => [...devices.keys()].map(value => ({device: value})),
        lookup_device_from_stream: stream => devices.get(stream === sink ? 1 : stream.device),
        lookup_output_id: value => devices.get(value),
        get_default_sink: () => sink, get_state: () => 1, get_vol_max_norm: () => 100, get_cards: () => [],
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

test('Bluetooth modes share a physical device row, preserve selection, and follow removal', () => {
    const signals = new Map();
    const makeDevice = (id, profile, port) => ({get_id: () => id, get_description: () => 'Localized port name',
        get_origin: () => 'Headphones', get_port: () => port, get_profiles: () => [{profile, n_sources: profile.startsWith('a2dp') ? 0 : 1}],
        has_ports: () => true, port_available: true, connect: () => id, disconnect() {}});
    const music = makeDevice(1, 'a2dp-sink', 'headset-output');
    const calls = makeDevice(2, 'headset-head-unit-msbc', 'headset-hf-output');
    const wired = makeDevice(3, 'output:analog-stereo', 'analog-output-headphones');
    const devices = new Map([[1, music], [2, calls], [3, wired]]);
    const card = id => ({get_id: () => id, get_index: () => id, get_name: () => 'Headphones',
        get_ports: () => [{port:'headset-output'}, {port:'headset-hf-output'}]});
    let cards = [card(7)], active = music, selected, mixerState = 2;
    const sink = {volume: 50, is_muted: false, get_card_index: () => 7, connect: () => 1, disconnect() {}};
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return signals.size; }, disconnect() {},
        get_sinks: () => [sink], lookup_device_from_stream: () => active,
        lookup_output_id: id => devices.get(id), get_default_sink: () => sink,
        get_state: () => mixerState, get_vol_max_norm: () => 100, get_cards: () => cards,
        get_stream_from_device: device => device === active ? sink : null,
        change_output(device) { selected = device; active = device; signals.get('active-output-update')(control, device.get_id()); },
    };
    const Audio = service('audio', 'AudioService', {Gvc: {MixerControlState: {READY: 1, CONNECTING: 2}}, Volume: {getMixerControl: () => control}});
    let state;
    const audio = new Audio(value => { state = value; });
    audio.start();
    for (const id of [2, 3]) signals.get('output-added')(control, id);
    mixerState = 1;
    signals.get('state-changed')(control);
    assert.equal(state.outputs.length, 2, 'Wired outputs remain separate');
    let group = state.outputs.find(output => output.modes);
    assert.equal(group.name, 'Headphones');
    assert.deepEqual(Array.from(group.modes, mode => mode.mode), ['music', 'calls']);
    assert.equal(group.modes[0].active, true);
    audio.selectOutput(group.modes[1].id);
    assert.equal(selected, calls, 'Switch with the real Gvc device, not a group ID');
    group = state.outputs.find(output => output.modes);
    assert.equal(group.id, 'bluetooth:7', 'Keep the row identity across profile changes');
    assert.equal(group.modes[1].active, true);
    // Same model name on two cards cannot establish the inactive port's identity.
    cards = [card(7), card(8)];
    audio._sync();
    assert.equal(state.outputs.length, 3, 'Ambiguous same-name devices must not merge');
    cards = [card(7)];
    music.get_profiles = () => [{profile:'a2dp-sink-faststream-duplex', n_sources:1}];
    audio._sync();
    assert(!state.outputs.find(output => output.id === 1).modes, 'Duplex codecs must not claim the microphone is off');
    signals.get('output-removed')(control, 1);
    assert.equal(state.outputs.find(output => output.modes).modes.length, 1);
    audio.selectOutput(999);
    assert.equal(selected, calls, 'A stale click must not select a different device');
    audio.stop();
});
