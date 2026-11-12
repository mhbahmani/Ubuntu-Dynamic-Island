import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {CalendarEventsService} from '../services/calendar-events.js';
import {readLines,encode} from '../helpers/calendar/io.js';
const check=(v,m)=>{if(!v) throw Error(m);};
const delay=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const root=Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
const loop=new GLib.MainLoop(null,false); let failure,service;
async function run() {
    const cancel=new Gio.Cancellable(), seen=[];
    await readLines(Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(encode({title:'جلسه'}))),100,cancel,v=>seen.push(v));
    check(seen[0].title==='جلسه','UTF8 framing');
    const title='a'.repeat(8179)+'جلسه'.repeat(100);
    await readLines(Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(encode({title}))),16384,cancel,v=>check(v.title===title,'UTF8 across chunks'));
    for (const value of ['{"missing":true}', 'x'.repeat(101)+'\n','invalid\n']) {
        let rejected=false;
        try {await readLines(Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(value))),100,cancel,()=>{});} catch {rejected=true;}
        check(rejected,'Invalid/incomplete/oversize framing rejected');
    }
    const snapshots=[];let pending;
    service=new CalendarEventsService(root,snapshot=>{snapshots.push(snapshot);if(snapshot.status!=='loading') pending?.(snapshot);},{helper:`${root}/tests/fixtures/calendar-reader.mjs`});
    const next=request=>new Promise(resolve=>{pending=resolve;service.watch(request);});
    const request={catalog:false,sources:['fixture'],ranges:[],timezone:'UTC'};
    let snapshot=await next(request);
    check(snapshot.status==='ready' && !service.timer && snapshots.every(s=>s.status!=='error'),'Stale generation ignored');
    check(snapshot.sources[0].color === '#aabb99' && snapshot.sources[1].color === null && snapshot.sources[2].color === null,
        'Source colors survive the pipe only after validation');
    const process=service.process, generation=service.generation;
    service.watch(request);check(service.process===process && service.generation===generation,'Identical watch reuses subscription');
    snapshot=await next({...request,timezone:'broken'});
    check(snapshot.status==='error' && !service.process && !service.timer,'Malformed helper stops safely');
    for(let i=0;i<3;i++) {
        service.stop();snapshot=await next(request);check(snapshot.status==='ready','Reactivation');service.stop();
    }
    await delay(800);check(service.retiring.size===0 && !service.process && !service.timer,'Repeated teardown releases child and timers');
    print('Calendar reader framing, generations and lifecycle checks passed');
}
const timeout=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,10,()=>{failure=Error('Reader test timeout');service?.stop();loop.quit();return GLib.SOURCE_REMOVE;});
run().catch(e=>{failure=e;}).finally(()=>{service?.stop();GLib.Source.remove(timeout);loop.quit();});
loop.run();if(failure)throw failure;
