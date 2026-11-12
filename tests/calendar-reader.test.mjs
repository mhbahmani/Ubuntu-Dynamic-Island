import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('calendar pipe framing, stale generations and owned helper cleanup',()=>{
    assert.match(execFileSync('gjs',['-m','tests/calendar-reader-native.mjs'],{encoding:'utf8',timeout:15000}),/checks passed/);
});
test('private EDS source, recurrence, subscriptions, empty coverage and teardown',t=>{
    const available=spawnSync('gjs',['-c','imports.gi.ECal; imports.gi.EDataServer; imports.gi.ICalGLib;'],{timeout:5000});
    if(available.status!==0) {t.skip('Optional EDS typelibs are not installed; set GI_TYPELIB_PATH to test extracted bindings.');return;}
    const root=mkdtempSync(join(tmpdir(),'island-calendar-eds-')), env={...process.env,ISLAND_PRIVATE_CALENDAR_TEST:'1',TZ:'UTC'};
    for(const key of ['XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR']) {
        env[key]=join(root,key);mkdirSync(env[key],{mode:0o700});
    }
    try {
        const output=execFileSync('dbus-run-session',['--','gjs','-m','tests/calendar-eds-native.mjs'],{env,encoding:'utf8',timeout:35000,stdio:['ignore','pipe','pipe']});
        assert.match(output,/Native recurrence checks passed/);assert.match(output,/Private EDS reader checks passed/);
    } finally {rmSync(root,{recursive:true,force:true});}
});
