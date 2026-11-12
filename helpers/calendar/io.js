import GLib from 'gi://GLib';

export const encode = value => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const decoder = new TextDecoder('utf-8', {fatal:true});
export function write(stream, bytes, cancel) {
    return new Promise((resolve, reject) => stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel,
        (s, r) => { try { s.write_all_finish(r); resolve(); } catch (e) { reject(e); } }));
}
// Read chunks, not unbounded read_line_async allocations. The callback owns each
// parsed message. EOF is explicit so a quiet subscription is never a timeout.
export async function readLines(stream, limit, cancel, receive) {
    let pending = [], size = 0;
    while (!cancel.is_cancelled()) {
        const chunk = await new Promise((resolve, reject) => stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, cancel,
            (s, r) => { try { resolve(s.read_bytes_finish(r).get_data()); } catch (e) { reject(e); } }));
        if (!chunk.length) { if (size) throw Error('Incomplete calendar message'); return; }
        let start = 0;
        while (start < chunk.length) {
            const newline = chunk.indexOf(10,start), end = newline < 0 ? chunk.length : newline;
            const part = chunk.subarray(start,end);
            size += part.length;
            if (size > limit) throw Error('Calendar message too large');
            pending.push(part);
            if (newline >= 0) {
                const bytes = new Uint8Array(size); let offset = 0;
                for (const piece of pending) { bytes.set(piece,offset); offset += piece.length; }
                pending = []; size = 0;
                receive(JSON.parse(decoder.decode(bytes)));
            }
            start = end + 1;
        }
    }
}
