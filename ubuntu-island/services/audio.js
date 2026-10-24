import Gvc from 'gi://Gvc';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

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
        this._outputs = new Map(); // Gvc MixerUIDevice id -> {id, name}
    }

    start() {
        this._control = Volume.getMixerControl();
        for (const signal of ['state-changed', 'default-sink-changed', 'stream-added', 'stream-removed',
            'output-added', 'output-removed', 'active-output-update']) {
            this._signals.push(this._control.connect(signal, (control, id) => this._onSignal(signal, id)));
        }
        this._sync();
    }

    _onSignal(signal, id) {
        if (signal === 'output-added') {
            const device = this._control.lookup_output_id(id);
            if (device) this._outputs.set(id, this._describe(device));
        } else if (signal === 'output-removed') {
            this._outputs.delete(id);
        }
        this._sync();
    }

    _describe(device) {
        const parts = [device.get_description(), device.get_origin()].filter(Boolean);
        return {id: device.get_id(), name: parts.join(' — ') || 'Audio output'};
    }

    _sync() {
        if (!this._control) return;
        const sink = this._control.get_default_sink();
        if (sink !== this._stream) {
            if (this._stream) for (const id of this._streamSignals) this._stream.disconnect(id);
            this._streamSignals = [];
            this._stream = sink;
            if (sink) {
                this._streamSignals.push(sink.connect('notify::volume', () => this._sync()));
                this._streamSignals.push(sink.connect('notify::is-muted', () => this._sync()));
            }
        }
        const ready = this._control.get_state() === Gvc.MixerControlState.READY;
        const max = this._control.get_vol_max_norm();
        const volume = sink && max > 0 ? sink.volume / max : 0;
        let activeId = -1;
        if (sink) {
            const device = this._control.lookup_device_from_stream(sink);
            if (device) activeId = device.get_id();
        }
        const outputs = [...this._outputs.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 8)
            .map(output => ({...output, active: output.id === activeId}));
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
        if (this._stream) for (const id of this._streamSignals) this._stream.disconnect(id);
        if (this._control) for (const id of this._signals) this._control.disconnect(id);
        this._signals = [];
        this._streamSignals = [];
        this._stream = null;
        this._control = null;
        this._outputs.clear();
    }
}
