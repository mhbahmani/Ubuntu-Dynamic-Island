import Gvc from 'gi://Gvc';
import GLib from 'gi://GLib';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {audioBluetoothAddress} from './audio-model.js';

// Reuse GNOME's shared mixer singleton; NEVER close it on extension disable.
// Output devices are enumerated through the Gvc output-added/removed signals:
// the control exposes no synchronous list call for UI devices.
export class AudioService {
    constructor(onChange) {
        this._onChange = onChange;
        this._control = null;
        this._signals = [];
        this._stream = null;
        this._streamSignals = [];
        this._outputs = new Map(); // Gvc MixerUIDevice id -> device
        this._removedOutputs = new Set();
        this._outputSignals = new Map();
        this._syncSource = 0;
    }

    start() {
        if (this._control) return;
        this._control = Volume.getMixerControl();
        for (const signal of ['state-changed', 'default-sink-changed', 'stream-added', 'stream-removed',
            'output-added', 'output-removed', 'active-output-update', 'card-added', 'card-removed']) {
            this._signals.push(this._control.connect(signal, (control, id) => this._onSignal(signal, id)));
        }
        this._queueSync();
    }

    _onSignal(signal, id) {
        if (!this._control) return;
        if (signal === 'output-added') {
            this._removedOutputs.delete(id);
            const device = this._control.lookup_output_id(id);
            if (device) this._remember(device);
        } else if (signal === 'output-removed') {
            this._forget(id);
            this._removedOutputs.add(id);
        }
        this._queueSync();
    }

    _queueSync() {
        if (!this._control || this._syncSource) return;
        // Gvc update_card() frees the old profiles, then refreshes each port's
        // borrowed profile pointers in turn. Its synchronous output/availability
        // signals can arrive while OTHER devices still point to freed memory.
        // Reading all devices from those callbacks caused Shell SIGSEGVs on
        // resume. Wait until the native update returns; one idle handles the
        // whole burst. This is event-driven, not a recurring refresh timer.
        this._syncSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncSource = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _remember(device) {
        const id = device.get_id();
        const previous = this._outputs.get(id);
        if (previous && previous !== device) this._forget(id);
        this._outputs.set(id, device);
        if (!this._outputSignals.has(id))
            this._outputSignals.set(id, [device, device.connect('notify::port-available', () => this._queueSync())]);
    }

    _forget(id) {
        const connection = this._outputSignals.get(id);
        if (connection) connection[0].disconnect(connection[1]);
        this._outputSignals.delete(id);
        this._outputs.delete(id);
    }

    _describe(device, cards) {
        const parts = [device.get_description(), device.get_origin()].filter(Boolean);
        const profiles = device.get_profiles();
        const stream = this._control.get_stream_from_device(device);
        const port = (device.get_port() || '').toLowerCase();
        const icon = (device.get_icon_name() || '').toLowerCase();
        const form = (stream?.get_form_factor() || '').toLowerCase();
        const streamName = (stream?.get_name() || '').toLowerCase();
        // Use stable port/profile metadata, not translated display names. AUX
        // line-out joins headphones; an explicitly identified Bluetooth speaker
        // remains in Others. Active output never changes the category order.
        const bluetooth = profiles.some(p => /^(a2dp[-_]sink|headset[-_]head[-_]unit|handsfree[-_]head[-_]unit)(?:[-_]|$)/.test(p.profile));
        let kind = 'other';
        if (/hdmi|displayport/.test(port)) kind = 'hdmi';
        else if (bluetooth && form === 'speaker') kind = 'other';
        else if (/headphone|headset|lineout|line-out|aux/.test(port) ||
            /headphone|headset/.test(`${icon} ${form}`) || (bluetooth && form !== 'speaker')) kind = 'headphones';
        else if (/speaker/.test(port) && !/usb/.test(`${icon} ${streamName}`)) kind = 'speakers';
        const output = {id: device.get_id(), name: parts.join(' — ') || 'Audio output', kind,
            bluetoothAddress: bluetooth ? audioBluetoothAddress(streamName) : null};
        const music = profiles.length && profiles.every(p => p.n_sources === 0 && /^a2dp[-_]sink(?:[-_]|$)/.test(p.profile));
        const calls = profiles.length && profiles.every(p => p.n_sources > 0 && /^(headset[-_]head[-_]unit|handsfree[-_]head[-_]unit)(?:[-_]|$)/.test(p.profile));
        if (!music && !calls) return output;
        // Gvc's device.card is an opaque pointer in GJS. Match a live stream's
        // card index, or an unambiguous card+port for an inactive profile. Never
        // merge devices by their display name alone (two identical headsets).
        const candidates = cards.filter(card => stream
            ? card.get_index() === stream.get_card_index()
            : card.get_name() === device.get_origin() && card.get_ports().some(p => p.port === device.get_port()));
        if (candidates.length !== 1) return output;
        return {...output, group: `bluetooth:${candidates[0].get_id()}`,
            deviceName: device.get_origin() || 'Bluetooth headphones', mode: music ? 'music' : 'calls'};
    }

    _sync() {
        if (!this._control) return;
        const sink = this._control.get_default_sink();
        if (sink !== this._stream) {
            if (this._stream) for (const id of this._streamSignals) this._stream.disconnect(id);
            this._streamSignals = [];
            this._stream = sink;
            if (sink) {
                this._streamSignals.push(sink.connect('notify::volume', () => this._queueSync()));
                this._streamSignals.push(sink.connect('notify::is-muted', () => this._queueSync()));
            }
        }
        const mixerState = this._control.get_state();
        const ready = mixerState === Gvc.MixerControlState.READY;
        // The shared mixer is usually ready before this extension starts, so
        // output-added alone misses built-in devices. Seed existing sinks too.
        if (ready) {
            for (const stream of this._control.get_sinks()) {
                const device = this._control.lookup_device_from_stream(stream);
                if (device && !this._removedOutputs.has(device.get_id()))
                    this._remember(device);
            }
            for (const id of this._outputs.keys()) {
                const device = this._control.lookup_output_id(id);
                if (device) this._remember(device);
                else this._forget(id);
            }
        } else if (mixerState !== Gvc.MixerControlState.CONNECTING) {
            // Inactive Bluetooth modes arrive before READY and have no sink to
            // seed later. Keep them while the shared mixer is connecting.
            for (const id of this._outputs.keys()) this._forget(id);
            this._removedOutputs.clear();
        }
        const max = this._control.get_vol_max_norm();
        const volume = sink && max > 0 ? sink.volume / max : 0;
        let activeId = -1;
        if (sink) {
            const device = this._control.lookup_device_from_stream(sink);
            if (device) activeId = device.get_id();
        }
        const cards = ready ? this._control.get_cards() : [];
        const devices = (ready ? [...this._outputs.values()] : [])
            .filter(device => {
                // Registered HDMI connectors are not necessarily connected.
                return device.get_id() === activeId || !device.has_ports() || device.port_available;
            })
            .map(device => this._describe(device, cards))
            .map(output => ({...output, active: output.id === activeId}));
        const groups = new Map();
        for (const output of devices) {
            if (!output.group) { groups.set(output.id, output); continue; }
            let group = groups.get(output.group);
            if (!group) {
                group = {id: output.group, name: output.deviceName, kind: output.kind, active: false, modes: []};
                groups.set(output.group, group);
            }
            group.active ||= output.active;
            group.bluetoothAddress ||= output.bluetoothAddress;
            group.modes.push({id: output.id, mode: output.mode, active: output.active});
        }
        const rank = {headphones: 0, speakers: 1, hdmi: 2, other: 3};
        const outputs = [...groups.values()].sort((a, b) => rank[a.kind] - rank[b.kind] ||
            a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))).slice(0, 8);
        for (const output of outputs)
            output.modes?.sort((a, b) => (a.mode === 'music' ? 0 : 1) - (b.mode === 'music' ? 0 : 1));
        this._onChange({
            available: ready && Boolean(sink),
            volume: Math.max(0, Math.min(1, volume)),
            muted: sink ? sink.is_muted : false,
            outputs,
        });
    }

    setVolume(value) {
        const sink = this._control?.get_default_sink();
        if (!sink) return;
        const volume = Math.max(0, Math.min(1, value));
        sink.volume = Math.round(volume * this._control.get_vol_max_norm());
        sink.change_is_muted(volume <= 0);
        sink.push_volume();
    }

    toggleMute() {
        const sink = this._control?.get_default_sink();
        if (!sink) return;
        sink.change_is_muted(!sink.is_muted);
    }

    // Switches the physical output port/profile (Gvc UI device), which is
    // broader than merely retargeting the default sink stream.
    selectOutput(id) {
        const device = this._control?.lookup_output_id(id);
        if (device) this._control.change_output(device);
    }

    stop() {
        if (this._syncSource) GLib.Source.remove(this._syncSource);
        this._syncSource = 0;
        if (this._stream) for (const id of this._streamSignals) this._stream.disconnect(id);
        if (this._control) for (const id of this._signals) this._control.disconnect(id);
        this._signals = [];
        this._streamSignals = [];
        this._stream = null;
        this._control = null;
        for (const id of this._outputs.keys()) this._forget(id);
        this._removedOutputs.clear();
    }
}
