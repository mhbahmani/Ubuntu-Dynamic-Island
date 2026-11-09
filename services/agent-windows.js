import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Window metadata only. An ambiguous terminal server PID is never an exact match.
export class AgentWindows {
    constructor() {
        this.bindings = new Map();
        this.windows = new Map();
        this.created = global.display.connect('window-created', (_d, w) => this._watch(w));
        for (const actor of global.get_window_actors()) this._watch(actor.meta_window);
    }
    _watch(window) {
        if (this.windows.has(window)) return;
        const id = window.connect('unmanaged', () => {
            this.windows.delete(window);
            for (const [key, value] of this.bindings) if (value === window) this.bindings.delete(key);
        });
        this.windows.set(window, id);
    }
    candidates(session) {
        const bound = this.bindings.get(session.id);
        if (bound && this.windows.has(bound)) return [bound];
        return this.all().filter(window => session.pids?.includes(window.get_pid()));
    }
    all() { return [...this.windows.keys()].filter(w => !w.is_skip_taskbar()); }
    bind(session, window) { if (this.windows.has(window)) this.bindings.set(session.id, window); }
    activate(window) {
        if (!this.windows.has(window)) throw new Error('That window has closed. Select another window.');
        Main.activateWindow(window, global.get_current_time());
    }
    stop() {
        if (this.created) global.display.disconnect(this.created);
        for (const [window, id] of this.windows) window.disconnect(id);
        this.windows.clear(); this.bindings.clear(); this.created = 0;
    }
}
