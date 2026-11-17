// One bounded process check when the Agents list opens, in the existing broker.
// Never infer activity from elapsed time, a terminal PID or a window match.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readBounded} from './io.js';

export async function agentProcessAlive(process, cancel) {
    let stream;
    try {
        const file = Gio.File.new_for_path(`/proc/${process.pid}/stat`);
        stream = await new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, cancel,
            (f, r) => { try { resolve(f.read_finish(r)); } catch (error) { reject(error); } }));
        const stat = await readBounded(stream, 8192, cancel);
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        if (!stat.includes(')') || !/^\d+$/.test(fields[19] || '')) return null;
        return fields[19] === process.start && !['Z', 'X', 'x'].includes(fields[0]);
    } catch (error) {
        // Permissions, cancellation and read failures do not prove an exit.
        return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ? false : null;
    } finally {
        try { stream?.close(null); } catch {}
    }
}

export class AgentProcesses {
    constructor(store, changed, read = agentProcessAlive) {
        this.store = store; this.changed = changed; this.read = read;
        this.active = false; this.cancel = null; this.deadline = 0;
    }
    setActive(active) {
        if (this.active === active) return;
        this.stop();
        this.active = active;
        if (active) void this._refresh();
    }
    async _refresh() {
        const cancel = new Gio.Cancellable(); this.cancel = cancel;
        this.deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.deadline = 0; cancel.cancel(); return GLib.SOURCE_REMOVE;
        });
        try {
            await Promise.all([...this.store.rows.values()].filter(row => row.process && row.state !== 'closed')
                .map(async ({id, process, report}) => {
                    try {
                        const alive = await this.read(process, cancel);
                        if (alive === false && this.active && this.cancel === cancel && !cancel.is_cancelled() &&
                            this.store.closeExited(id, report)) this.changed();
                    } catch { /* An unavailable process check preserves the report. */ }
                }));
        } finally {
            if (this.cancel === cancel) {
                if (this.deadline) GLib.Source.remove(this.deadline);
                this.deadline = 0; this.cancel = null;
            }
        }
    }
    stop() {
        this.active = false;
        this.cancel?.cancel(); this.cancel = null;
        if (this.deadline) GLib.Source.remove(this.deadline);
        this.deadline = 0;
    }
}
