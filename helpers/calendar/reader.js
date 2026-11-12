import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import {readLines, write, encode} from './io.js';

const loop = new GLib.MainLoop(null,false), cancel = new Gio.Cancellable();
const input = new GioUnix.InputStream({fd:0,close_fd:false});
const output = new GioUnix.OutputStream({fd:1,close_fd:false});
let reader, latest, writing = false, generation = 0, closed = false;
function shutdown() { closed = true; reader?.stop(); cancel.cancel(); loop.quit(); }
async function flush() {
    if (writing || closed) return;
    writing = true;
    try {
        while (latest && !closed) { const value = latest; latest = null; await write(output,value,cancel); }
    } catch { shutdown(); }
    finally { writing = false; }
}
function emit(snapshot) {
    if (closed || snapshot.generation !== generation) return;
    let bytes = encode(snapshot);
    if (bytes.length > 2 * 1024 * 1024) bytes = encode({...snapshot,occurrences:[],incomplete:true,status:'partial'});
    latest = bytes; void flush();
}
function valid(request) {
    const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/u.test(value);
    return request?.v === 1 && Number.isSafeInteger(request.generation) && request.generation > 0 &&
        typeof request.catalog === 'boolean' && Array.isArray(request.sources) && request.sources.length <= 64 && request.sources.every(text) &&
        text(request.timezone) && request.timezone.length <= 128 && Array.isArray(request.ranges) && request.ranges.length <= 2 &&
        request.ranges.every(r => Number.isSafeInteger(r.startMs) && Number.isSafeInteger(r.endMs) && r.endMs >= r.startMs &&
            r.endMs - r.startMs <= 125 * 86400000 && Number.isInteger(r.startDay) && Number.isInteger(r.endDayExclusive) &&
            r.startDay >= -683003 && r.endDayExclusive <= 2932896 && r.endDayExclusive > r.startDay && r.endDayExclusive-r.startDay <= 124);
}
async function receive(request) {
    if (!valid(request)) { shutdown(); return; }
    generation = request.generation; reader?.stop(); reader = null;
    const own = generation;
    const empty = {v:1,generation:own,sources:[],occurrences:[],coverage:[],incomplete:true};
    let EDSReader;
    try { ({EDSReader} = await import('./eds.js')); }
    catch { emit({...empty,status:'missing-dependencies'}); return; }
    if (closed || own !== generation) return;
    reader = new EDSReader(emit);
    try { await reader.start(request); }
    catch { emit({...empty,status:'disconnected'}); }
}
readLines(input,16384,cancel,request => { void receive(request); }).then(shutdown).catch(shutdown);
GLibUnix.signal_add_full(GLib.PRIORITY_DEFAULT,15, () => {shutdown(); return GLib.SOURCE_REMOVE;});
loop.run();
