import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AgentStore, agentKey} from '../extension/services/agents-model.js';
import {AgentProcesses, agentProcessAlive} from '../extension/helpers/agents/processes.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function until(fn) {
    for (let i = 0; i < 100; i++) { if (fn()) return; await delay(20); }
    throw new Error('Process check did not settle');
}
const store = new AgentStore();
const event = {v:1, provider:'codex', session:'exited', state:'working', at:1};
const id = agentKey(event);
const child = Gio.Subprocess.new(['/bin/sleep', '30'], Gio.SubprocessFlags.NONE);
const pid = Number(child.get_identifier());
const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
const stat = new TextDecoder().decode(bytes);
const process = {pid, start:stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]};
let checks;
try {
    assert(await agentProcessAlive(process, null) === true, 'Live process was rejected');
    assert(await agentProcessAlive({...process, start:`${process.start}0`}, null) === false,
        'A reused PID was considered alive');
    store.apply({...event, process});
    store.apply({...event, session:'legacy', pids:[pid]});
    let changed = 0;
    checks = new AgentProcesses(store, () => changed++);
    checks.setActive(true);
    await until(() => !checks.cancel);
    assert(store.snapshot().counts.working === 2, 'Live or unverified session was removed');
    child.force_exit();
    await new Promise((resolve, reject) => child.wait_async(null,
        (p, r) => { try { p.wait_finish(r); resolve(); } catch (error) { reject(error); } }));
    assert(await agentProcessAlive(process, null) === false, 'Exited process remained alive');
    checks.setActive(true);
    await delay(40);
    assert(changed === 0, 'Repeated visible state started another check');
    checks.setActive(false);
    checks.setActive(true);
    await until(() => !checks.cancel);
    assert(changed === 1 && store.snapshot().counts.working === 1, 'Dead session remained working');
    assert(store.snapshot().sessions[0].session === 'legacy', 'Terminal PID was used as agent identity');
    assert(checks.deadline === 0, 'Completed check left a deadline');
    checks.stop();

    // Deliberately late reads exercise races independently of native I/O speed.
    let resolveRead, localCancel;
    checks = new AgentProcesses(store, () => changed++, (_process, cancel) => {
        localCancel = cancel;
        return new Promise(resolve => { resolveRead = resolve; });
    });
    const reopen = () => { checks.setActive(false); checks.setActive(true); };
    store.apply({...event, process, at:2});
    reopen();
    store.apply({...event, process, at:3});
    resolveRead(false); await delay(20);
    assert(store.rows.get(id).state === 'working', 'Late check closed a newer report');
    reopen(); checks.setActive(false); resolveRead(false); await delay(20);
    assert(localCancel.is_cancelled() && store.rows.get(id).state === 'working', 'Hide did not cancel the check');
    reopen(); checks.stop(); resolveRead(false); await delay(20);
    assert(localCancel.is_cancelled() && checks.deadline === 0 && store.rows.get(id).state === 'working',
        'Disable left a check or mutated the store');
    reopen();
    await until(() => localCancel.is_cancelled());
    resolveRead(false); await delay(20);
    assert(store.rows.get(id).state === 'working', 'Timed out check removed a session');
    reopen(); resolveRead(null); await delay(20);
    assert(store.rows.get(id).state === 'working', 'Unavailable check removed a session');
    reopen(); store.clear(); store.apply({...event, process, at:4});
    resolveRead(false); await delay(20);
    assert(store.rows.get(id).state === 'working', 'Late check closed a recreated session');
    print('AGENT PROCESSES PASS');
} finally { checks?.stop(); try { child.force_exit(); } catch {} }
