export const HOOK_MARKER = ' # ubuntu-island-agent-v1';
const HOOK_LABELS = {
    SessionStart: 'Session start', UserPromptSubmit: 'Prompt submitted',
    PermissionRequest: 'Approval needed', Stop: 'Task finished', SessionEnd: 'Session ended',
    Interrupt: 'Task interrupted', StopFailure: 'Task failed', Notification: 'Attention needed',
    PreToolUse: 'Input requested', PostToolUse: 'Tool finished', PostToolUseFailure: 'Tool failed',
};
export function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function ownedHook(hook) {
    return hook?.type === 'command' && typeof hook.command === 'string' && hook.command.endsWith(HOOK_MARKER);
}
export function hasAgentHooks(current) {
    return Object.values(current.hooks || {}).some(groups => Array.isArray(groups) &&
        groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(ownedHook)));
}
export function hookEntries(provider, relay, gjs = '/usr/bin/gjs') {
    const handler = event => {
        // Both harnesses support statusMessage as the human-readable hook label.
        // Also label the shell comment for menus that display only the command.
        const statusMessage = `Ubuntu Island: ${HOOK_LABELS[event]}`;
        const command = `${shellQuote(gjs)} -m ${shellQuote(relay)} ${provider} # ${statusMessage}${HOOK_MARKER}`;
        return {type: 'command', command, timeout: 1, statusMessage};
    };
    const events = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd'];
    if (provider === 'codex') events.push('Interrupt');
    if (provider === 'claude') events.push('StopFailure', 'Notification');
    const result = Object.fromEntries(events.map(event => [event, [{hooks: [handler(event)]}]]));
    if (provider === 'claude') result.Notification[0].matcher = 'permission_prompt|elicitation_dialog|elicitation_url_dialog|elicitation_complete|elicitation_response|agent_needs_input';
    result.PreToolUse = [{matcher: provider === 'claude' ? 'AskUserQuestion' : 'request_user_input', hooks: [handler('PreToolUse')]}];
    result.PostToolUse = [{hooks: [handler('PostToolUse')]}];
    if (provider === 'claude') result.PostToolUseFailure = [{hooks: [handler('PostToolUseFailure')]}];
    return result;
}
export function mergeAgentHooks(current, provider, relay, install) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('Expected a JSON object.');
    const result = JSON.parse(JSON.stringify(current));
    if (result.hooks !== undefined && (!result.hooks || typeof result.hooks !== 'object' || Array.isArray(result.hooks))) throw new Error('Unsupported hooks format.');
    const hooks = result.hooks || {};
    for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) throw new Error('Unsupported hook groups.');
        hooks[event] = groups.flatMap(group => {
            if (!group || Array.isArray(group) || !Array.isArray(group.hooks)) throw new Error('Unsupported hook handlers.');
            const remaining = group.hooks.filter(hook => !ownedHook(hook));
            // Leave every unrelated group intact, including intentionally empty ones.
            if (remaining.length === group.hooks.length) return [group];
            return remaining.length ? [{...group, hooks: remaining}] : [];
        });
        if (groups.length && !hooks[event].length) delete hooks[event];
    }
    if (install) for (const [event, groups] of Object.entries(hookEntries(provider, relay)))
        hooks[event] = [...(hooks[event] || []), ...groups];
    if (Object.keys(hooks).length) result.hooks = hooks;
    else if (Object.keys(current.hooks || {}).length) delete result.hooks;
    return result;
}

// Local plugin, no package install and no imports of agent credentials/transcripts.
export function openCodePlugin(socketPath, major = 1) {
    const observe = `
import net from 'node:net';
import {createHash} from 'node:crypto';
const socketPath = ${JSON.stringify(socketPath)};
const profile = createHash('sha256').update(process.env.XDG_CONFIG_HOME || 'default').digest('hex').slice(0,16);
const clean = (v, n = 128) => typeof v === 'string' ? v.replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, '').slice(0,n) : '';
let active = 0;
function forward(event, directory) {
  const p = event.properties || event.data || {};
  const states = {'session.created':'idle','session.idle':'finished','session.error':'error',
    'session.deleted':'closed','session.execution.started':'working','session.execution.succeeded':'finished',
    'session.execution.failed':'error','session.execution.interrupted':'interrupted',
    'permission.asked':'approval','permission.replied':'working','question.asked':'input',
    'question.replied':'working','question.rejected':'working','form.created':'input','form.replied':'working','form.cancelled':'working'};
  let state = states[event.type];
  if (event.type === 'session.status') state = {busy:'working',idle:'finished',retry:'working'}[p.status?.type];
  const session = p.sessionID || p.sessionId || p.info?.id;
  if (!state || !session || active >= 4) return;
  const input = JSON.stringify({v:1,provider:'opencode',session:clean(session),state,
    label:clean(directory?.split('/').pop(),80),profile,
    start:event.type === 'session.execution.started',
    request:event.type.startsWith('permission.') ? 'permission' : event.type.startsWith('question.') || event.type.startsWith('form.') ? 'question' : '',
    resolve:['permission.replied','question.replied','question.rejected','form.replied','form.cancelled'].includes(event.type),
    terminal:{kind:'terminator',bus:process.env.TERMINATOR_DBUS_NAME,id:process.env.TERMINATOR_UUID},
    at:Number(process.hrtime.bigint()/1000000n),pids:[process.ppid],launch:clean(process.env.UBUNTU_ISLAND_AGENT_LAUNCH,64)});
  active++;
  const socket = net.createConnection(socketPath);
  socket.setTimeout(500, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('close', () => active--);
  socket.on('connect', () => socket.end(input));
}
`;
    return `// ubuntu-island-agent-v1\n${observe}${major === 2 ? `
export default {id:'ubuntu-island-status',setup(ctx) {
  const abort = new AbortController();
  void (async () => { try {
    for await (const event of ctx.event.subscribe({signal:abort.signal,types:[
      'session.created','session.execution.started','session.execution.succeeded','session.execution.failed',
      'session.execution.interrupted','session.deleted','permission.asked','permission.replied',
      'form.created','form.replied','form.cancelled']})) forward(event, ctx.location.directory);
  } catch {} })();
  return () => abort.abort();
}};
` : `
export const UbuntuIslandStatus = async ({directory}) => ({
  event: async ({event}) => { forward(event, directory); }
});
`}`;
}
