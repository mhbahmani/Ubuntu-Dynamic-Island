import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Window metadata only. Shared terminal-server PIDs can match several windows;
// in that case there is no target. Never guess by title or ask for a binding.
export class AgentWindows {
    constructor(changed = () => {}) {
        this.changed = changed;
        this.windows = new Map();
        this.created = global.display.connect('window-created', (_d, w) => this._watch(w));
        for (const actor of global.get_window_actors()) this._watch(actor.meta_window);
    }
    _watch(window) {
        if (this.windows.has(window)) return;
        const removed = window.connect('unmanaged', () => {
            for (const id of this.windows.get(window) || []) window.disconnect(id);
            this.windows.delete(window);
            this.changed();
        });
        const title = window.connect('notify::title', () => this.changed());
        this.windows.set(window, [removed, title]);
        this.changed();
    }
    candidates(session) {
        return this.all().filter(window => session.pids?.includes(window.get_pid()));
    }
    resolve(session) {
        if (session.state === 'closed') return null;
        const matches = this.candidates(session);
        return matches.length === 1 ? matches[0] : null;
    }
    all() { return [...this.windows.keys()].filter(w => !w.is_skip_taskbar()); }
    activate(window) {
        if (!this.windows.has(window)) return;
        Main.activateWindow(window, global.get_current_time());
    }
    stop() {
        if (this.created) global.display.disconnect(this.created);
        for (const [window, ids] of this.windows) for (const id of ids) window.disconnect(id);
        this.windows.clear(); this.created = 0;
    }
}
