import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {audioBluetoothAddress, audioWithBatteries} from '../extension/services/audio-model.js';

test('battery identity uses recognized sink addresses, never display names', () => {
    for (const name of ['bluez_output.aa_bb_cc_dd_ee_ff.1', 'bluez_sink.AA_BB_CC_DD_EE_FF.a2dp_sink'])
        assert.equal(audioBluetoothAddress(name), 'AA:BB:CC:DD:EE:FF');
    for (const name of ['', 'Headphones', 'alsa_output.AA_BB_CC_DD_EE_FF.1', 'bluez_output.AA_BB_CC_DD_EE_FF00.1'])
        assert.equal(audioBluetoothAddress(name), null);
    const audio = {outputs: [
        {name: 'Same name', kind: 'headphones', bluetoothAddress: 'AA:BB:CC:DD:EE:FF'},
        {name: 'Same name', kind: 'headphones', bluetoothAddress: '11:22:33:44:55:66'},
        {name: 'Same name', kind: 'headphones'},
        {name: 'Speaker', kind: 'other', bluetoothAddress: 'AA:BB:CC:DD:EE:FF'},
    ]};
    const device = {address: 'aa:bb:cc:dd:ee:ff', connected: true, battery: 82};
    const state = devices => ({available: true, powered: true, devices});
    const result = bluetooth => audioWithBatteries(audio, bluetooth).outputs.map(output => output.battery);
    assert.deepEqual(result(state([device])), [82, null, null, null]);
    assert.equal(audio.outputs[0].battery, undefined, 'Do not contaminate cached audio state with battery data');
    for (const battery of [0, 100]) assert.equal(result(state([{...device, battery}]))[0], battery);
    for (const battery of [null, undefined, NaN, -1, 101, '82'])
        assert.equal(result(state([{...device, battery}]))[0], null);
    assert.equal(result(state([{...device, connected: false}]))[0], null);
    assert.equal(result(state([device, {...device}]))[0], null, 'Ambiguous addresses must not pick a random battery');
    assert.equal(result({...state([device]), powered: false})[0], null);
    assert.equal(result({...state([device]), available: false})[0], null);
    assert.equal(result(undefined)[0], null);
});

test('BlueZ snapshot ordering, battery changes, invalidation and removal update Sound data', () => {
    const subscriptions = [];
    const Gio = {DBusSignalFlags: {NONE: 0}, DBus: {system: {
        signal_subscribe(...args) { subscriptions.push(args); return subscriptions.length; },
        signal_unsubscribe() {},
    }}};
    const source = readFileSync(new URL('../extension/services/bluetooth.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Bluetooth = vm.runInNewContext(`${source}\nBluetoothService`, {Gio, console});
    let state;
    const service = new Bluetooth(value => { state = value; });
    service._alive = service._available = true;
    service._applyInterfaces('/org/bluez/hci0', {'org.bluez.Adapter1': {Powered: true}});
    const path = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
    service._applyInterfaces(path, {
        'org.bluez.Battery1': {Percentage: 82},
        'org.bluez.Device1': {Paired: true, Connected: true, Address: 'AA:BB:CC:DD:EE:FF', Alias: 'Headphones'},
    });
    service._emit();
    assert.equal(state.devices[0].battery, 82);
    assert.equal(state.devices[0].address, 'AA:BB:CC:DD:EE:FF');
    service._subscribe();
    const signal = subscriptions.find(args => args[4] === 'org.bluez.Battery1').at(-1);
    const emit = (changed, invalidated = []) => signal(null, null, path, null, null,
        {deep_unpack: () => ['org.bluez.Battery1', changed, invalidated]});
    emit({Percentage: 0});
    assert.equal(state.devices[0].battery, 0);
    emit({}, ['Percentage']);
    assert.equal(state.devices[0].battery, null);
    emit({Percentage: 50});
    service._removeInterfaces(path, ['org.bluez.Battery1']); service._emit();
    assert.equal(state.devices[0].battery, null);
    service.stop();
    assert.equal(service._subscriptions.length, 0);
    assert.equal(service._devices.size, 0);
});
