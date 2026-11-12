import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import {readLines,write,encode} from '../../helpers/calendar/io.js';
const loop = new GLib.MainLoop(null,false), cancel = new Gio.Cancellable();
const input = new GioUnix.InputStream({fd:0,close_fd:false});
const output = new GioUnix.OutputStream({fd:1,close_fd:false});
let writes = Promise.resolve();
readLines(input,16384,cancel,request => {
    writes = writes.then(async () => {
        if (request.timezone === 'broken') { await write(output,new TextEncoder().encode('invalid json\n'),cancel); return; }
        const snapshot = {v:1,generation:request.generation,status:'ready',sources:[{uid:'fixture',color:'#aB9',holiday:true},
            {uid:'invalid',color:'#fff; padding: 99px',holiday:'true'}, {uid:'missing'}],occurrences:[],coverage:request.ranges,incomplete:false};
        await write(output,encode({...snapshot,generation:request.generation-1,status:'error'}),cancel);
        await write(output,encode(snapshot),cancel);
    });
}).finally(()=>loop.quit());
loop.run();
