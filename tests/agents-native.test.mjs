import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,mkdirSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {openCodePlugin} from '../extension/services/agents-setup-model.js';

const root=resolve(import.meta.dirname,'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('lazy native process checks preserve live sessions and cancel stale results', () => {
    const output = execFileSync('gjs', ['-m', join(root, 'tests/agent-processes-native.mjs')],
        {encoding:'utf8', timeout:10000});
    assert.match(output, /AGENT PROCESSES PASS/);
});
test('native client lifecycle and launcher preserve literal prompt arguments',()=>{
    const temp=mkdtempSync(join(tmpdir(),'island-agent-client-'));
    try {
        writeFileSync(join(temp,'fake-agent'),'#!/bin/sh\nexit 0\n',{mode:0o700});
        writeFileSync(join(temp,'gnome-terminal'),`#!/usr/bin/python3\nimport json, os, sys\nwith open(os.environ['ISLAND_AGENT_TEST_DIR']+'/argv.json','w') as f: json.dump(sys.argv[1:],f)\n`,{mode:0o700});
        writeFileSync(join(temp,'terminator'),readFileSync(join(temp,'gnome-terminal')),{mode:0o700});
        symlinkSync('terminator',join(temp,'system-terminal-link'));
        symlinkSync('system-terminal-link',join(temp,'x-terminal-emulator'));
        const output=execFileSync('gjs',['-m',join(root,'tests/agents-service.mjs')],{encoding:'utf8',timeout:20000,
            env:{...process.env,GSETTINGS_BACKEND:'memory',XDG_RUNTIME_DIR:temp,UBUNTU_ISLAND_AGENT_SOCKET:join(temp,'bridge/events.sock'),ISLAND_AGENT_TEST_DIR:temp,PATH:`${temp}:${process.env.PATH}`}});
        assert.match(output,/AGENTS NATIVE PASS/);
    } finally {rmSync(temp,{recursive:true,force:true});}
});
async function until(fn) {
    for(let i=0;i<100;i++){const result=fn();if(result)return result;await pause(30);}
    throw new Error('Timed out waiting for agent fixture');
}
function send(path,value) {
    return new Promise((resolve,reject)=>{
        const socket=net.createConnection(path);socket.on('error',reject);socket.on('close',resolve);
        socket.on('connect',()=>socket.end(typeof value==='string'?value:JSON.stringify(value)));
    });
}
test('real GJS broker and relay: status, privacy, bounds, clear and shutdown',async()=>{
    const temp=mkdtempSync(join(tmpdir(),'island-agents-'));
    const env={...process.env,XDG_RUNTIME_DIR:temp,UBUNTU_ISLAND_AGENT_SOCKET:join(temp,'bridge','events.sock'),
        TERMINATOR_DBUS_NAME:'net.tenshu.Terminator2',TERMINATOR_UUID:'urn:uuid:11111111-1111-1111-1111-111111111111'};
    const child=spawn('gjs',['-m',join(root,'extension/helpers/agents/bridge.js')],{env});
    let output='',errors='';const snapshots=[];
    child.stdout.on('data',bytes=>{output+=bytes;let end;while((end=output.indexOf('\n'))>=0){snapshots.push(JSON.parse(output.slice(0,end)));output=output.slice(end+1);}});
    child.stderr.on('data',b=>{errors+=b;});
    try {
        await until(()=>snapshots.length||child.exitCode!==null);
        assert.equal(child.exitCode,null,errors);assert.equal(snapshots.at(-1).connected,true);
        assert.equal(statSync(env.UBUNTU_ISLAND_AGENT_SOCKET).mode&0o777,0o600);
        const relay=spawn('gjs',['-m',join(root,'extension/helpers/agents/relay.js'),'claude'],{env});
        let reply='';relay.stdout.on('data',b=>{reply+=b;});
        relay.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'test',cwd:'/private/demo',prompt:'SENSITIVE-PROMPT'}));
        assert.equal((await once(relay,'exit'))[0],0);assert.equal(reply,'');
        await until(()=>snapshots.at(-1).sessions.length===1);
        assert.equal(snapshots.at(-1).sessions[0].state,'working');
        assert.equal(snapshots.at(-1).sessions[0].label,'demo');
        assert.equal(snapshots.at(-1).sessions[0].terminal.id,env.TERMINATOR_UUID);
        assert.equal(snapshots.at(-1).sessions[0].terminal.bus,env.TERMINATOR_DBUS_NAME);
        assert.ok(!JSON.stringify(snapshots).includes('SENSITIVE'));
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,'{bad json');
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,'x'.repeat(6000)).catch(e=>assert.equal(e.code,'ECONNRESET'));
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,provider:'codex',session:'approval',state:'approval'});
        await until(()=>snapshots.at(-1).sessions.length===2);
        const {id,profile} = snapshots.at(-1).sessions.find(s=>s.provider==='claude');
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,control:'dismiss',id});
        await until(()=>snapshots.at(-1).undo?.count===1);
        const token = snapshots.at(-1).undo.token;
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,provider:'claude',profile,session:'test',state:'finished'});
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,control:'restore',token});
        await until(()=>snapshots.at(-1).sessions.some(s=>s.state==='finished'));
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,control:'clear-finished'});
        await until(()=>snapshots.at(-1).sessions.length===1);
        assert.equal(snapshots.at(-1).sessions[0].state,'approval');
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,control:'expire',before:Date.now()-1});
        await until(()=>snapshots.at(-1).sessions.length===0);
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,provider:'codex',session:'approval',state:'working'});
        await until(()=>snapshots.at(-1).sessions.length===1);
        await send(env.UBUNTU_ISLAND_AGENT_SOCKET,{v:1,control:'clear'});
        await until(()=>snapshots.at(-1).sessions.length===0);
        const exited=once(child,'exit');child.stdin.end();await exited;
        assert.ok(!existsSync(env.UBUNTU_ISLAND_AGENT_SOCKET));
        assert.ok(!/JS ERROR|CRITICAL/.test(errors),errors);
    } finally {if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}rmSync(temp,{recursive:true,force:true});}
});
test('real setup preserves settings, backup, repeated installs and removal',()=>{
    const temp=mkdtempSync(join(tmpdir(),'island-agent-setup-'));
    const env={...process.env,XDG_RUNTIME_DIR:temp};
    const run=(action,provider,dir,major='1')=>JSON.parse(execFileSync('gjs',['-m',join(root,'extension/helpers/agents/setup.js'),action,provider,dir,major],{env,encoding:'utf8'}));
    try {
        for(const provider of ['claude','codex']) {
            const dir=join(temp,provider);mkdirSync(dir);
            const file=join(dir,provider==='claude'?'settings.json':'hooks.json');
            const original={description:'My existing hooks',unrelated:'keep',hooks:{
                Stop:[{matcher:'',hooks:[{type:'command',command:'echo existing',statusMessage:'My notifier'},
                    {type:'prompt',prompt:'Review result'}]},{matcher:'empty',hooks:[]}],CustomEvent:[],
            }};
            writeFileSync(file,JSON.stringify(original));
            assert.equal(run('plan',provider,dir).installed,false);
            assert.equal(readFileSync(file,'utf8'),JSON.stringify(original));
            assert.equal(run('install',provider,dir).installed,true);
            const first=readFileSync(file,'utf8');
            assert.deepEqual(JSON.parse(first).hooks.Stop.slice(0,2),original.hooks.Stop);
            assert.match(JSON.parse(first).hooks.Stop[2].hooks[0].statusMessage,/Ubuntu Island:/);
            assert.equal(readFileSync(`${file}~`,'utf8'),JSON.stringify(original));
            const modified=statSync(file).mtimeMs;
            run('install',provider,dir);
            assert.equal(readFileSync(file,'utf8'),first);
            assert.equal(statSync(file).mtimeMs,modified,'Repeated setup unnecessarily rewrote the file');
            assert.equal(readFileSync(`${file}~`,'utf8'),JSON.stringify(original),'Repeated setup overwrote the backup');
            assert.equal(run('remove',provider,dir).installed,false);
            assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),original);
        }
        const dir=join(temp,'opencode');run('install','opencode',dir);
        assert.match(readFileSync(join(dir,'plugins/ubuntu-island-status.js'),'utf8'),/UbuntuIslandStatus/);
        run('remove','opencode',dir);assert.ok(!existsSync(join(dir,'plugins/ubuntu-island-status.js')));
        assert.ok(existsSync(join(dir,'plugins/ubuntu-island-status.js.bak')));
        writeFileSync(join(dir,'plugins/ubuntu-island-status.js'),'// a user-owned plugin');
        for(const action of ['install','remove']) assert.throws(()=>run(action,'opencode',dir));
        assert.equal(readFileSync(join(dir,'plugins/ubuntu-island-status.js'),'utf8'),'// a user-owned plugin');
        const invalid=join(temp,'invalid');mkdirSync(invalid);
        writeFileSync(join(invalid,'settings.json'),'{invalid');
        assert.throws(()=>run('install','claude',invalid));
        assert.equal(readFileSync(join(invalid,'settings.json'),'utf8'),'{invalid');
        for(const hooks of [null,[],{Stop:{}},{Stop:[null]},{Stop:[{hooks:'not an array'}]}]) {
            const content=JSON.stringify({unrelated:'keep',hooks});
            writeFileSync(join(invalid,'settings.json'),content);
            assert.throws(()=>run('install','claude',invalid));
            assert.equal(readFileSync(join(invalid,'settings.json'),'utf8'),content);
        }
        const linked=join(temp,'linked');mkdirSync(linked);
        const target=join(temp,'must-not-create');
        symlinkSync(target,join(linked,'settings.json'));
        assert.throws(()=>run('install','claude',linked));
        assert.ok(!existsSync(target), 'Setup followed a dangling symlink');
    } finally {rmSync(temp,{recursive:true,force:true});}
});
test('generated OpenCode V1 plugin forwards lifecycle metadata without content',async()=>{
    const temp=mkdtempSync(join(tmpdir(),'island-opencode-'));
    const path=join(temp,'events.sock'), events=[];
    const server=net.createServer(socket=>{
        let input='';socket.on('data',data=>input+=data);
        socket.on('end',()=>{events.push(JSON.parse(input));socket.end();});
    });
    try {
        server.listen(path);await once(server,'listening');
        const pluginPath=join(temp,'plugin.mjs');writeFileSync(pluginPath,openCodePlugin(path));
        const {UbuntuIslandStatus}=await import(pathToFileURL(pluginPath));
        const plugin=await UbuntuIslandStatus({directory:'/private/project'});
        await plugin.event({event:{type:'message.part.updated',properties:{sessionID:'s',text:'SECRET'}}});
        await plugin.event({event:{type:'session.status',properties:{sessionID:'s',status:{type:'busy'},text:'SECRET'}}});
        await plugin.event({event:{type:'permission.asked',properties:{sessionID:'s',input:{command:'SECRET'}}}});
        await until(()=>events.length===2);
        assert.deepEqual(events.map(e=>e.state).sort(),['approval','working']);
        assert.equal(events[0].label,'project');assert.match(events[0].profile,/^[a-f0-9]{16}$/);
        assert.ok(!JSON.stringify(events).includes('SECRET'));assert.ok(!JSON.stringify(events).includes('/private'));
    } finally {await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});}
});
test('relay failure without a broker exits promptly without a decision',()=>{
    const temp=mkdtempSync(join(tmpdir(),'island-agent-off-'));
    try {
        const result=execFileSync('gjs',['-m',join(root,'extension/helpers/agents/relay.js'),'codex'],{
            env:{...process.env,XDG_RUNTIME_DIR:temp,UBUNTU_ISLAND_AGENT_SOCKET:join(temp,'absent.sock')},
            input:JSON.stringify({hook_event_name:'PermissionRequest',session_id:'s',tool_name:'Bash'}),timeout:2000,encoding:'utf8'});
        assert.equal(result,'');
    } finally {rmSync(temp,{recursive:true,force:true});}
});


test('terminal window lookup verifies the D-Bus owner, cancellation and metadata', () => {
    const output = execFileSync('dbus-run-session', ['--','gjs','-m',join(root,'tests/agent-terminal-native.mjs')],
        {encoding:'utf8',timeout:10000});
    assert.match(output,/TERMINAL IDENTITY PASS/);
});

test('title metadata reads, atomic renames, bounds and visibility cleanup stay outside Shell', () => {
    const temp = mkdtempSync(join(tmpdir(),'island-agent-titles-'));
    try {
        const output = execFileSync('gjs',['-m',join(root,'tests/agent-titles-native.mjs')], {
            env:{...process.env,ISLAND_AGENT_TEST_DIR:temp},encoding:'utf8',timeout:10000});
        assert.match(output,/AGENT TITLES PASS/);
    } finally {rmSync(temp,{recursive:true,force:true});}
});

// The relay deliberately rejects ambiguous ancestry. When the test itself runs
// under a real Claude/Codex process (outside a PID-namespaced sandbox), that
// ancestor makes the fixture's fake chain ambiguous, so the case cannot run.
function agentAncestor() {
    let pid=process.pid;
    for (let i=0;i<32&&pid>1;i++) {
        try {
            const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
            const name=stat.slice(stat.indexOf('(')+1,stat.lastIndexOf(')'));
            if (['claude','codex'].includes(name)) return name;
            pid=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);
        } catch { return null; }
    }
    return null;
}
test('real relay corroborates inherited Claude session IDs with bounded process ancestry', async t => {
    const ancestor=agentAncestor();
    if (ancestor) { t.skip(`running under a real ${ancestor} process; ancestry is intentionally ambiguous`); return; }
    const temp=mkdtempSync(join(tmpdir(),'island-agent-parent-'));
    const path=join(temp,'events.sock'), events=[];
    const server=net.createServer(socket=>{
        let input=''; socket.on('data',data=>input+=data);
        socket.on('end',()=>{events.push(JSON.parse(input));socket.end();});
    });
    try {
        server.listen(path); await once(server,'listening');
        const script=join(temp,'ancestry.py');
        writeFileSync(script,`import ctypes, json, os, subprocess, sys
ctypes.CDLL(None).prctl(15, sys.argv[1].encode(), 0, 0, 0)
if sys.argv[1] == 'claude':
    subprocess.run(['gjs','-m',sys.argv[2],'claude'], input=json.dumps({'hook_event_name':'SessionStart','session_id':'parent'}), text=True, check=True)
    subprocess.run([sys.executable,__file__,'codex',sys.argv[2]], check=True)
else:
    subprocess.run(['gjs','-m',sys.argv[2],'codex'], input=json.dumps({'hook_event_name':'UserPromptSubmit','session_id':'child','prompt':'SECRET'}), text=True, check=True)
`);
        const env={...process.env,UBUNTU_ISLAND_AGENT_SOCKET:path,CLAUDE_CONFIG_DIR:join(temp,'profile'),
            CLAUDE_CODE_SESSION_ID:'parent',CLAUDE_CODE_HOST_SESSION_ID:'WRONG-HOST'};
        const run=async (name, values=env) => {
            const process=spawn('python3',[script,name,join(root,'extension/helpers/agents/relay.js')],{env:values});
            let errors=''; process.stderr.on('data',b=>errors+=b);
            assert.equal((await once(process,'exit'))[0],0,errors);
        };
        await run('claude'); await until(()=>events.length===2);
        assert.equal(events[1].parent.session,'parent');
        assert.equal(events[1].parent.profile,events[0].profile);
        assert.deepEqual(events[1].parent.process,events[0].process);
        assert.ok(events[1].pids.includes(events[0].process.pid));
        assert.ok(!JSON.stringify(events).includes('SECRET'));
        await run('codex'); await until(()=>events.length===3);
        assert.equal(events[2].parent,null,'Inherited ID without a Claude ancestor linked a parent');
        await run('claude',{...env,CLAUDE_CODE_SESSION_ID:''}); await until(()=>events.length===5);
        assert.equal(events[4].parent,null,'HOST_SESSION_ID was used as a fallback');
    } finally {await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});}
});
