import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// All package/authentication commands are private stubs. Tests never alter the OS.
function fixture(installed = []) {
    const directory = mkdtempSync(join(tmpdir(),'island-dependencies-'));
    const bin = join(directory,'bin'); mkdirSync(bin);
    const state = join(directory,'installed.json'), log = join(directory,'calls.jsonl');
    writeFileSync(state,JSON.stringify(installed)); writeFileSync(log,'');
    const script = (name,code) => writeFileSync(join(bin,name),`#!/usr/bin/env node\n${code}\n`,{mode:0o755});
    script('dpkg-query',`const fs=require('fs');if(JSON.parse(fs.readFileSync(process.env.TEST_PACKAGES)).includes(process.argv.at(-1)))process.stdout.write('install ok installed');else process.exitCode=1;`);
    script('pkexec',`const fs=require('fs');fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(process.argv.slice(1))+'\\n');if(process.env.TEST_DENY==='1')process.exit(126);const result=require('child_process').spawnSync(process.argv[2],process.argv.slice(3),{stdio:'inherit'});process.exit(result.status);`);
    script('apt-get',`const fs=require('fs');fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(process.argv.slice(1))+'\\n');fs.writeFileSync(process.env.TEST_PACKAGES,JSON.stringify(process.argv.slice(5)));`);
    const env = {...process.env,PATH:`${bin}:${process.env.PATH}`,TEST_PACKAGES:state,TEST_CALLS:log,XDG_DATA_HOME:join(directory,'share'),INSTALL_DEPS:'1'};
    return {directory,bin,env,calls:()=>readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
        run:()=>spawnSync('sh',[resolve('scripts/install.sh'),'--local','.'],{env,encoding:'utf8',timeout:10000}),
        cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const packages=['gir1.2-ecal-2.0','gir1.2-edataserver-1.2'];
test('installed Calendar dependencies do not request privilege or run apt',()=>{
    const f=fixture(packages);try {assert.equal(f.run().status,0);assert.deepEqual(f.calls(),[]);}finally{f.cleanup();}
});
test('dependency setup authenticates only apt with fixed missing packages and forbids removals',()=>{
    for(const installed of [[],[packages[0]]]) {
        const f=fixture(installed);
        try {
            const result=f.run();assert.equal(result.status,0,result.stderr);
            const calls=f.calls();assert.equal(calls.length,2);
            const expected=['--assume-yes','--no-remove','install',...packages.filter(p=>!installed.includes(p))];
            assert.deepEqual(calls[0].slice(1),[join(f.bin,'apt-get'),...expected]);
            assert.deepEqual(calls[1].slice(1),expected);
        }finally{f.cleanup();}
    }
});
test('declined package authentication leaves the existing extension untouched',()=>{
    const f=fixture();
    try {
        // Keep the fixture portable when the test runner itself uses root.
        writeFileSync(join(f.bin,'id'),'#!/bin/sh\nprintf "1001\\n"\n',{mode:0o755});
        f.env.TEST_DENY='1';
        const base=join(f.env.XDG_DATA_HOME,'gnome-shell/extensions'),dest=join(base,'ubuntu-island@mhbahmani.github.io');
        mkdirSync(dest,{recursive:true});writeFileSync(join(dest,'original'),'preserve');
        assert.notEqual(f.run().status,0);
        assert.equal(readFileSync(join(dest,'original'),'utf8'),'preserve');
        assert.deepEqual(readdirSync(base),['ubuntu-island@mhbahmani.github.io']);
        assert.equal(existsSync(join(dest,'extension.js')),false);
    }finally{f.cleanup();}
});
