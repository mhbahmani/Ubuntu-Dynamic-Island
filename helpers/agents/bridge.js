// Private, bounded, event-only broker. No agent control operations or network I/O.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import {AgentTitles} from './titles.js';
import {AgentStore} from '../../services/agents-model.js';
import {readBounded, readChunk, writeBytes, encoder, decoder, runtimePath, privateDirectory} from './io.js';

const loop = new GLib.MainLoop(null, false);
const store = new AgentStore();
const titles = new AgentTitles(store, schedule);
const cancel = new Gio.Cancellable();
const clients = new Set();
const stdout = new GioUnix.OutputStream({fd: 1, close_fd: false});
let service, socketFile, tick = 0, writing = false, dirty = false, shuttingDown = false;
let burstAt = 0, burst = 0;
async function flush() {
    if (writing || shuttingDown) { dirty = true; return; }
    writing = true; dirty = false;
    try { await writeBytes(stdout, encoder.encode(`${JSON.stringify(store.snapshot())}\n`), cancel); }
    catch { shutdown(); }
    finally { writing = false; if (dirty && !shuttingDown) schedule(); }
}
function schedule() {
    if (!tick && !shuttingDown) tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        tick = 0; void flush(); return GLib.SOURCE_REMOVE;
    });
}
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (tick) GLib.Source.remove(tick);
    titles.stop(); cancel.cancel(); service?.stop(); service?.close();
    for (const conn of clients) { try { conn.close(null); } catch {} }
    try { socketFile?.delete(null); } catch {}
    loop.quit();
}
async function accept(connection) {
    const local = new Gio.Cancellable();
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { local.cancel(); return GLib.SOURCE_REMOVE; });
    clients.add(connection);
    try {
        if (connection.get_socket().get_credentials().get_unix_user() !== new Gio.Credentials().get_unix_user()) return;
        const raw = JSON.parse(await readBounded(connection.get_input_stream(), 32768, local));
        const now = GLib.get_monotonic_time();
        if (now - burstAt > 1000000) { burstAt = now; burst = 0; }
        if (++burst > 100) { store.dropped++; schedule(); return; }
        if (raw.v === 1 && store.control(raw)) { titles.sync(); schedule(); return; }
        const dropped = store.dropped;
        if (store.apply(raw)) { titles.remember(raw, raw.titleSource); titles.sync(); schedule(); }
        else if (store.dropped !== dropped) schedule();
    } catch { /* Untrusted input is never logged. */ }
    finally {
        if (!local.is_cancelled()) GLib.Source.remove(timer);
        try { connection.close(null); } catch {}
        clients.delete(connection);
    }
}
async function watchParent() {
    const stdin = new GioUnix.InputStream({fd: 0, close_fd: false});
    let pending = '';
    try {
        while (true) {
            const bytes = await readChunk(stdin, 1024, cancel);
            if (!bytes.length) break;
            pending += decoder.decode(bytes);
            if (pending.length > 4096) break;
            let end;
            while ((end = pending.indexOf('\n')) >= 0) {
                const command = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
                if (typeof command.titles === 'boolean') titles.setActive(command.titles);
            }
        }
    } catch {}
    shutdown();
}
try {
    const path = runtimePath();
    privateDirectory(GLib.path_get_dirname(path));
    service = new Gio.SocketService();
    // Never unlink someone else's live or stale endpoint. Report startup failure.
    service.add_address(new Gio.UnixSocketAddress({path}), Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
    socketFile = Gio.File.new_for_path(path);
    socketFile.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    service.connect('incoming', (_s, connection) => {
        if (clients.size >= 8) { connection.close(null); return true; }
        void accept(connection); return true;
    });
    service.start(); void flush(); void watchParent();
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, () => { shutdown(); return GLib.SOURCE_REMOVE; });
    loop.run();
} catch { printerr('Agent bridge unavailable. Check the private runtime socket.'); shutdown(); }
