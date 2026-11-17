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
    check(snapshot.sources[0].holiday && !snapshot.sources[1].holiday && !snapshot.sources[2].holiday,
        'Holiday classification crosses the pipe only as an explicit boolean');
    const process=service.process, generation=service.generation;
    service.watch(request);check(service.process===process && service.generation===generation,'Identical watch reuses subscription');
    snapshot=await next({...request,timezone:'broken'});
    check(snapshot.status==='error' && !service.process && !service.timer,'Malformed helper stops safely');
    for(let i=0;i<3;i++) {
        service.stop();snapshot=await next(request);check(snapshot.status==='ready','Reactivation');service.stop();
    }
    await delay(800);check(service.retiring.size===0 && !service.process && !service.timer,'Repeated teardown releases child and timers');

    // In-memory cache, idle suspension and resume.
    const seen2=[];let wait2;
    const cached=new CalendarEventsService(root,s=>{seen2.push(s);if(s.status!=='loading') wait2?.(s);},
        {helper:`${root}/tests/fixtures/calendar-reader.mjs`,idleSeconds:1});
    const next2=r=>new Promise(resolve=>{wait2=resolve;cached.watch(r);});
    const monthA={...request,ranges:[{startDay:1,endDayExclusive:2}]}, monthB={...request,ranges:[{startDay:2,endDayExclusive:3}]};
    const first=await next2(monthA); await next2(monthB);
    check(cached.cache.size===2,'Completed ranges are cached');
    seen2.length=0;
    const shown=await next2(monthA);
    check(seen2.length===1 && shown===first,'Revisited range is shown from cache immediately');
    await delay(400);
    check(!seen2.some(s=>s.status==='loading') && seen2.at(-1).status==='ready' && seen2.at(-1).receivedAt>=first.receivedAt,
        'Revalidation replaces the cached copy without a loading flash');
    let process2=cached.process, generation2=cached.generation;
    cached.suspend(); seen2.length=0;
    cached.watch(monthA);
    check(cached.process===process2 && cached.generation===generation2 && !cached.idle && seen2.length===0,
        'Reopening within the grace period reuses the live reader without a query');
    cached.suspend();
    // GLib's seconds timer coalesces wakeups; a one-second timeout need not
    // fire within 1400 ms. Wait for the state with a bound, including on CI.
    const idleDeadline=GLib.get_monotonic_time()+3_000_000;
    while(cached.idle && GLib.get_monotonic_time()<idleDeadline) await delay(25);
    check(!cached.process && !cached.idle && cached.cache.size===2,'Idle expiry ends the reader and keeps the cache');
    seen2.length=0;
    const restored=await next2(monthA);
    check(seen2.length===1 && restored.status==='ready' && cached.process,'Expired reader restarts behind the cached copy');
    await delay(400);
    for (let i=0;i<8;i++) cached._remember(`range-${i}`,{status:'ready'});
    check(cached.cache.size===6 && !cached.cache.has('range-0') && cached.cache.has('range-7'),'Cache stays bounded, oldest first');
    cached.stop();
    check(cached.cache.size===0 && !cached.process && !cached.idle,'Stopping clears cached private snapshots');
    await delay(800);check(cached.retiring.size===0,'Suspended reader teardown releases its child');
    print('Calendar reader framing, generations and lifecycle checks passed');
}
const timeout=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,10,()=>{failure=Error('Reader test timeout');service?.stop();loop.quit();return GLib.SOURCE_REMOVE;});
run().catch(e=>{failure=e;}).finally(()=>{service?.stop();GLib.Source.remove(timeout);loop.quit();});
loop.run();if(failure)throw failure;
