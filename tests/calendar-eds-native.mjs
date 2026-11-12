// Run only inside a private dbus-run-session and temporary XDG directories.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import EData from 'gi://EDataServer?version=1.2';
import ECal from 'gi://ECal?version=2.0';
import ICal from 'gi://ICalGLib?version=3.0';
import {expandSeries, builtinZone} from '../helpers/calendar/occurrences.js';
import {CalendarEventsService} from '../services/calendar-events.js';
import {normalizeOccurrences, eventQueryRanges} from '../services/calendar-events-model.js';
import {civilDay} from '../services/calendar-model.js';

const check = (value,message) => {if (!value) throw Error(message);};
check(GLib.getenv('ISLAND_PRIVATE_CALENDAR_TEST') === '1' && GLib.getenv('XDG_DATA_HOME')?.startsWith('/tmp/'), 'Private test environment required');
const component = lines => ICal.Component.new_from_string(['BEGIN:VEVENT',...lines,'END:VEVENT'].join('\r\n'));
const range = {startMs:Date.parse('2026-11-10'),endMs:Date.parse('2026-11-16')};
const options = {sourceUid:'fixture',zone:ICal.Timezone.get_utc_timezone(),zones:new Map(),email:'self@example.invalid'};
const master = component(['UID:series','SUMMARY:Original','DTSTART:20261111T120000Z','DTEND:20261111T130000Z',
    'RRULE:FREQ=DAILY;COUNT=4','EXDATE:20261112T120000Z']);
const moved = component(['UID:series','RECURRENCE-ID:20261113T120000Z','SUMMARY:Moved',
    'DTSTART:20261113T140000Z','DTEND:20261113T150000Z']);
const deleted = component(['UID:series','RECURRENCE-ID:20261114T120000Z','STATUS:CANCELLED',
    'DTSTART:20261114T120000Z','DTEND:20261114T130000Z']);
let result = expandSeries([master,moved,deleted],range,options);
let batch = normalizeOccurrences(result.occurrences,{sourceUids:['fixture'],incomplete:result.incomplete});
check(!batch.incomplete && batch.occurrences.length === 2, 'RRULE, EXDATE and cancelled override');
check(batch.occurrences[1].title === 'Moved' && batch.occurrences[1].startMs === Date.parse('2026-11-13T14:00Z'), 'Moved exception');
check(batch.occurrences[1].recurrenceId === String(Date.parse('2026-11-13T12:00Z')/1000), 'Exception identity');
const allDay = component(['UID:date','DTSTART;VALUE=DATE:20261111','SUMMARY:روز کامل']);
result = expandSeries([allDay],range,options);
check(result.occurrences[0].startDate === '2026-11-11' && result.occurrences[0].endDateExclusive === '2026-11-12', 'Date-only missing end');
const floating = component(['UID:floating','DTSTART:20261111T120000','DTEND:20261111T130000']);
result = expandSeries([floating],range,{...options,zone:builtinZone('Asia/Tehran')});
check(result.occurrences[0].startMs === Date.parse('2026-11-11T08:30Z'), 'Floating local time');
const zero = component(['UID:zero','DTSTART:20261111T120000Z']);
result = expandSeries([zero],range,options);
check(result.occurrences.length === 1 && result.occurrences[0].endMs === result.occurrences[0].startMs, 'Missing timed end');
const declined = component(['UID:declined','DTSTART:20261111T120000Z','DTEND:20261111T130000Z',
    'ATTENDEE;PARTSTAT=DECLINED:mailto:self@example.invalid']);
result = expandSeries([declined],range,options);
check(normalizeOccurrences(result.occurrences,{sourceUids:['fixture']}).occurrences.length === 0,'Declined invitation');
result = expandSeries([master],range,{...options,limit:1});
check(result.incomplete && result.occurrences.length === 1,'Recurrence cap is explicit');
const dst = component(['UID:dst','DTSTART;TZID=America/New_York:20260307T090000','DTEND;TZID=America/New_York:20260307T100000','RRULE:FREQ=DAILY;COUNT=3']);
result = expandSeries([dst],{startMs:Date.parse('2026-03-07'),endMs:Date.parse('2026-03-11')},options);
check(result.occurrences.length === 3 && result.occurrences[1].startMs-result.occurrences[0].startMs === 23*3600000,'Recurring DST transition');
print('Native recurrence checks passed');

const loop = new GLib.MainLoop(null,false);
let failed = null, service, timeout;
const call = (o,name,args) => new Promise((resolve,reject) => o[name](...args,null,(source,r) => {
    try {const v=source[`${name}_finish`](r); resolve(Array.isArray(v) && typeof v[0] === 'boolean' ? v[1] : v);} catch(e) {reject(e);}
}));
async function run() {
    const registry = await new Promise((resolve,reject) => EData.SourceRegistry.new(null,(_s,r) => {
        try {resolve(EData.SourceRegistry.new_finish(r));} catch(e) {reject(e);}
    }));
    const source = registry.ref_source('system-calendar');
    check(source,'Private local calendar exists');
    source.get_extension(EData.SOURCE_EXTENSION_CALENDAR).set_color('#12abcd');
    await call(source,'write',[]);
    const client = await new Promise((resolve,reject) => ECal.Client.connect(source,ECal.ClientSourceType.EVENTS,5,null,(_s,r) => {
        try {resolve(ECal.Client.connect_finish(r));} catch(e) {reject(e);}
    }));
    await call(client,'create_object',[master,ECal.OperationFlags.NONE]);
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
    let pending;
    service = new CalendarEventsService(root,snapshot => {if (snapshot.status !== 'loading') pending?.(snapshot);});
    const next = request => new Promise(resolve => {pending=resolve; service.watch(request);});
    const catalog = await next({catalog:true,sources:[],ranges:[],timezone:'UTC'});
    check(catalog.status === 'ready' && catalog.sources.some(s=>s.uid==='system-calendar'),'Reader catalog');
    check(catalog.sources.find(s=>s.uid==='system-calendar').color === '#12abcd', 'EDS source color reaches Shell service');
    const request = {catalog:false,sources:['system-calendar'],ranges:eventQueryRanges([{startDay:civilDay(2026,11,10),endDayExclusive:civilDay(2026,11,16)}]),timezone:'UTC'};
    const snapshot = await next(request);
    check(snapshot.status === 'ready',`Reader status ${snapshot.status}`);
    check(!snapshot.incomplete && snapshot.occurrences.length === 3,'Reader recurrence query');
    const changed = new Promise(resolve=>{pending=resolve;});
    await call(client,'create_object',[allDay,ECal.OperationFlags.NONE]);
    const updated = await changed;
    check(updated.status === 'ready' && updated.occurrences.length === 4,'View update subscription');
    const modified = new Promise(resolve=>{pending=resolve;});
    master.set_summary('Updated fixture');
    await call(client,'modify_object',[master,ECal.ObjModType.ALL,ECal.OperationFlags.NONE]);
    check((await modified).occurrences.filter(e=>e.uid==='series').every(e=>e.title==='Updated fixture'),'Modification propagation');
    const removed = new Promise(resolve=>{pending=resolve;});
    await call(client,'remove_object',['date',null,ECal.ObjModType.ALL,ECal.OperationFlags.NONE]);
    check((await removed).occurrences.length === 3,'Removal propagation');
    const empty = await next({...request,ranges:eventQueryRanges([{startDay:civilDay(2027,1,1),endDayExclusive:civilDay(2027,1,2)}])});
    check(empty.status === 'ready' && !empty.incomplete && empty.occurrences.length === 0 && empty.coverage.length === 1,'Proven empty interval');
    service.stop();
    await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,700,()=>{resolve();return GLib.SOURCE_REMOVE;}));
    check(!service.process && !service.timer && service.retiring.size === 0,'Owned helper cleanup');
    client.run_dispose(); registry.run_dispose();
    print('Private EDS reader checks passed');
}
timeout=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,30,()=>{failed=Error('Native reader test timeout');service?.stop();loop.quit();return GLib.SOURCE_REMOVE;});
run().catch(e=>{failed=e;}).finally(()=>{GLib.Source.remove(timeout);service?.stop();loop.quit();});
loop.run();
if(failed) throw failed;
