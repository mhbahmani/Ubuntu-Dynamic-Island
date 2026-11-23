import Gio from 'gi://Gio';
import {AGENT_LIMIT, agentTerminalIdentity, agentWindowMatch} from './agents-model.js';
import {terminalWindowIdentity} from './agent-terminal.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Match process ancestry first. A terminal-provided exact window identity may
// disambiguate a shared process; ambiguous matches never offer an action.
export class AgentWindows {
    constructor(changed = () => {}) {
        this.changed = changed;
        this.windows = new Map();
        this.identities = new Map(); this.active = false;
        this.terminalIdentity = terminalWindowIdentity;
        this.created = global.display.connect('window-created', (_d, w) => this._watch(w));
        for (const actor of global.get_window_actors()) this._watch(actor.meta_window);
    }
    _watch(window) {
        if (this.windows.has(window)) return;
        const removed = window.connect('unmanaged', () => {
            for (const id of this.windows.get(window) || []) window.disconnect(id);
            this.windows.delete(window);
            this._invalidate(window);
        });
        const title = window.connect('notify::title', () => this._invalidate(window));
        this.windows.set(window, [removed, title]);
        this._invalidate(window);
    }
    candidates(session) {
        return this.all().filter(window => session.pids?.includes(window.get_pid()));
    }
    setActive(active) {
        this.active = active;
        if (!active) for (const key of this.identities.keys()) this._forget(key);
    }
    _forget(key) {
        this.identities.get(key)?.cancel.cancel(); this.identities.delete(key);
    }
    _invalidate(window) {
        for (const [key, record] of this.identities)
            if (record.pids.includes(window.get_pid())) this._forget(key);
        this.changed();
    }
    _key(session) { return JSON.stringify([session.terminal, session.pids]); }
    _identity(session) {
        if (!this.active || !agentTerminalIdentity(session.terminal)) return null;
        const key = this._key(session);
        if (!this.identities.has(key)) {
            if (this.identities.size >= AGENT_LIMIT) this._forget(this.identities.keys().next().value);
            const record = {cancel:new Gio.Cancellable(), pids:session.pids, value:null};
            this.identities.set(key, record);
            record.promise = this.terminalIdentity(session, record.cancel).then(identity => {
                if (this.identities.get(key) === record) record.value = identity;
            }).catch(() => {}).finally(() => {
                record.done = true;
                if (this.active && this.identities.get(key) === record) this.changed();
            });
        }
        return this.identities.get(key);
    }
    // {window, reason}: the reason explains an unmatched row instead of a
    // silent no-op. It never relaxes the match itself.
    explain(session) {
        if (session.state === 'closed') return {window:null, reason:'closed'};
        const candidates = this.candidates(session);
        if (!candidates.length) return {window:null, reason:'none'};
        const record = agentTerminalIdentity(session.terminal) ? this._identity(session) : null;
        const match = agentWindowMatch(session, candidates.map(window => ({window, pid:window.get_pid(),
            title:window.get_title?.(), transient:Boolean(window.get_transient_for?.())})),
        record?.value ?? null, Boolean(record && !record.done));
        return {window:match.window?.window ?? null, reason:match.reason};
    }
    resolve(session) { return this.explain(session).window; }
    async resolveForActivation(session) {
        if (!this.active || session.state === 'closed') return null;
        // A pane can move to another window without changing its UUID. Recheck
        // at activation instead of relying on a cached association or polling.
        if (agentTerminalIdentity(session.terminal)) {
            this._forget(this._key(session));
            await this._identity(session)?.promise;
        }
        return this.active ? this.resolve(session) : null;
    }
    all() { return [...this.windows.keys()].filter(w => !w.is_skip_taskbar()); }
    activate(window) {
        if (!this.windows.has(window)) return;
        Main.activateWindow(window, global.get_current_time());
    }
    stop() {
        this.setActive(false);
        if (this.created) global.display.disconnect(this.created);
        for (const [window, ids] of this.windows) for (const id of ids) window.disconnect(id);
        this.windows.clear(); this.created = 0;
    }
}
