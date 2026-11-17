// Real GJS client/bridge lifecycle; launched only with an isolated runtime.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AgentsService} from '../extension/services/agents.js';
import {launchAgent, initializeAgentSettings, agentConfigDirectory, agentExecutable, defaultTerminal, agentTerminal} from '../extension/services/agent-launch.js';
import {runtimePath} from '../extension/helpers/agents/io.js';

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('extension').get_path();
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
        const provider = cycle === 0 ? 'claude' : 'codex';
        const titleRoot = `${GLib.getenv('ISLAND_AGENT_TEST_DIR')}/titles`;
        const directory = `${titleRoot}/projects/project/fixture-${cycle}`;
        GLib.mkdir_with_parents(directory, 0o700);
        GLib.file_set_contents(`${directory}/custom-title.json`, JSON.stringify({customTitle:'Metadata title'}));
        await service.send({provider, session:`fixture-${cycle}`, state:'working', label:'fixture',
            titleSource:{root:titleRoot,transcript:`${titleRoot}/projects/project/fixture-${cycle}.jsonl`}});
        await until(() => latest.sessions?.length === 1);
        if (cycle === 0) {
            assert(latest.sessions[0].label === 'fixture', 'Hidden broker read title metadata');
            service.setTitlesVisible(true);
            await until(() => latest.sessions[0]?.label === 'Metadata title');
            assert(!JSON.stringify(latest).includes(titleRoot), 'Private locator reached Shell snapshot');
            service.setTitlesVisible(false); await delay(100);
            const before = updates;
            GLib.file_set_contents(`${directory}/custom-title.json`, JSON.stringify({customTitle:'Hidden rename'}));
            await delay(200); assert(updates === before, 'Hidden broker updated title');
            service.setTitlesVisible(true);
            await until(() => latest.sessions[0]?.label === 'Hidden rename');
            service.setTitlesVisible(false);
        }
        if (cycle === 1) {
            // A missing SessionEnd must not leave a dead process marked Working.
            const child = Gio.Subprocess.new(['/bin/sleep', '30'], Gio.SubprocessFlags.NONE);
            try {
                const pid = Number(child.get_identifier());
                const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
                const stat = new TextDecoder().decode(bytes);
                await service.send({provider, session:'missed-end', state:'working',
                    process:{pid, start:stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}});
                await until(() => latest.sessions?.length === 2);
                child.force_exit();
                await new Promise(resolve => child.wait_async(null, (p, r) => { p.wait_finish(r); resolve(); }));
                service.setTitlesVisible(true);
                await until(() => latest.sessions?.length === 1);
                assert(latest.counts.working === 1 && latest.sessions[0].session === `fixture-${cycle}`,
                    'Dead session was not removed from shared snapshot/counts');
                service.setTitlesVisible(false);
            } finally { try { child.force_exit(); } catch {} }
        }
        await service.send({provider, session:`fixture-${cycle}`, state:'closed'});
        await until(() => latest.sessions?.length === 0);
        assert(latest.undo === null, 'Ended session offered Undo');
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
    const values = new Map();
    const automatic = {get_string: key => values.get(key) || (key === 'agents-terminal' ? 'auto' : ''),
        get_boolean: key => values.get(key) || false,
        set_boolean: (key, value) => values.set(key, value),
        reset: key => values.delete(key),
        get_user_value: key => values.get(key) ?? null,
        set_string: (key, value) => values.set(key, value)};
    initializeAgentSettings(automatic);
    for (const provider of ['claude', 'codex', 'opencode']) {
        assert(values.get(`agents-${provider}-config`) === agentConfigDirectory(provider), 'Config default was not filled');
        const detected = agentExecutable(provider);
        assert(!detected || values.get(`agents-${provider}-executable`) === detected, 'CLI detection was not saved');
    }
    assert(values.get('agents-project') === GLib.get_home_dir(), 'Project did not default to home');
    assert(automatic.get_string('agents-terminal') === 'auto', 'Terminal should follow the desktop default');
    values.set('agents-terminal-default-migrated', false); values.set('agents-terminal', 'gnome-terminal');
    initializeAgentSettings(automatic);
    assert(automatic.get_string('agents-terminal') === 'auto', 'Legacy automatic GNOME choice was not migrated');
    values.set('agents-terminal', 'gnome-terminal'); initializeAgentSettings(automatic);
    assert(automatic.get_string('agents-terminal') === 'gnome-terminal', 'Explicit terminal choice was not preserved');
    const desktop = new Gio.Settings({schema_id:'org.gnome.desktop.default-applications.terminal'});
    desktop.set_string('exec', 'x-terminal-emulator');
    assert(defaultTerminal()?.id === 'terminator', 'Desktop symlink chain did not resolve to Terminator');
    assert(agentTerminal('gnome-terminal')?.id === 'gnome-terminal', 'Explicit terminal was ignored');
    desktop.set_string('exec', 'gnome-terminal');
    assert(defaultTerminal()?.id === 'gnome-terminal', 'Changed desktop default was not followed');
    desktop.set_string('exec', '/missing/terminal');
    assert(defaultTerminal()?.id === 'terminator', 'Unavailable desktop command did not fall back to system alternative');
    desktop.set_string('exec', 'x-terminal-emulator');
    values.set('agents-claude-config', `${dir}/custom-config`);
    values.set('agents-claude-executable', `${dir}/missing-custom-cli`);
    values.set('agents-provider', 'opencode'); values.set('agents-project', dir);
    initializeAgentSettings(automatic);
    assert(values.get('agents-claude-config') === `${dir}/custom-config` &&
        values.get('agents-claude-executable') === `${dir}/missing-custom-cli` &&
        values.get('agents-provider') === 'opencode' && values.get('agents-project') === dir,
        'Discovery replaced an explicit user setting');
    const settings = {get_string(key) {
        if (key === 'agents-terminal') return 'auto';
        if (key.endsWith('-executable')) return `${dir}/fake-agent`;
        return '';
    }};
    const prompt = "--dangerous $(touch SHOULD-NOT-EXIST) `echo injection` ' quoted\nsecond line";
    launchAgent(settings, {provider:'claude',prompt,cwd:dir}, null);
    const capture = Gio.File.new_for_path(`${dir}/argv.json`);
    await until(() => capture.query_exists(null));
    const [,bytes] = capture.load_contents(null);
    const argv = JSON.parse(new TextDecoder().decode(bytes));
    assert(argv[0] === `--working-directory=${dir}` && argv[1] === '-x', 'Default terminal did not use Terminator arguments');
    assert(argv.at(-1) === prompt && argv.at(-2) === '--', 'Prompt was not preserved as one argument');
    assert(!Gio.File.new_for_path(`${dir}/SHOULD-NOT-EXIST`).query_exists(null), 'Prompt executed as shell code');
    print('AGENTS NATIVE PASS');
} finally {service.stop();}
