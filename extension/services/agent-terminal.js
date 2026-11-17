import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {agentTerminalIdentity} from './agents-model.js';

const call = (destination, path, iface, method, parameters, cancel) =>
    new Promise((resolve, reject) => Gio.DBus.session.call(destination, path, iface, method,
        parameters, null, Gio.DBusCallFlags.NO_AUTO_START, 500, cancel,
        (connection, result) => {
            try { resolve(connection.call_finish(result)); } catch (error) { reject(error); }
        }));

// Terminator hosts multiple windows in one process. Its terminal UUID identifies
// the owning window without reading terminal contents. Address the unique bus
// owner after checking its PID, so name replacement cannot redirect the lookup.
export async function terminalWindowIdentity(session, cancel) {
    const terminal = agentTerminalIdentity(session.terminal);
    if (!terminal) return null;
    const bus = method => parameter => call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', method, new GLib.Variant('(s)', [parameter]), cancel);
    const [owner] = (await bus('GetNameOwner')(terminal.bus)).deep_unpack();
    const [pid] = (await bus('GetConnectionUnixProcessID')(owner)).deep_unpack();
    if (!session.pids?.includes(pid)) return null;
    const reply = await call(owner, '/net/tenshu/Terminator2', terminal.bus,
        'get_window_title', new GLib.Variant('(v)', [new GLib.Variant('s', terminal.id)]), cancel);
    if (!reply.is_of_type(new GLib.VariantType('(s)'))) return null;
    const [title] = reply.deep_unpack();
    return title && title.length <= 4096 ? {pid, title} : null;
}
