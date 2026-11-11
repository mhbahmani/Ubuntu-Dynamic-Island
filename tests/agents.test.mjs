import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentStore, fromAgentHook, normalizeAgentEvent, agentLaunchArgv, agentCounts} from '../services/agents-model.js';
import {HOOK_MARKER, hasAgentHooks, mergeAgentHooks, hookEntries, openCodePlugin} from '../services/agents-setup-model.js';

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
test('all observer hooks have readable labels and upgrade legacy handlers without duplicates',()=>{
    for (const provider of ['claude','codex']) {
        const hooks=hookEntries(provider,'/new/relay.js');
        const labels=[];
        for (const groups of Object.values(hooks)) for (const group of groups) for (const hook of group.hooks) {
            assert.match(hook.statusMessage,/^Ubuntu Island: [A-Z]/);
            assert.ok(hook.command.includes(`# ${hook.statusMessage}`));
            assert.ok(hook.command.endsWith(HOOK_MARKER));
            labels.push(hook.statusMessage);
        }
        assert.equal(new Set(labels).size,labels.length);
        const legacy={hooks:{Stop:[{hooks:[{type:'command',command:`'/usr/bin/gjs' -m '/old/relay.js' ${provider}${HOOK_MARKER}`,timeout:1}]}]}};
        assert.equal(hasAgentHooks(legacy),true);
        assert.deepEqual(mergeAgentHooks(legacy,provider,'/new/relay.js',true),{hooks});
    }
});
test('setup preserves mixed handlers, custom metadata, names and empty groups',()=>{
    const userHooks=[
        {type:'command',command:'echo custom',statusMessage:'Ubuntu Island: Turn finished',timeout:20,async:true},
        {type:'prompt',prompt:'Check work',command:`unrelated${HOOK_MARKER}`},
        {type:'http',url:'https://example.invalid/hook',headers:{'X-Test':'kept'}},
        {type:'command',command:`echo '${HOOK_MARKER}'`},
    ];
    const original={description:'My hooks',permissions:{allow:['Read']},extra:{nested:['preserve']},hooks:{
        Stop:[{matcher:'custom',name:'My group',extra:{flag:true},hooks:userHooks},{matcher:'empty',hooks:[]}],
        CustomEvent:[], FutureEvent:[{matcher:'future',hooks:[]}],
    }};
    const snapshot=JSON.stringify(original);
    assert.equal(hasAgentHooks(original),false,'A matching label or marker mentioned as text is not ownership');
    for (const provider of ['claude','codex']) {
        const mixed=structuredClone(original);
        mixed.hooks.Stop[0].hooks.splice(1,0,{type:'command',command:`old relay ${provider}${HOOK_MARKER}`});
        assert.deepEqual(mergeAgentHooks(mixed,provider,'/relay',false),original);
        const installed=mergeAgentHooks(mixed,provider,'/relay',true);
        assert.deepEqual(installed.hooks.Stop.slice(0,2),original.hooks.Stop);
        assert.deepEqual(mergeAgentHooks(installed,provider,'/relay',false),original);
        assert.deepEqual(mergeAgentHooks(installed,provider,'/relay',true),installed);
    }
    assert.equal(JSON.stringify(original),snapshot,'Merging mutated its input');
    assert.deepEqual(mergeAgentHooks({hooks:{}},'claude','/relay',false),{hooks:{}});
});
test('hide and undo retain live status without resurfacing hidden sessions on events',()=>{
    const store = new AgentStore(); store.apply(event('working'));
    const id = store.snapshot().sessions[0].id;
    store.control({control:'dismiss',id});
    const undo = store.snapshot().undo;
    assert.equal(undo.count,1); assert.equal(store.snapshot().sessions.length,0);
    store.apply(event('input')); assert.equal(store.snapshot().sessions.length,0);
    store.control({control:'restore',token:undo.token + 1});
    assert.equal(store.snapshot().sessions.length,0);
    store.control({control:'restore',token:undo.token});
    assert.equal(store.snapshot().sessions[0].state,'input'); assert.equal(store.snapshot().undo,null);
});
test('inactivity cleanup is explicit, uses the last report, and includes every state',()=>{
    const store=new AgentStore(), before=100000;
    for (const state of ['working','approval','input','finished','closed','idle'])
        store.apply(event(state,{session:state}),before-1);
    store.apply(event('working',{session:'boundary'}),before);
    store.apply(event('working',{session:'fresh'}),before+1);
    assert.equal(store.snapshot().sessions.length,8,'Reading a snapshot performed background expiry');
    assert.equal(store.control({control:'expire',before}),true);
    assert.deepEqual(store.snapshot().sessions.map(s=>s.session),['boundary','fresh']);
    store.apply(event('working',{session:'working'}),before+2);
    assert.equal(store.snapshot().sessions.length,3,'New activity did not recreate an expired session');
    assert.equal(store.control({control:'expire',before:Date.now()+60000}),false);
    assert.equal(store.control({control:'expire',before:NaN}),false);
});
test('expiry preserves reports received after opening and cannot undo expired rows',()=>{
    const store=new AgentStore();
    store.apply(event('finished',{session:'old'}),100);
    store.apply(event('finished',{session:'fresh'}),300);
    store.clearFinished();
    const token=store.snapshot().undo.token;
    store.expire(200);
    assert.equal(store.snapshot().undo.count,1);
    store.restore(token);
    assert.deepEqual(store.snapshot().sessions.map(s=>s.session),['fresh']);
    store.apply(event('working',{session:'fresh',at:2}),400);
    store.expire(350);
    assert.equal(store.snapshot().sessions[0].state,'working');
    store.dismiss(store.snapshot().sessions[0].id);
    store.expire(500);
    assert.equal(store.rows.size,0); assert.equal(store.snapshot().undo,null);
});
test('clear finished uses current states, leaves active work alone and bounds undo storage',()=>{
    const store = new AgentStore();
    for (const state of ['finished','closed','working','input','approval','error']) store.apply(event(state,{session:state}));
    store.control({control:'clear-finished'});
    assert.deepEqual(store.snapshot().sessions.map(s=>s.state),['working','input','approval','error']);
    const token = store.snapshot().undo.token;
    store.apply(event('working',{session:'finished',start:true}));
    store.restore(token);
    assert.equal(store.snapshot().sessions.find(s=>s.session==='finished').state,'working');
    store.dismiss(store.snapshot().sessions[0].id);
    const older = store.snapshot().undo.token;
    store.dismiss(store.snapshot().sessions[0].id);
    store.restore(older); assert.equal(store.snapshot().sessions.length,4);
    for (let i=0;i<40;i++) store.apply(event('working',{session:`extra-${i}`}));
    assert.equal(store.rows.size,32); assert.equal(store.snapshot().undo,null);
    store.clear(); assert.equal(store.snapshot().undo,null);
});
test('launches preserve literal prompts and never weaken provider permissions',()=>{
    const prompt='--help\n$(touch /tmp/nope); `command` "quoted" مرحبا';
    for(const terminal of ['gnome-terminal','kgx','terminator','kitty','wezterm','x-terminal-emulator']) {
        const args=agentLaunchArgv('claude','/bin/claude',prompt,'/project with spaces',terminal);
        assert.equal(args.at(-1),prompt); assert.equal(args.at(-2),'--');
        assert.ok(!args.includes('sh'));assert.ok(!args.includes('-c'));
    }
    assert.deepEqual(agentLaunchArgv('claude','/bin/claude',prompt,'/project with spaces','terminator'),
        ['terminator','--working-directory=/project with spaces','-x','/bin/claude','--',prompt]);
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
