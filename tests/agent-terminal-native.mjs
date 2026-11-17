// Own a fake terminal endpoint on a private session bus. No host windows/accounts.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {terminalWindowIdentity} from '../extension/services/agent-terminal.js';

const check = (value, message) => { if (!value) throw Error(message); };
const bus = 'net.tenshu.Terminator2';
const id = 'urn:uuid:11111111-1111-1111-1111-111111111111';
const loop = new GLib.MainLoop(null, false);
let failure, calls = 0, delayed;
const object = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${bus}">
    <method name="get_window_title"><arg type="v" direction="in"/><arg type="s" direction="out"/></method>
    </interface></node>`, {
    get_window_titleAsync([uuid], invocation) {
        calls++;
        if (uuid.deep_unpack() !== id) { invocation.return_dbus_error('org.example.NoTerminal','Missing terminal'); return; }
        if (delayed === false) { delayed = invocation; return; }
        invocation.return_value(new GLib.Variant('(s)', ['Fixture window']));
    },
});
object.export(Gio.DBus.session, '/net/tenshu/Terminator2');
const name = Gio.bus_own_name_on_connection(Gio.DBus.session, bus, Gio.BusNameOwnerFlags.NONE, async () => {
    const pid = new Gio.Credentials().get_unix_pid();
    const session = {pids:[pid], terminal:{kind:'terminator',bus,id}};
    try {
        const identity = await terminalWindowIdentity(session, null);
        check(identity?.pid === pid && identity.title === 'Fixture window', 'Verified owner metadata missing');
        check(await terminalWindowIdentity({...session,pids:[pid + 1]},null) === null && calls === 1,
            'Unrelated process received terminal lookup');
        let rejected = false;
        try { await terminalWindowIdentity({...session,terminal:{...session.terminal,id:id.replace('11111111','22222222')}},null); }
        catch { rejected = true; }
        check(rejected, 'Missing terminal was accepted');
        const cancel = new Gio.Cancellable(); cancel.cancel(); rejected = false;
        try { await terminalWindowIdentity(session,cancel); } catch { rejected = true; }
        check(rejected, 'Cancelled lookup completed');
        delayed = false; rejected = false;
        try { await terminalWindowIdentity(session,null); } catch { rejected = true; }
        check(rejected, 'Unresponsive terminal did not time out');
        delayed?.return_value(new GLib.Variant('(s)', ['Late reply']));
        print('TERMINAL IDENTITY PASS');
    } catch (error) { failure = error; }
    finally { loop.quit(); }
}, null);
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
    failure = Error('Terminal fixture timed out'); loop.quit(); return GLib.SOURCE_REMOVE;
});
loop.run();
GLib.Source.remove(timeout); Gio.bus_unown_name(name); object.unexport();
if (failure) throw failure;
