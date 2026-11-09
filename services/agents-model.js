// Protocol and presentation only: no filesystem, credentials, or Shell imports.
export const AGENTS = {claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode'};
export const AGENT_STATES = {
    working: 'Working', approval: 'Needs approval', input: 'Needs input',
    finished: 'Turn finished', idle: 'Idle', error: 'Error', interrupted: 'Interrupted',
    closed: 'Closed', unknown: 'Unknown',
};
export const AGENT_LIMIT = 32;
export const cleanText = (value, limit = 128) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, limit) : '';
const token = value => cleanText(value, 128);
export function normalizeAgentEvent(value) {
    if (!value || value.v !== 1 || !Object.hasOwn(AGENTS, value.provider) ||
        !Object.hasOwn(AGENT_STATES, value.state) || !token(value.session)) return null;
    return {v: 1, provider: value.provider, session: token(value.session),
        profile: token(value.profile) || 'default', state: value.state,
        label: cleanText(value.label, 80) || AGENTS[value.provider],
        turn: token(value.turn), request: token(value.request), resolve: Boolean(value.resolve),
        start: Boolean(value.start), at: Number.isFinite(value.at) && value.at > 0 ? value.at : 0,
        launch: /^[a-zA-Z0-9-]{1,64}$/.test(value.launch ?? '') ? value.launch : '',
        pids: Array.isArray(value.pids) ? value.pids.filter(p => Number.isSafeInteger(p) && p > 1).slice(0, 16) : [],
    };
}

export function fromAgentHook(provider, raw, extra = {}) {
    if (!raw || !Object.hasOwn(AGENTS, provider)) return null;
    const hook = raw.hook_event_name;
    let state = {SessionStart: 'idle', UserPromptSubmit: 'working', PermissionRequest: 'approval',
        Stop: 'finished', StopFailure: 'error', SessionEnd: 'closed', Interrupt: 'interrupted',
        PreToolUse: 'working', PostToolUse: 'working', PostToolUseFailure: 'working'}[hook];
    if (hook === 'PreToolUse' && ['AskUserQuestion', 'request_user_input'].includes(raw.tool_name)) state = 'input';
    if (hook === 'Notification') state = {
        permission_prompt: 'approval', elicitation_dialog: 'input', elicitation_url_dialog: 'input',
        agent_needs_input: 'input', elicitation_complete: 'working', elicitation_response: 'working',
    }[raw.notification_type];
    if (!state) return null;
    return normalizeAgentEvent({v: 1, provider, session: raw.session_id, state,
        label: typeof raw.cwd === 'string' ? raw.cwd.replace(/\/$/, '').split('/').pop() : '',
        turn: raw.turn_id, request: raw.tool_name || raw.notification_type,
        resolve: ['PostToolUse', 'PostToolUseFailure'].includes(hook) ||
            ['elicitation_complete', 'elicitation_response'].includes(raw.notification_type),
        start: hook === 'UserPromptSubmit', ...extra});
}

export class AgentStore {
    constructor() { this.rows = new Map(); this.dropped = 0; }
    clear() { this.rows.clear(); this.dropped = 0; }
    dismiss(id) { this.rows.delete(id); }
    apply(input, now = Date.now()) {
        const event = normalizeAgentEvent(input);
        if (!event) return false;
        const id = JSON.stringify([event.provider, event.profile, event.session]);
        let row = this.rows.get(id);
        if (row && event.at && event.at < row.at) return false;
        if (row && event.turn && row.retired.includes(event.turn)) return false;
        if (!row) {
            if (this.rows.size >= AGENT_LIMIT) {
                const done = [...this.rows.values()].find(r => ['closed', 'finished', 'idle'].includes(r.state));
                if (done) this.rows.delete(done.id);
                else { this.dropped++; return false; }
            }
            row = {id, ...event, pending: Object.create(null), retired: [], updated: now, revision: 0};
            this.rows.set(id, row);
        }
        if (event.turn && row.turn && event.turn !== row.turn) {
            if (!event.start && !['working', 'approval', 'input'].includes(event.state)) return false;
            row.retired = [...row.retired, row.turn].slice(-8);
            row.pending = Object.create(null);
        }
        if (event.start || ['finished', 'closed', 'error', 'interrupted'].includes(event.state)) row.pending = Object.create(null);
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
        const pending = Object.values(row.pending);
        const state = pending.includes('approval') ? 'approval' : pending.includes('input') ? 'input' : event.state;
        if (state !== row.state || event.start) row.revision++;
        Object.assign(row, {...event, turn: event.turn || row.turn, state, updated: now});
        return true;
    }
    snapshot() {
        const sessions = [...this.rows.values()].map(({pending, retired, ...row}) => ({...row}));
        return {v: 1, connected: true, sessions, dropped: this.dropped, counts: agentCounts(sessions)};
    }
}
export function agentCounts(rows = []) {
    return {working: rows.filter(r => r.state === 'working').length,
        attention: rows.filter(r => ['approval', 'input'].includes(r.state)).length,
        finished: rows.filter(r => r.state === 'finished').length};
}
export function agentSummary(rows = []) {
    const c = agentCounts(rows);
    return [c.working && `${c.working} working`, c.attention && `${c.attention} needs you`,
        !c.working && !c.attention && c.finished && `${c.finished} finished`].filter(Boolean).join(' · ') || 'No active turns';
}

export const AGENT_SITES = {claude: 'https://claude.ai/new', codex: 'https://chatgpt.com/codex', opencode: 'https://opencode.ai/'};
export const TERMINALS = ['gnome-terminal', 'kgx', 'kitty', 'wezterm'];
export function agentLaunchArgv(provider, executable, prompt, cwd, terminal) {
    if (!Object.hasOwn(AGENTS, provider) || !TERMINALS.includes(terminal)) throw new Error('Choose a supported agent and terminal.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000 || prompt.includes('\0'))
        throw new Error('Enter a prompt of 1–16,000 characters.');
    if (!cwd?.startsWith('/') || cwd.includes('\0')) throw new Error('Choose an absolute project folder.');
    const command = provider === 'opencode' ? [executable, `--prompt=${prompt}`] : [executable, '--', prompt];
    if (terminal === 'gnome-terminal') return [terminal, '--window', `--working-directory=${cwd}`, '--', ...command];
    if (terminal === 'kgx') return [terminal, `--working-directory=${cwd}`, '--', ...command];
    if (terminal === 'kitty') return [terminal, '--directory', cwd, '--', ...command];
    return [terminal, 'start', '--cwd', cwd, '--', ...command];
}
