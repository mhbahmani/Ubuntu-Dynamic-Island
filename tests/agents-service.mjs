// Real GJS client/bridge lifecycle; launched only with an isolated runtime.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AgentsService} from '../services/agents.js';
import {launchAgent} from '../services/agent-launch.js';
import {runtimePath} from '../helpers/agents/io.js';

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const assert = (condition, message) => {if (!condition) throw new Error(message);};
async function until(fn) {
    for (let i = 0; i < 100; i++) {if (fn()) return; await delay(40);}
    throw new Error('Timed out waiting for native agent service');
}
let latest, updates = 0;
const service = new AgentsService(root, state => {latest = state; updates++;});
try {
    for (let cycle = 0; cycle < 3; cycle++) {
        service.start(); service.start();
        await until(() => latest?.connected);
        await service.send({provider:'codex', session:`fixture-${cycle}`, state:'working', label:'fixture'});
        await until(() => latest.sessions?.length === 1);
        await service.send({control:'clear'});
        await until(() => latest.sessions?.length === 0);
        service.stop();
        const count = updates;
        await until(() => !Gio.File.new_for_path(runtimePath()).query_exists(null));
        assert(updates === count, 'Service emitted after stop');
        let rejected = false;
        try {await service.send({control:'clear'});} catch {rejected = true;}
        assert(rejected, 'Disabled client accepted a command');
        latest = null;
    }
    // A newly constructed service models extension disable/enable without a delay.
    for (let cycle = 0; cycle < 4; cycle++) {
        latest = null;
        const replacement = new AgentsService(root, state => {latest = state;});
        try {
            replacement.start();
            await until(() => latest?.connected);
        } finally {replacement.stop();}
    }
    await until(() => !Gio.File.new_for_path(runtimePath()).query_exists(null));
    const dir = GLib.getenv('ISLAND_AGENT_TEST_DIR');
    const settings = {get_string(key) {
        if (key === 'agents-terminal') return 'gnome-terminal';
        if (key.endsWith('-executable')) return `${dir}/fake-agent`;
        return '';
    }};
    const prompt = "--dangerous $(touch SHOULD-NOT-EXIST) `echo injection` ' quoted\nsecond line";
    launchAgent(settings, {provider:'claude',destination:'terminal',prompt,cwd:dir}, null);
    const capture = Gio.File.new_for_path(`${dir}/argv.json`);
    await until(() => capture.query_exists(null));
    const [,bytes] = capture.load_contents(null);
    const argv = JSON.parse(new TextDecoder().decode(bytes));
    assert(argv.at(-1) === prompt && argv.at(-2) === '--', 'Prompt was not preserved as one argument');
    assert(!Gio.File.new_for_path(`${dir}/SHOULD-NOT-EXIST`).query_exists(null), 'Prompt executed as shell code');
    print('AGENTS NATIVE PASS');
} finally {service.stop();}
