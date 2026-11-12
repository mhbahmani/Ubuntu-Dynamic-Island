import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentStore, fromAgentHook, agentKey, agentCounts, agentSummary, agentStatus, agentNotificationNeeded, matchAgentWindow, normalizeAgentEvent} from '../services/agents-model.js';
import {hookEntries, mergeAgentHooks} from '../services/agents-setup-model.js';
const hook = (name, data = {}, extra = {}) => fromAgentHook('claude', {session_id:'parent',hook_event_name:name,cwd:'/repo/project',...data},extra);
const rows = store => store.snapshot().sessions;
const parent = store => rows(store).find(r => r.session === 'parent');
const process = {pid:91,start:'1000'};
const reference = {provider:'claude',profile:'default',session:'parent',process};
const child = (state = 'working', changes = {}) => ({v:1, provider:'codex',session:'child',state,parent:reference,pids:[92,91,42],...changes});

test('titles stay stable across cwd changes, missing metadata, renames and sanitized input', () => {
    const store = new AgentStore(); store.apply(hook('SessionStart'));
    store.apply(hook('PostToolUse',{cwd:'/scratchpad/before'}));
    assert.equal(parent(store).label,'project');
    store.apply(hook('UserPromptSubmit',{session_title:'Codex 3 fixes review'}));
    store.apply(hook('Stop',{cwd:'/scratchpad/before'}));
    assert.equal(parent(store).label,'Codex 3 fixes review');
    const before = parent(store);
    store.setTitle(before.id,'Renamed\u0000\u202e title');
    assert.equal(parent(store).label,'Renamed title');
    assert.equal(parent(store).updated,before.updated);
    assert.equal(parent(store).revision,before.revision);
    assert.equal(store.setTitle(before.id,null),false);
    assert.equal(parent(store).label,'Renamed title');
    store.setTitle(before.id,'x'.repeat(1000)); assert.equal(parent(store).label.length,160);
});
test('Stop with each supported task kind waits and excludes notifications and Clear finished', () => {
    for (const [type, label] of [['codex','Waiting for Codex'],['subagent','Waiting for subagent'],['shell','Waiting for background task']]) {
        const store = new AgentStore();
        store.apply(hook('Stop',{background_tasks:[{id:'one',type,status:'running',command:'SECRET',description:'SECRET'}]}));
        assert.equal(agentStatus(parent(store)),label);
        assert.deepEqual(agentCounts(rows(store)),{working:0,waiting:1,attention:0,finished:0});
        assert.equal(agentSummary(rows(store)),'1 waiting');
        assert.equal(agentNotificationNeeded(null,parent(store)),false);
        store.clearFinished(); assert.equal(rows(store).length,1); assert.equal(store.snapshot().undo,null);
        assert.ok(!JSON.stringify(store.snapshot()).includes('SECRET'));
    }
});
test('multiple tasks, duplicates, failure and cancellation do not prematurely finish the parent', () => {
    const store = new AgentStore();
    store.apply(hook('SubagentStart',{agent_id:'a'}, {at:1}));
    store.apply(hook('SubagentStart',{agent_id:'b'}, {at:2}));
    store.apply(hook('Stop',{}, {at:3})); assert.equal(parent(store).taskCount,2);
    store.apply(hook('SubagentStop',{agent_id:'a'}, {at:4}));
    store.apply(hook('SubagentStop',{agent_id:'a'}, {at:4}));
    assert.equal(parent(store).taskCount,1);
    store.apply(hook('SubagentStart',{agent_id:'a'}, {at:2})); assert.equal(parent(store).taskCount,1);
    store.apply(hook('SubagentStop',{agent_id:'b'}, {at:5}));
    assert.equal(parent(store).state,'waiting'); assert.equal(parent(store).taskCount,0);
    store.apply(hook('Stop',{background_tasks:[]}, {at:6})); assert.equal(parent(store).state,'finished');
    assert.equal(agentNotificationNeeded({state:'waiting'},parent(store)),true);
    for (const status of ['failed','cancelled','canceled','completed']) {
        store.apply(hook('Stop',{background_tasks:[{id:'task',type:'shell',status}]}));
        assert.equal(parent(store).state,'finished');
    }
    // Snapshot entries are in flight by definition; status is free text.
    for (const status of ['starting','Paused',undefined]) {
        const fresh = new AgentStore();
        fresh.apply(hook('Stop',{background_tasks:[{id:'task',type:'shell',status}]}));
        assert.equal(parent(fresh).state,'waiting', String(status));
    }
});
test('background Bash task lifecycle uses IDs only, parent resumes and approval stays distinct', () => {
    const store = new AgentStore();
    store.apply(hook('PostToolUse',{tool_name:'Bash',tool_response:{backgroundTaskId:'shell',stdout:'SECRET'}}));
    store.apply(hook('Stop')); assert.equal(parent(store).state,'waiting');
    store.apply(hook('PostToolUse',{tool_name:'Read'})); assert.equal(parent(store).state,'working');
    store.apply(hook('PermissionRequest',{tool_name:'Bash'}));
    store.apply(hook('Stop')); assert.equal(parent(store).state,'approval');
    store.apply(hook('PostToolUse',{tool_name:'Bash'})); assert.equal(parent(store).state,'working');
    store.apply(hook('Stop')); assert.equal(parent(store).state,'waiting');
    store.apply(hook('PostToolUse',{tool_name:'TaskStop',tool_input:{task_id:'shell',command:'SECRET'}}));
    store.apply(hook('Stop')); assert.equal(parent(store).state,'finished');
    assert.ok(!JSON.stringify(rows(store)).includes('SECRET'));
});
test('child-context hooks cannot change the parent title, state, attention or tasks', () => {
    const store = new AgentStore(); store.apply(hook('SessionStart',{session_title:'Parent'}));
    for (const name of ['Stop','SessionEnd','PostToolUse','UserPromptSubmit','PermissionRequest']) {
        assert.equal(hook(name,{agent_id:'child',session_title:'Child',background_tasks:[]}),null);
        assert.equal(store.apply(hook(name,{agent_id:'child'})),false);
    }
    store.apply(hook('SubagentStart',{agent_id:'child',session_title:'Wrong'}));
    assert.equal(parent(store).label,'Parent'); assert.equal(parent(store).state,'idle');
});
test('old providers keep stable fallback and unknown task lists do not clear known tasks', () => {
    const store = new AgentStore(); store.apply(hook('Stop')); assert.equal(parent(store).state,'finished');
    store.apply(hook('SubagentStart',{agent_id:'s'})); store.apply(hook('Stop'));
    assert.equal(parent(store).state,'waiting');
    store.apply(hook('SessionStart')); store.apply(hook('Stop'));
    assert.equal(parent(store).state,'waiting');
    store.apply(hook('Stop',{background_tasks:[]})); assert.equal(parent(store).state,'finished');
});
test('late Stop snapshots and subagent events preserve newer task evidence', () => {
    const store = new AgentStore();
    store.apply(hook('UserPromptSubmit',{}, {at:1,turn:'first'}));
    store.apply(hook('SubagentStart',{agent_id:'s'}, {at:10}));
    store.apply(hook('Stop',{background_tasks:[]}, {at:5,turn:'first'}));
    assert.equal(parent(store).state,'waiting'); assert.equal(parent(store).taskCount,1);
    store.apply(hook('SubagentStop',{agent_id:'s'}, {at:11}));
    store.apply(hook('Stop',{background_tasks:[{id:'s',type:'subagent',status:'running'}]}, {at:6,turn:'first'}));
    assert.equal(parent(store).taskCount,0);
    store.apply(hook('UserPromptSubmit',{}, {at:12,turn:'second'}));
    assert.equal(store.apply(hook('Stop',{}, {at:13,turn:'first'})),false);
    assert.equal(parent(store).state,'working');
});
test('verified child-first links follow parent rename, hide, finish and removal without changing activation', () => {
    const store = new AgentStore(); store.apply(child());
    assert.equal(rows(store)[0].attribution,undefined);
    store.apply(hook('SessionStart',{session_title:'Named parent'},{process}));
    const getChild = () => rows(store).find(r => r.provider === 'codex');
    assert.deepEqual(getChild().attribution,{provider:'claude',title:'Named parent'});
    assert.equal(parent(store).state,'idle','Existing child does not imply waiting');
    store.setTitle(parent(store).id,'Renamed parent'); assert.equal(getChild().attribution.title,'Renamed parent');
    store.apply(hook('Stop')); assert.equal(agentStatus(parent(store)),'Waiting for Codex');
    store.dismiss(parent(store).id); assert.equal(getChild().attribution.title,'Renamed parent');
    store.apply(child('finished')); assert.equal(store.rows.get(agentKey(reference)).state,'waiting');
    store.apply(hook('Stop',{background_tasks:[]}));
    const window = {pid:42,title:'Host'};
    assert.equal(matchAgentWindow(getChild(),[window]),window);
    store.rows.delete(agentKey(reference));
    assert.equal(getChild().attribution.title,'Renamed parent','Attribution survives removal without implying liveness');
});
test('multiple verified Codex children fail/cancel independently and never finish parent by themselves', () => {
    const store = new AgentStore(); store.apply(hook('UserPromptSubmit',{}, {process}));
    store.apply(child()); store.apply(child('working',{session:'second'}));
    store.apply(hook('Stop')); assert.equal(parent(store).childCount,2);
    store.apply(child('error')); assert.equal(parent(store).childCount,1);
    store.apply(child('interrupted',{session:'second'}));
    assert.equal(parent(store).state,'waiting'); assert.equal(parent(store).childCount,0);
    store.apply(hook('UserPromptSubmit')); assert.equal(parent(store).state,'working');
    store.apply(hook('SessionEnd')); assert.equal(parent(store),undefined);
});
test('unverified, ambiguous, cross-profile, recycled PID, self and cycle references never resolve', () => {
    for (const changes of [
        {parent:null}, {parent:{...reference,process:null}},
        {parent:{...reference,profile:'other'}}, {parent:{...reference,process:{...process,start:'2000'}}},
        {parent:{...reference,session:'child'}}, {parent:{...reference,provider:'codex'}},
    ]) {
        const store = new AgentStore(); store.apply(hook('SessionStart',{}, {process,pids:[42]}));
        store.apply(child('working',{label:'project',...changes}));
        assert.equal(rows(store).find(r=>r.provider==='codex').attribution,undefined);
    }
    assert.equal(normalizeAgentEvent({...hook('SessionStart'),parent:{provider:'codex',session:'child',process}}).parent,null);
    const store = new AgentStore(); store.apply(hook('SessionStart',{}, {process:null,pids:[42,91]})); store.apply(child());
    assert.equal(rows(store)[1].attribution,undefined,'Shared ancestor PIDs alone are insufficient');
});
test('hook upgrades own subagent hooks idempotently and preserve unrelated groups', () => {
    const original = {hooks:{SubagentStart:[{matcher:'Explore',hooks:[{type:'command',command:'keep'}]}]}};
    const installed = mergeAgentHooks(original,'claude','/relay',true);
    for (const name of ['SubagentStart','SubagentStop']) assert.ok(hookEntries('claude','/relay')[name]);
    assert.deepEqual(mergeAgentHooks(installed,'claude','/relay',true),installed);
    assert.deepEqual(mergeAgentHooks(installed,'claude','/relay',false),original);
});

test('missing initial project metadata can be filled once and late child events cannot reopen closed sessions', () => {
    const store = new AgentStore();
    store.apply(hook('SessionStart',{cwd:undefined}));
    store.apply(hook('UserPromptSubmit',{cwd:'/first/project'}));
    store.apply(hook('PostToolUse',{cwd:'/scratchpad/before'}));
    assert.equal(parent(store).label,'project');
    store.apply(hook('SessionEnd',{}, {at:3}));
    assert.equal(store.apply(hook('SubagentStart',{agent_id:'late'},{at:4})),false);
    store.apply(hook('SessionStart',{}, {at:5}));
    store.apply(hook('Stop',{}, {at:6}));
    assert.equal(parent(store).state,'finished');
});
