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

function mainLoop() {
    let serial = 0;
    const pending = new Map();
    return {
        GLib: {
            PRIORITY_DEFAULT_IDLE: 200, SOURCE_REMOVE: false,
            idle_add(priority, callback) { pending.set(++serial, callback); return serial; },
            Source: {remove(id) { assert(pending.delete(id)); }},
        },
        get size() { return pending.size; },
        flush() {
            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) assert.equal(callback(), false);
        },
    };
}

test('audio seeds existing devices, removes stale outputs, and disconnects without closing the shared mixer', () => {
    const loop = mainLoop();
    let id = 0;
    const signals = new Map();
    const device = value => ({get_id: () => value, get_description: () => `Output ${value}`, get_origin: () => '', get_profiles: () => [], get_port: () => '', get_icon_name: () => '', has_ports: () => true, port_available: true, connect: (name, cb) => { signals.set(`port-${value}`, cb); return ++id; }, disconnect() {}});
    const devices = new Map([[1, device(1)], [2, device(2)]]);
    const sink = {volume: 50, is_muted: false, connect: () => ++id, disconnect() {}};
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return ++id; },
        disconnect() {}, get_sinks: () => [...devices.keys()].map(value => ({device: value})),
        lookup_device_from_stream: stream => devices.get(stream === sink ? 1 : stream.device),
        lookup_output_id: value => devices.get(value),
        get_stream_from_device: () => null,
        get_default_sink: () => sink, get_state: () => 1, get_vol_max_norm: () => 100, get_cards: () => [],
        close() { assert.fail('must not close the shared mixer'); },
    };
    const Audio = service('audio', 'AudioService', {
        GLib: loop.GLib, Gvc: {MixerControlState: {READY: 1}}, Volume: {getMixerControl: () => control},
    });
    let state;
    const audio = new Audio(value => { state = value; });
    audio.start();
    loop.flush();
    assert.deepEqual(Array.from(state.outputs, output => output.id), [1, 2]);
    assert.equal(state.outputs[0].active, true);
    signals.get('output-removed')(control, 2);
    loop.flush();
    assert.equal(state.outputs.length, 1);
    signals.get('output-added')(control, 2);
    loop.flush();
    assert.equal(state.outputs.length, 2);
    devices.get(2).port_available = false;
    signals.get('port-2')();
    loop.flush();
    assert.equal(state.outputs.length, 1, 'Disconnected HDMI connector must be hidden');
    devices.get(2).port_available = true;
    signals.get('port-2')();
    loop.flush();
    assert.equal(state.outputs.length, 2, 'Hotplug must restore the connector');
    devices.get(2).has_ports = () => false;
    devices.get(2).port_available = false;
    signals.get('port-2')();
    loop.flush();
    assert.equal(state.outputs.length, 2, 'Portless outputs must remain visible');
    audio.stop();
    assert.equal(audio._outputs.size, 0);
    assert.equal(audio._outputSignals.size, 0);
    assert.equal(audio._signals.length, 0);
});

test('Bluetooth modes share a physical device row, preserve selection, and follow removal', () => {
    const loop = mainLoop();
    const signals = new Map();
    const makeDevice = (id, profile, port) => ({get_id: () => id, get_description: () => 'Localized port name',
        get_icon_name: () => '',
        get_origin: () => 'Headphones', get_port: () => port, get_profiles: () => [{profile, n_sources: profile.startsWith('a2dp') ? 0 : 1}],
        has_ports: () => true, port_available: true, connect: () => id, disconnect() {}});
    const music = makeDevice(1, 'a2dp-sink', 'headset-output');
    const calls = makeDevice(2, 'headset-head-unit-msbc', 'headset-hf-output');
    const wired = makeDevice(3, 'output:analog-stereo', 'analog-output-headphones');
    const devices = new Map([[1, music], [2, calls], [3, wired]]);
    const card = id => ({get_id: () => id, get_index: () => id, get_name: () => 'Headphones',
        get_ports: () => [{port:'headset-output'}, {port:'headset-hf-output'}]});
    let cards = [card(7)], active = music, selected, mixerState = 2;
    const sink = {volume: 50, is_muted: false, get_card_index: () => 7, get_form_factor: () => 'headset', get_name: () => 'bluez_output', connect: () => 1, disconnect() {}};
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return signals.size; }, disconnect() {},
        get_sinks: () => [sink], lookup_device_from_stream: () => active,
        lookup_output_id: id => devices.get(id), get_default_sink: () => sink,
        get_state: () => mixerState, get_vol_max_norm: () => 100, get_cards: () => cards,
        get_stream_from_device: device => device === active ? sink : null,
        change_output(device) { selected = device; active = device; signals.get('active-output-update')(control, device.get_id()); },
    };
    const Audio = service('audio', 'AudioService', {GLib: loop.GLib, Gvc: {MixerControlState: {READY: 1, CONNECTING: 2}}, Volume: {getMixerControl: () => control}});
    let state;
    const audio = new Audio(value => { state = value; });
    audio.start();
    for (const id of [2, 3]) signals.get('output-added')(control, id);
    mixerState = 1;
    signals.get('state-changed')(control);
    loop.flush();
    assert.equal(state.outputs.length, 2, 'Wired outputs remain separate');
    let group = state.outputs.find(output => output.modes);
    assert.equal(group.name, 'Headphones');
    assert.deepEqual(Array.from(group.modes, mode => mode.mode), ['music', 'calls']);
    assert.equal(group.modes[0].active, true);
    audio.selectOutput(group.modes[1].id);
    loop.flush();
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
    loop.flush();
    assert.equal(state.outputs.find(output => output.modes).modes.length, 1);
    audio.selectOutput(999);
    assert.equal(selected, calls, 'A stale click must not select a different device');
    audio.stop();
});

test('outputs sort headphones and AUX, internal speakers, HDMI, then others without moving the active device first', () => {
    const loop = mainLoop();
    const definitions = [
        {id: 1, port: 'hdmi-output-0'},
        {id: 2, port: 'analog-output-speaker'},
        {id: 3, port: 'analog-output-headphones'},
        {id: 4, port: 'headset-output', profile: 'a2dp-sink', form: 'headset'},
        {id: 5, port: 'analog-output-speaker', icon: 'audio-card-usb'},
        {id: 6, port: 'analog-output-lineout'},
        {id: 7, port: 'speaker-output', profile: 'a2dp-sink', form: 'speaker'},
    ];
    const signals = new Map();
    const devices = new Map(definitions.map(data => [data.id, {
        get_id: () => data.id, get_description: () => 'خروجی', get_origin: () => 'دستگاه',
        get_port: () => data.port, get_icon_name: () => data.icon || '',
        get_profiles: () => data.profile ? [{profile: data.profile, n_sources: 0}] : [],
        has_ports: () => true, port_available: true, connect: () => 1, disconnect() {},
    }]));
    const streams = new Map(definitions.map(data => [data.id, {
        device: data.id, volume: 50, is_muted: false, get_card_index: () => data.id,
        get_form_factor: () => data.form || '', get_name: () => '', connect: () => 1, disconnect() {},
    }]));
    let active = 5, state;
    const control = {
        connect: (name, callback) => { signals.set(name, callback); return signals.size; }, disconnect() {},
        get_sinks: () => [...streams.values()], lookup_device_from_stream: stream => devices.get(stream.device),
        get_stream_from_device: device => streams.get(device.get_id()), lookup_output_id: id => devices.get(id),
        get_default_sink: () => streams.get(active), get_state: () => 1, get_vol_max_norm: () => 100,
        get_cards: () => [4, 7].map(id => ({get_id: () => id, get_index: () => id})),
    };
    const Audio = service('audio', 'AudioService', {GLib: loop.GLib, Gvc: {MixerControlState: {READY: 1}}, Volume: {getMixerControl: () => control}});
    const audio = new Audio(value => { state = value; });
    audio.start();
    loop.flush();
    assert.deepEqual(Array.from(state.outputs, output => output.kind),
        ['headphones', 'headphones', 'headphones', 'speakers', 'hdmi', 'other', 'other']);
    assert.deepEqual(new Set(Array.from(state.outputs.slice(0, 3), output => output.id)), new Set([3, 6, 'bluetooth:4']));
    assert.equal(state.outputs[3].id, 2);
    assert.equal(state.outputs[4].id, 1);
    assert.equal(state.outputs.find(output => output.id === 'bluetooth:7').kind, 'other', 'A Bluetooth speaker is not a headset');
    const order = Array.from(state.outputs, output => output.id);
    active = 1;
    signals.get('default-sink-changed')(control);
    loop.flush();
    assert.deepEqual(Array.from(state.outputs, output => output.id), order, 'Switching outputs must preserve category order');
    assert.equal(state.outputs.find(output => output.active).id, 1);
    audio.stop();
});

test('native card-update bursts never read partially replaced profiles and stop cancels queued work', () => {
    const loop = mainLoop();
    const signals = new Map(), streamSignals = new Map();
    let serial = 0, updating = false, ready = 1, snapshots = 0, reads = 0;
    const device = id => {
        const callbacks = new Map();
        return {
            callbacks,
            get_id: () => id, get_description: () => `Output ${id}`, get_origin: () => '',
            get_port: () => 'analog-output-speaker', get_icon_name: () => '',
            get_profiles() {
                assert(!updating, 'Native profiles may be freed until ALL ports finish updating');
                reads++;
                return [];
            },
            has_ports: () => true, port_available: true,
            connect(name, callback) { const token = ++serial; callbacks.set(token, callback); return token; },
            disconnect(token) { assert(callbacks.delete(token)); },
        };
    };
    const devices = new Map([[1, device(1)], [2, device(2)]]);
    const sink = {
        volume: 50, is_muted: false,
        connect(name, callback) { streamSignals.set(name, callback); return name; },
        disconnect(name) { assert(streamSignals.delete(name)); },
    };
    const control = {
        connect(name, callback) { signals.set(name, callback); return name; },
        disconnect(name) { assert(signals.delete(name)); },
        get_sinks: () => [...devices.values()], lookup_device_from_stream: stream => stream === sink ? devices.get(1) : stream,
        lookup_output_id: id => devices.get(id), get_stream_from_device: () => null,
        get_default_sink: () => sink, get_state: () => ready, get_vol_max_norm: () => 100, get_cards: () => [],
        close() { assert.fail('must not close the shared mixer'); },
    };
    const Audio = service('audio', 'AudioService', {
        GLib: loop.GLib, Gvc: {MixerControlState: {READY: 1, CONNECTING: 2}}, Volume: {getMixerControl: () => control},
    });
    let state;
    const audio = new Audio(value => { snapshots++; state = value; });
    audio.start();
    audio.start(); // No duplicate handlers or refreshes.
    assert.equal(loop.size, 1);
    loop.flush();
    assert.equal(snapshots, 1);
    assert.equal(loop.size, 0, 'No recurring timer');

    // Model Gvc update_card(): invalidate both profile lists, notify the first
    // port before refreshing the second, and emit card-added at the very end.
    updating = true;
    for (const callback of devices.get(1).callbacks.values()) callback();
    for (const name of ['output-added', 'active-output-update', 'stream-added', 'default-sink-changed'])
        signals.get(name)(control, 1);
    for (const callback of streamSignals.values()) callback();
    for (const callback of devices.get(2).callbacks.values()) callback();
    signals.get('card-added')(control, 7);
    assert.equal(snapshots, 1, 'No rendering inside native signals');
    assert.equal(reads, 2, 'No profile reads inside native signals');
    assert.equal(loop.size, 1, 'One refresh for the entire burst');
    updating = false;
    loop.flush();
    assert.equal(snapshots, 2);
    assert.equal(state.outputs.length, 2);

    // Reconnecting retains discovered IDs, but never describes their profiles.
    ready = 2;
    updating = true;
    signals.get('state-changed')(control);
    loop.flush();
    assert.equal(state.available, false);
    assert.equal(state.outputs.length, 0);
    updating = false;
    ready = 1;
    signals.get('state-changed')(control);
    loop.flush();
    assert.equal(state.outputs.length, 2);

    // An output can disappear between the notification and the deferred read.
    const removed = devices.get(2);
    for (const callback of removed.callbacks.values()) callback();
    devices.delete(2);
    loop.flush();
    assert.equal(state.outputs.length, 1);
    assert.equal(removed.callbacks.size, 0);

    // Replace the registered object and discard the old object's signal.
    const previous = devices.get(1);
    devices.set(1, device(1));
    signals.get('card-added')(control, 7);
    loop.flush();
    assert.equal(previous.callbacks.size, 0);
    assert.equal(devices.get(1).callbacks.size, 1);

    // Lock/disable may run before the idle. No refresh or old handler survives.
    for (let cycle = 0; cycle < 5; cycle++) {
        signals.get('card-removed')(control, 7);
        const before = snapshots;
        const late = signals.get('output-added');
        audio.stop();
        late(control, 1);
        assert.equal(loop.size, 0);
        assert.equal(signals.size, 0);
        assert.equal(streamSignals.size, 0);
        assert.equal(devices.get(1).callbacks.size, 0);
        loop.flush();
        assert.equal(snapshots, before);
        audio.start();
        loop.flush();
        assert.equal(snapshots, before + 1);
    }
    audio.stop();
    audio.start();
    audio.stop();
    assert.equal(loop.size, 0, 'Stop also cancels the initial refresh');
});
