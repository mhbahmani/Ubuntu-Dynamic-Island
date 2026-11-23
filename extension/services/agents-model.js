// Protocol and presentation only: no filesystem, credentials, or Shell imports.
export const AGENTS = {claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode'};
export const AGENT_STATES = {
    working: 'Working', approval: 'Needs approval', input: 'Needs input',
    finished: 'Task finished', idle: 'Idle', error: 'Error', interrupted: 'Interrupted',
    closed: 'Closed', unknown: 'Unknown', waiting: 'Waiting for background task',
};
export const AGENT_LIMIT = 32;
export const cleanText = (value, limit = 128) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, limit) : '';
const token = value => cleanText(value, 128);
// Only explicit terminal identity hints are retained; never infer a window from
// the project name, command line, prompt, or a title substring.
export function agentTerminalIdentity(value) {
    if (value?.kind !== 'terminator' || typeof value.bus !== 'string' || typeof value.id !== 'string' ||
        !/^net\.tenshu\.Terminator2(?:[a-f0-9]{32})?$/.test(value.bus) ||
        !/^urn:uuid:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)) return null;
    return {kind:'terminator', bus:value.bus, id:value.id};
}

// A terminal's own exact window metadata only narrows process-matched candidates.
// Duplicate titles remain ambiguous, even when the terminal reports that title.
// Dialogs and popups (transient windows) belong to their parent, so they are
// never a second host. Unmatched results name why, for an explicit row state.
export function agentWindowMatch(session, windows, identity = null, pending = false) {
    if (session.state === 'closed') return {window:null, reason:'closed'};
    let matches = windows.filter(window => session.pids?.includes(window.pid) && !window.transient);
    if (!matches.length) return {window:null, reason:'none'};
    if (agentTerminalIdentity(session.terminal)) {
        if (!identity) return {window:null, reason:pending ? 'pending' : 'unverified'};
        matches = matches.filter(window => window.pid === identity.pid && window.title === identity.title);
        if (matches.length > 1) return {window:null, reason:'duplicate'};
        if (!matches.length) return {window:null, reason:'unverified'};
    }
    return matches.length === 1 ? {window:matches[0], reason:''} : {window:null, reason:'shared'};
}
export const matchAgentWindow = (session, windows, identity = null) =>
    agentWindowMatch(session, windows, identity).window;
export const AGENT_WINDOW_REASONS = {
    none: 'No open window belongs to this session',
    shared: 'Its app has several windows and does not report which one runs this session',
    duplicate: 'Its terminal windows share one title, so the window cannot be identified',
    pending: 'Checking its terminal window…',
    unverified: 'Its terminal did not confirm which window runs this session',
};
export const agentWindowReason = reason => AGENT_WINDOW_REASONS[reason] || 'Window unavailable';

// Process birth tokens prevent recycled PIDs from establishing relationships.
function processIdentity(value) {
    return Number.isSafeInteger(value?.pid) && value.pid > 1 && /^\d{1,24}$/.test(value.start || '')
        ? {pid:value.pid, start:value.start} : null;
}
export const agentKey = value => JSON.stringify([value.provider, value.profile || 'default', value.session]);
function parentReference(value, provider, session) {
    const process = processIdentity(value?.process);
    if (provider !== 'codex' || value?.provider !== 'claude' || !token(value.session) ||
        value.session === session || !process) return null;
    return {provider:'claude', profile:token(value.profile) || 'default', session:token(value.session), process};
}
const ACTIVE_TASKS = new Set(['running', 'pending', 'in_progress', 'queued']);
const ENDED_TASKS = new Set(['completed', 'finished', 'failed', 'cancelled', 'canceled', 'stopped']);
function task(value, inFlight = false) {
    if (!token(value?.id)) return null;
    let status = cleanText(value.status, 32).toLowerCase();
    // Stop/SubagentStop list only in-flight tasks and document status as free
    // text, so an unrecognized snapshot status is still outstanding work.
    if (inFlight && !ENDED_TASKS.has(status)) status = 'running';
    if (!ACTIVE_TASKS.has(status) && !ENDED_TASKS.has(status)) return null;
    return {id:token(value.id), kind:['codex', 'subagent'].includes(value.kind || value.type)
        ? value.kind || value.type : 'background', status};
}
export function agentStatus(row) {
    if (row.state !== 'waiting') return AGENT_STATES[row.state] || 'Unknown';
    return row.waitingFor === 'codex' ? 'Waiting for Codex' : row.waitingFor === 'subagent'
        ? 'Waiting for subagent' : 'Waiting for background task';
}
export function agentNotificationNeeded(previous, session) {
    return ['approval', 'input', 'finished'].includes(session.state) &&
        (!previous || previous.state !== session.state || previous.turn !== session.turn);
}

export function normalizeAgentEvent(value) {
    if (!value || value.v !== 1 || !Object.hasOwn(AGENTS, value.provider) ||
        !Object.hasOwn(AGENT_STATES, value.state) || !token(value.session)) return null;
    return {v: 1, provider: value.provider, session: token(value.session),
        profile: token(value.profile) || 'default', state: value.state,
        label: cleanText(value.label, 80) || AGENTS[value.provider],
        title: cleanText(value.title, 160).trim(),
        process: processIdentity(value.process),
        parent: parentReference(value.parent, value.provider, value.session),
        tasks: Array.isArray(value.tasks) ? value.tasks.slice(0, 64).map(item => task(item, true)).filter(Boolean) : null,
        taskDelta: task(value.taskDelta),
        lifecycle: ['stop', 'task'].includes(value.lifecycle) ? value.lifecycle : '',
        turn: token(value.turn), request: token(value.request), resolve: Boolean(value.resolve),
        start: Boolean(value.start), at: Number.isFinite(value.at) && value.at > 0 ? value.at : 0,
        launch: /^[a-zA-Z0-9-]{1,64}$/.test(value.launch ?? '') ? value.launch : '',
        terminal: agentTerminalIdentity(value.terminal),
        pids: Array.isArray(value.pids) ? value.pids.filter(p => Number.isSafeInteger(p) && p > 1).slice(0, 16) : [],
    };
}

export function fromAgentHook(provider, raw, extra = {}) {
    if (!raw || !Object.hasOwn(AGENTS, provider)) return null;
    const hook = raw.hook_event_name;
    const nativeTask = provider === 'claude' && ['SubagentStart', 'SubagentStop'].includes(hook);
    // Child-context hooks share session_id with their parent. They cannot drive
    // the parent's response lifecycle or change its heading.
    if (provider === 'claude' && raw.agent_id && !nativeTask) return null;
    let state = {SessionStart: 'idle', UserPromptSubmit: 'working', PermissionRequest: 'approval',
        Stop: 'finished', StopFailure: 'error', SessionEnd: 'closed', Interrupt: 'interrupted',
        PreToolUse: 'working', PostToolUse: 'working', PostToolUseFailure: 'working',
        SubagentStart: 'working', SubagentStop: 'working'}[hook];
    if (hook === 'PreToolUse' && ['AskUserQuestion', 'request_user_input'].includes(raw.tool_name)) state = 'input';
    if (hook === 'Notification') state = {
        permission_prompt: 'approval', elicitation_dialog: 'input', elicitation_url_dialog: 'input',
        agent_needs_input: 'input', elicitation_complete: 'working', elicitation_response: 'working',
    }[raw.notification_type];
    if (!state) return null;
    return normalizeAgentEvent({v: 1, provider, session: raw.session_id, state,
        label: typeof (raw.project_root || raw.cwd) === 'string' ? (raw.project_root || raw.cwd).replace(/\/$/, '').split('/').pop() : '',
        title: nativeTask ? '' : raw.session_title,
        lifecycle: nativeTask ? 'task' : hook === 'Stop' ? 'stop' : '',
        tasks: provider === 'claude' && ['Stop', 'SubagentStop'].includes(hook) ? raw.background_tasks : null,
        taskDelta: nativeTask ? {id:raw.agent_id, kind:'subagent', status:hook === 'SubagentStart' ? 'running' : 'completed'} :
            provider === 'claude' && hook === 'PostToolUse' && (raw.tool_response?.backgroundTaskId || raw.tool_response?.background_task_id)
                ? {id:raw.tool_response.backgroundTaskId || raw.tool_response.background_task_id, kind:'background', status:'running'} :
            provider === 'claude' && hook === 'PostToolUse' && raw.tool_name === 'TaskOutput'
                ? {id:raw.tool_response?.task?.task_id, type:raw.tool_response?.task?.task_type, status:raw.tool_response?.task?.status} :
            provider === 'claude' && hook === 'PostToolUse' && raw.tool_name === 'TaskStop'
                ? {id:raw.tool_input?.task_id, kind:'background', status:'cancelled'} : null,
        turn: raw.turn_id, request: raw.tool_name || raw.notification_type,
        resolve: ['PostToolUse', 'PostToolUseFailure'].includes(hook) ||
            ['elicitation_complete', 'elicitation_response'].includes(raw.notification_type),
        start: hook === 'UserPromptSubmit', ...extra});
}

export class AgentStore {
    constructor() { this.rows = new Map(); this.dropped = 0; this.undo = null; this.sequence = 0; this.reportSequence = 0; }
    clear() { this.rows.clear(); this.dropped = 0; this.undo = null; }
    hide(ids) {
        const rows = ids.map(id => this.rows.get(id)).filter(row => row && !row.hidden && row.state !== 'closed');
        if (!rows.length) return;
        for (const row of rows) row.hidden = true;
        this.undo = {token: ++this.sequence, ids: rows.map(row => row.id)};
    }
    dismiss(id) { this.hide([id]); }
    clearFinished() { this.hide([...this.rows.values()].filter(row => row.state === 'finished').map(row => row.id)); }
    restore(token) {
        if (!this.undo || token !== this.undo.token) return;
        for (const id of this.undo.ids) { const row = this.rows.get(id); if (row) row.hidden = false; }
        this.undo = null;
    }
    expire(before) {
        // Called only when the Agents tab opens. A fresh report can recreate an
        // expired session; this removes tracking data, never the agent process.
        for (const [id, row] of this.rows) if (row.updated < before) this.rows.delete(id);
        this._derive();
        if (this.undo) {
            this.undo.ids = this.undo.ids.filter(id => this.rows.has(id));
            if (!this.undo.ids.length) this.undo = null;
        }
    }
    closeExited(id, report) {
        const row = this.rows.get(id);
        // An asynchronous process check must not close a newer report or a
        // recreated record. Closure is not successful task completion.
        if (!row || row.report !== report || row.state === 'closed') return false;
        return this.apply({...row, state:'closed', lifecycle:'', tasks:[], taskDelta:null,
            start:false, resolve:false, request:''}, row.updated);
    }
    control(value) {
        if (value.control === 'clear') this.clear();
        else if (value.control === 'dismiss' && typeof value.id === 'string') this.dismiss(value.id);
        else if (value.control === 'clear-finished') this.clearFinished();
        else if (value.control === 'restore' && Number.isSafeInteger(value.token)) this.restore(value.token);
        else if (value.control === 'expire' && Number.isSafeInteger(value.before) && value.before > 0 && value.before <= Date.now()) this.expire(value.before);
        else return false;
        return true;
    }
    apply(input, now = Date.now()) {
        const event = normalizeAgentEvent(input);
        if (!event) return false;
        const id = agentKey(event);
        let row = this.rows.get(id);
        if (row && event.lifecycle !== 'task' && event.at && event.at < row.at) return false;
        if (row && event.turn && row.retired.includes(event.turn)) return false;
        if (!row) {
            if (this.rows.size >= AGENT_LIMIT) {
                const rows = [...this.rows.values()];
                const done = rows.find(r => r.hidden) || rows.find(r => ['closed', 'finished', 'idle'].includes(r.state));
                if (done) this.rows.delete(done.id);
                else { this.dropped++; return false; }
            }
            row = {id, ...event, pending: Object.create(null), tasksById:new Map(), taskTimes:new Map(), taskEvents:new Map(), stopped:false,
                project:event.label, retired: [], updated: now, revision: 0};
            this.rows.set(id, row);
        }
        if (event.lifecycle !== 'task' && event.turn && row.turn && event.turn !== row.turn) {
            if (!event.start && !['working', 'approval', 'input'].includes(event.state)) return false;
            row.retired = [...row.retired, row.turn].slice(-8);
            row.pending = Object.create(null);
        }
        if (event.lifecycle === 'task') {
            if (row.state === 'closed') return false;
            this._tasks(row, event);
            row.report = ++this.reportSequence;
            row.updated = now;
            this._derive();
            return true;
        }
        this._tasks(row, event);
        if (event.lifecycle === 'stop' || event.state === 'finished') row.stopped = true;
        else if (event.start || ['working', 'closed', 'error', 'interrupted'].includes(event.state)) row.stopped = false;
        if (['closed', 'error', 'interrupted'].includes(event.state)) row.tasksById.clear();
        const outstanding = row.tasksById.size || this._children(row).length;
        if (event.start || ['closed', 'error', 'interrupted'].includes(event.state) ||
            event.state === 'finished' && !outstanding) row.pending = Object.create(null);
        const request = event.request || 'attention';
        if (['approval', 'input'].includes(event.state)) {
            if (Object.keys(row.pending).length < 16) row.pending[request] = event.state;
        } else if (event.resolve) {
            delete row.pending[request];
            if (request === 'AskUserQuestion' || request === 'request_user_input') delete row.pending.agent_needs_input;
            if (request.startsWith('elicitation_')) {
                delete row.pending.elicitation_dialog; delete row.pending.elicitation_url_dialog;
            }
            // Notification permission events have no tool identity.
            if (!Object.keys(row.pending).some(k => k !== 'permission_prompt')) delete row.pending.permission_prompt;
        }
        if (row.project === AGENTS[event.provider] && event.label !== AGENTS[event.provider]) row.project = event.label;
        const pending = Object.values(row.pending);
        const state = pending.includes('approval') ? 'approval' : pending.includes('input') ? 'input' : event.state;
        if (state !== row.state || event.start) row.revision++;
        Object.assign(row, {...event, title:event.title || row.title,
            label:event.title || row.title || row.project,
            process:event.process || row.process, parent:event.parent || row.parent,
            turn:event.turn || row.turn, state, updated: now, report:++this.reportSequence});
        this._derive();
        if (state === 'closed' && this.undo) {
            this.undo.ids = this.undo.ids.filter(hiddenId => hiddenId !== id);
            if (!this.undo.ids.length) this.undo = null;
        }
        return true;
    }
    _tasks(row, event) {
        if (event.tasks !== null && (!row.taskSnapshotAt || !event.at || event.at >= row.taskSnapshotAt)) {
            // A present array is authoritative; absence is not an empty array.
            row.tasksById.clear();
            for (const item of event.tasks) if (ACTIVE_TASKS.has(item.status)) row.tasksById.set(item.id, item);
            for (const {item, at} of row.taskEvents.values()) if (event.at && at > event.at) {
                if (ACTIVE_TASKS.has(item.status)) {
                    if (row.tasksById.size < 64 || row.tasksById.has(item.id)) row.tasksById.set(item.id, item);
                } else row.tasksById.delete(item.id);
            }
            row.taskSnapshotAt = event.at;
        }
        const item = event.taskDelta;
        if (!item || event.at && (event.at < (row.taskSnapshotAt || 0) || event.at <= (row.taskTimes.get(item.id) || 0))) return;
        if (!event.at && row.taskTimes.has(item.id) && ACTIVE_TASKS.has(item.status)) return;
        if (row.taskTimes.size >= 128) {
            const oldest = row.taskTimes.keys().next().value;
            row.taskTimes.delete(oldest); row.taskEvents.delete(oldest);
        }
        row.taskEvents.set(item.id, {item, at:event.at});
        row.taskTimes.set(item.id, event.at || 1);
        if (ACTIVE_TASKS.has(item.status)) {
            if (row.tasksById.size < 64) row.tasksById.set(item.id, item);
        } else row.tasksById.delete(item.id);
    }
    _parent(row) {
        const reference = row.parent;
        if (!reference || row.provider !== 'codex') return null;
        const parent = this.rows.get(agentKey(reference));
        // Only Claude -> Codex is supported. This directed provider pair also
        // rules out cycles; shared windows, projects and titles prove nothing.
        if (!parent || parent === row || parent.parent || !parent.process ||
            parent.process.pid !== reference.process.pid || parent.process.start !== reference.process.start) return null;
        return parent;
    }
    _children(row) {
        return [...this.rows.values()].filter(child => this._parent(child) === row &&
            ['working', 'waiting', 'approval', 'input'].includes(child.state));
    }
    _derive() {
        for (const row of this.rows.values()) {
            const parent = this._parent(row);
            if (parent) row.attribution = {provider:'claude', title:parent.label};
            if (!row.stopped || ['closed', 'error', 'interrupted'].includes(row.state)) continue;
            const tasks = [...row.tasksById.values()], children = this._children(row);
            if (tasks.length || children.length) row.waitingFor = children.length || tasks.some(t => t.kind === 'codex') ? 'codex' :
                tasks.some(t => t.kind === 'subagent') ? 'subagent' : 'background';
            row.taskCount = tasks.length;
            row.childCount = children.length;
            if (Object.keys(row.pending).length) continue;
            // Once waiting, child completion alone is not a parent Stop. Keep
            // waiting (possibly zero remaining tasks) until its next own event.
            if (tasks.length || children.length) row.state = 'waiting';
        }
    }
    setTitle(id, title) {
        const row = this.rows.get(id), clean = cleanText(title, 160).trim();
        if (!row || !clean || row.title === clean) return false;
        row.title = clean; row.label = clean; this._derive(); return true;
    }
    snapshot() {
        // SessionEnd is a provider report, not proof that a desktop window
        // closed. Keep the bounded record for late-event guards, but stop
        // showing ended sessions. New activity can make them visible again.
        const sessions = [...this.rows.values()].filter(row => !row.hidden && row.state !== 'closed').map(({pending, retired, hidden, tasksById, taskTimes, taskEvents, taskSnapshotAt, tasks, taskDelta, lifecycle, process, parent, stopped, project, report, ...row}) => ({...row}));
        const count = this.undo?.ids.filter(id => this.rows.has(id)).length || 0;
        return {v: 1, connected: true, sessions, dropped: this.dropped, counts: agentCounts(sessions),
            undo: count ? {token: this.undo.token, count} : null};
    }
}
export function agentCounts(rows = []) {
    return {working: rows.filter(r => r.state === 'working').length,
        waiting: rows.filter(r => r.state === 'waiting').length,
        attention: rows.filter(r => ['approval', 'input'].includes(r.state)).length,
        finished: rows.filter(r => r.state === 'finished').length};
}
export function agentSummary(rows = []) {
    const c = agentCounts(rows);
    return [c.working && `${c.working} working`, c.waiting && `${c.waiting} waiting`, c.attention && `${c.attention} needs you`,
        !c.working && !c.waiting && !c.attention && c.finished && `${c.finished} finished`].filter(Boolean).join(' · ') || (rows.length ? 'Idle' : 'No active sessions');
}

// Use the actual session ID, not row order or activity time. Shared suffixes
// grow only enough to distinguish records, including identical IDs in different
// profiles/providers, so the full ID never needs to be shown.
export function agentSessionReferences(rows = []) {
    const identities = rows.map(row => {
        const session = token(row.session || row.id);
        return {session, key: `${token(row.provider)}/${token(row.profile) || 'default'}/${session}`};
    });
    return new Map(rows.map((row, index) => {
        const {session, key} = identities[index];
        let length = Math.min(8, session.length);
        while (length < key.length && identities.some((other, otherIndex) =>
            otherIndex !== index && other.key !== key && other.key.endsWith(key.slice(-length)))) length++;
        const reference = key.slice(-length);
        return [row.id, `${length < session.length || length > session.length && length < key.length ? '…' : ''}${reference}`];
    }));
}

export const TERMINAL_NAMES = {'gnome-terminal':'GNOME Terminal', kgx:'GNOME Console',
    terminator:'Terminator', kitty:'Kitty', wezterm:'WezTerm'};
export const TERMINALS = Object.keys(TERMINAL_NAMES);
export function agentLaunchArgv(provider, executable, prompt, cwd, terminal) {
    if (!Object.hasOwn(AGENTS, provider) || ![...TERMINALS, 'x-terminal-emulator'].includes(terminal)) throw new Error('Choose a supported agent and terminal.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000 || prompt.includes('\0'))
        throw new Error('Enter a prompt of 1–16,000 characters.');
    if (!cwd?.startsWith('/') || cwd.includes('\0')) throw new Error('Choose an absolute project folder.');
    const command = provider === 'opencode' ? [executable, `--prompt=${prompt}`] : [executable, '--', prompt];
    if (terminal === 'gnome-terminal') return [terminal, '--window', `--working-directory=${cwd}`, '--', ...command];
    if (terminal === 'kgx') return [terminal, `--working-directory=${cwd}`, '--', ...command];
    if (terminal === 'terminator') return [terminal, `--working-directory=${cwd}`, '-x', ...command];
    if (terminal === 'x-terminal-emulator') return [terminal, '-e', ...command];
    if (terminal === 'kitty') return [terminal, '--directory', cwd, '--', ...command];
    return [terminal, 'start', '--cwd', cwd, '--', ...command];
}
