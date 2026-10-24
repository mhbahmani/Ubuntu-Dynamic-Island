import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseCpu, cpuPercent, memoryPercent, networkBytes, defaultInterface, formatRate} from './proc.js';

// Reads four tiny procfs files at a configurable cadence. Avoid heavier
// operations in GNOME Shell.
function read(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok) throw new Error(`Failed reading ${path}`);
    return new TextDecoder().decode(bytes);
}

export class SystemMonitor {
    constructor(onChange, intervalSeconds = 2) {
        this._onChange = onChange;
        this._interval = Math.max(1, Math.round(intervalSeconds));
        this._timer = 0;
        this._previousCpu = null;
        this._previousNetwork = null;
        this._iface = null;
    }

    start() {
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        try {
            const cpu = parseCpu(read('/proc/stat'));
            const cpuValue = cpuPercent(this._previousCpu, cpu);
            this._previousCpu = cpu;
            const memory = memoryPercent(read('/proc/meminfo'));
            const iface = defaultInterface(read('/proc/net/route'));
            if (iface !== this._iface) this._previousNetwork = null; // counters are per interface
            this._iface = iface;
            const now = GLib.get_monotonic_time() / 1e6;
            const current = iface ? networkBytes(read('/proc/net/dev'), iface) : null;
            let rx = '—', tx = '—';
            if (current && this._previousNetwork) {
                const dt = now - this._previousNetwork.time;
                if (dt > 0.1) {
                    rx = formatRate(Math.max(0, current.rx - this._previousNetwork.rx) / dt);
                    tx = formatRate(Math.max(0, current.tx - this._previousNetwork.tx) / dt);
                }
            }
            this._previousNetwork = current ? {...current, time: now} : null;
            this._onChange({cpu: cpuValue, memory, iface: iface ?? 'No default route', rx, tx});
        } catch (e) {
            console.warn(`[Ubuntu Island] Metrics: ${e.message}`);
            this._onChange({cpu: null, memory: null, iface: 'Unavailable', rx: '—', tx: '—'});
        }
    }

    stop() {
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
    }
}
