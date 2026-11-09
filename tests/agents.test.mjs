import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentStore, fromAgentHook, normalizeAgentEvent, agentLaunchArgv, agentCounts} from '../services/agents-model.js';
import {mergeAgentHooks, hookEntries, openCodePlugin} from '../services/agents-setup-model.js';

const event = (state, changes = {}) => ({v:1,provider:'claude',session:'one',state,...changes});
test('agent observer never forwards hook prompt, tool arguments or transcript paths',()=>{
    const result = fromAgentHook('claude',{hook_event_name:'UserPromptSubmit',session_id:'x',cwd:'/private/project',
        prompt:'SECRET',transcript_path:'/secret',tool_input:{password:'SECRET'}},{at:1});
    assert.equal(result.label,'project'); assert.equal(result.state,'working');
    assert.ok(!JSON.stringify(result).includes('SECRET')); assert.ok(!JSON.stringify(result).includes('/private'));
    assert.equal(fromAgentHook('claude',{hook_event_name:'Notification',notification_type:'idle_prompt',session_id:'x'}),null);
    assert.equal(normalizeAgentEvent(event('bogus')),null);
    assert.equal(normalizeAgentEvent(event('working',{provider:'__proto__'})),null);
});
test('permission state survives unrelated work and resolves on the matching tool',()=>{
    const store = new AgentStore();
    store.apply(event('working',{start:true,turn:'a',at:1}));
    store.apply(event('approval',{request:'Bash',turn:'a',at:2}));
    store.apply(event('working',{request:'Read',resolve:true,turn:'a',at:3}));
    assert.equal(store.snapshot().sessions[0].state,'approval');
    store.apply(event('working',{request:'Bash',resolve:true,turn:'a',at:4}));
    assert.equal(store.snapshot().sessions[0].state,'working');
});
test('old turn completion cannot overwrite new work, even with a newer arrival time',()=>{
    const store = new AgentStore();
    store.apply(event('working',{turn:'a',start:true,at:1}));
    store.apply(event('working',{turn:'b',start:true,at:3}));
    assert.equal(store.apply(event('finished',{turn:'a',at:4})),false);
    assert.equal(store.apply(event('finished',{turn:'b',at:2})),false);
    assert.equal(store.snapshot().sessions[0].state,'working');
});
test('session caps preserve active work and profiles stay distinct',()=>{
    const store = new AgentStore();
    for(let i=0;i<32;i++)store.apply(event('working',{profile:String(i)}));
    assert.equal(store.apply(event('working',{profile:'extra'})),false);
    assert.equal(store.snapshot().dropped,1); assert.equal(agentCounts(store.snapshot().sessions).working,32);
    store.apply(event('finished',{profile:'0'}));
    assert.equal(store.apply(event('working',{profile:'extra'})),true);
    assert.equal(store.snapshot().sessions.length,32);
    store.clear();assert.equal(store.snapshot().sessions.length,0);
});
test('hook installation merges owned handlers and removal preserves other hooks',()=>{
    const original={permissions:{allow:['Read']},hooks:{Stop:[{matcher:'',hooks:[{type:'command',command:'notify-existing'}]}]}};
    const next=mergeAgentHooks(original,'claude','/path with spaces/relay.js',true);
    assert.deepEqual(next.permissions,original.permissions);
    assert.equal(next.hooks.Stop.length,2);
    assert.deepEqual(mergeAgentHooks(next,'claude','/path with spaces/relay.js',true),next);
    assert.deepEqual(mergeAgentHooks(next,'claude','/path with spaces/relay.js',false),original);
    assert.equal(hookEntries('codex','/relay').Interrupt[0].hooks[0].timeout,1);
    assert.throws(()=>mergeAgentHooks({hooks:{Stop:{bad:true}}},'claude','/relay',true));
});
test('launches preserve literal prompts and never weaken provider permissions',()=>{
    const prompt='--help\n$(touch /tmp/nope); `command` "quoted" مرحبا';
    for(const terminal of ['gnome-terminal','kgx','kitty','wezterm']) {
        const args=agentLaunchArgv('claude','/bin/claude',prompt,'/project with spaces',terminal);
        assert.equal(args.at(-1),prompt); assert.equal(args.at(-2),'--');
        assert.ok(!args.includes('sh'));assert.ok(!args.includes('-c'));
    }
    assert.equal(agentLaunchArgv('opencode','/bin/opencode',prompt,'/project','kitty').at(-1),`--prompt=${prompt}`);
    assert.throws(()=>agentLaunchArgv('claude','/bin/claude','', '/project','kitty'));
    assert.throws(()=>agentLaunchArgv('claude','/bin/claude','x', '/project','sh -c'));
});
test('OpenCode plugins use only a local socket and filter content events',()=>{
    for(const major of [1,2]) {
        const source=openCodePlugin('/run/user/1/private.sock',major);
        assert.ok(source.startsWith('// ubuntu-island-agent-v1'));
        assert.ok(!source.includes('fetch('));assert.ok(!source.includes('tool_input'));
        assert.match(source,/if \(!state \|\| !session/);
    }
});
