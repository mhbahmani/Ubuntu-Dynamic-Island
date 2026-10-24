import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

// Reuse GNOME's mixer singleton; NEVER close it on extension disable.
export class AudioService {
    constructor(onChange) {
        this._onChange = onChange;
        this._control = null;
        this._signals = [];
        this._stream = null;
        this._streamSignals = [];
    }

    start() {
        this._control = Volume.getMixerControl();
        for (const signal of ['state-changed', 'default-sink-changed', 'stream-added', 'stream-removed']) {
            this._signals.push(this._control.connect(signal, () => this._sync()));
        }
        this._sync();
    }

    _sync() {
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
        const max = this._control.get_vol_max_norm();
        const value = sink && max > 0 && !sink.is_muted ? sink.volume / max : 0;
        const sinks = this._control.get_sinks().map(s => ({
            id: s.get_id(),
            name: s.get_description() || s.get_name(),
            selected: Boolean(sink && s.get_id() === sink.get_id()),
        }));
        this._onChange({available: Boolean(sink), volume: Math.max(0, Math.min(1, value)), sinks});
    }

    setVolume(value) {
        const sink = this._control?.get_default_sink();
        if (!sink) return;
        const v = Math.max(0, Math.min(1, value));
        sink.volume = Math.round(v * this._control.get_vol_max_norm());
        sink.change_is_muted(v <= 0);
        sink.push_volume();
    }

    selectSink(id) {
        const sink = this._control?.get_sinks().find(s => s.get_id() === id);
        if (sink) this._control.set_default_sink(sink);
    }

    stop() {
        if (this._stream) for (const id of this._streamSignals) this._stream.disconnect(id);
        if (this._control) for (const id of this._signals) this._control.disconnect(id);
        this._signals = [];
        this._streamSignals = [];
        this._stream = null;
        this._control = null;
    }
}
