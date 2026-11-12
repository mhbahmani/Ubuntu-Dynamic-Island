// Runs outside Shell. Never print hook input, context, or approval decisions.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import System from 'system';
import {fromAgentHook, normalizeAgentEvent} from '../../services/agents-model.js';
import {readBounded, writeBytes, encoder, decoder, runtimePath} from './io.js';

const loop = new GLib.MainLoop(null, false);
const cancel = new Gio.Cancellable();
const at = GLib.get_monotonic_time() / 1000;
const deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => { cancel.cancel(); loop.quit(); return GLib.SOURCE_REMOVE; });
function ancestors() {
    const pids = []; let pid = System.programInvocationName ? new Gio.Credentials().get_unix_pid() : 0;
    for (let i = 0; i < 16 && pid > 1; i++) {
        try {
            const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
            const stat = decoder.decode(bytes); const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            pid = Number(fields[1]); if (pid > 1) pids.push(pid);
        } catch { break; }
    }
    return pids;
}
async function run() {
    const provider = ARGV[0];
    const input = await readBounded(new GioUnix.InputStream({fd: 0, close_fd: false}), 262144, cancel);
    const raw = JSON.parse(input);
    const home = provider === 'codex' ? GLib.getenv('CODEX_HOME') : provider === 'claude' ? GLib.getenv('CLAUDE_CONFIG_DIR') : GLib.getenv('XDG_CONFIG_HOME');
    const extra = {at, pids: ancestors(),
        terminal:{kind:'terminator',bus:GLib.getenv('TERMINATOR_DBUS_NAME'),id:GLib.getenv('TERMINATOR_UUID')}, launch: GLib.getenv('UBUNTU_ISLAND_AGENT_LAUNCH') || '',
        profile: GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, home || 'default', -1).slice(0, 16)};
    const event = provider === 'event' ? normalizeAgentEvent({...raw, at}) : fromAgentHook(provider, raw, extra);
    if (!event) return;
    const client = new Gio.SocketClient({timeout: 1});
    const connection = await new Promise((resolve, reject) => client.connect_async(
        new Gio.UnixSocketAddress({path: runtimePath()}), cancel,
        (c, r) => { try { resolve(c.connect_finish(r)); } catch (e) { reject(e); } }));
    try {
        if (connection.get_socket().get_credentials().get_unix_user() !== new Gio.Credentials().get_unix_user()) return;
        await writeBytes(connection.get_output_stream(), encoder.encode(JSON.stringify(event)), cancel);
    } finally { connection.close(null); }
}
run().catch(() => {}).finally(() => { if (!cancel.is_cancelled()) GLib.Source.remove(deadline); loop.quit(); });
loop.run();
