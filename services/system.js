import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseCpu, cpuPercent, memoryPercent, networkBytes, defaultInterface, formatRate} from './proc.js';

// Reads four tiny procfs files at a configurable cadence. Avoid heavier
// operations in GNOME Shell.
function read(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
            try {
                const [ok, bytes] = file.load_contents_finish(result);
                if (!ok) throw new Error(`Failed reading ${path}`);
                resolve(new TextDecoder().decode(bytes));
            } catch (error) { reject(error); }
        });
    });
}

export class SystemMonitor {
    constructor(onChange, intervalSeconds = 2) {
        this._onChange = onChange;
        this._interval = Math.max(1, Math.round(intervalSeconds));
        this._timer = 0;
        this._previousCpu = null;
        this._previousNetwork = null;
        this._iface = null;
        this._alive = false;
        this._busy = false;
    }

    start() {
        this._alive = true;
        this._cancellable = new Gio.Cancellable();
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _tick() {
        if (!this._alive || this._busy) return;
        this._busy = true;
        try {
            const [stat, meminfo, route, network] = await Promise.all(
                ['/proc/stat', '/proc/meminfo', '/proc/net/route', '/proc/net/dev']
                    .map(path => read(path, this._cancellable)));
            if (!this._alive) return;
            const cpu = parseCpu(stat);
            const cpuValue = cpuPercent(this._previousCpu, cpu);
            this._previousCpu = cpu;
            const memory = memoryPercent(meminfo);
            const iface = defaultInterface(route);
            if (iface !== this._iface) this._previousNetwork = null; // counters are per interface
            this._iface = iface;
            const now = GLib.get_monotonic_time() / 1e6;
            const current = iface ? networkBytes(network, iface) : null;
            let rx = '—', tx = '—', rxBytes = null, txBytes = null;
            if (current && this._previousNetwork) {
                const dt = now - this._previousNetwork.time;
                if (dt > 0.1) {
                    rxBytes = Math.max(0, current.rx - this._previousNetwork.rx) / dt;
                    rx = formatRate(rxBytes);
                    txBytes = Math.max(0, current.tx - this._previousNetwork.tx) / dt;
                    tx = formatRate(txBytes);
                }
            }
            this._previousNetwork = current ? {...current, time: now} : null;
            this._onChange({cpu: cpuValue, memory, iface: iface ?? 'No default route', rx, tx, rxBytes, txBytes});
        } catch (e) {
            if (!this._alive) return;
            console.warn(`[Ubuntu Island] Metrics: ${e.message}`);
            this._onChange({cpu: null, memory: null, iface: 'Unavailable', rx: '—', tx: '—'});
        } finally {
            this._busy = false;
        }
    }

    stop() {
        this._alive = false;
        this._cancellable?.cancel();
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
    }
}
