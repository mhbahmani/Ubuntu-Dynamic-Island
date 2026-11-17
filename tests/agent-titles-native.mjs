import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AgentTitles, titleLocation} from '../extension/helpers/agents/titles.js';
import {AgentStore, agentKey} from '../extension/services/agents-model.js';
const root = GLib.getenv('ISLAND_AGENT_TEST_DIR');
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const assert = (value, message) => {if (!value) throw new Error(message);};
const source = {root, transcript:`${root}/projects/project/session.jsonl`};
const directory = `${root}/projects/project/session`, file = `${directory}/custom-title.json`;
GLib.mkdir_with_parents(directory, 0o700);
GLib.file_set_contents(source.transcript, 'TRANSCRIPT-MUST-NOT-BE-PARSED');
const store = new AgentStore(), event = {v:1,provider:'claude',session:'session',state:'working',label:'project'};
store.apply(event);
let updates = 0;
const titles = new AgentTitles(store, () => updates++);
const row = () => store.snapshot().sessions[0];
const write = title => GLib.file_set_contents(file, JSON.stringify({customTitle:title}));
async function until(fn) { for(let i=0;i<80;i++) {if(fn()) return; await delay(25);} throw new Error('Title fixture timed out'); }
try {
    for (const bad of [{...source,transcript:'/etc/passwd'}, {...source,transcript:`${root}/projects/../../session.jsonl`},
        {...source,transcript:`${root}/projects/project/other.jsonl`}, {...source,root:'relative'}])
        assert(!titleLocation(bad,'session'),'Unsafe locator accepted');
    titles.remember(event,source); write('Initial'); await delay(120);
    assert(row().label === 'project' && !titles.sources.get(agentKey(event)).cancel,'Hidden title read');
    titles.setActive(true); await until(() => row().label === 'Initial');
    const entry = titles.sources.get(agentKey(event));
    assert(entry.monitors.length === 2,'Missing narrow replacement monitors');
    write('Renamed'); await until(() => row().label === 'Renamed');
    const updated = row().updated;
    for (let i=0;i<8;i++) write(`Burst ${i}`);
    await until(() => row().label === 'Burst 7');
    assert(row().updated === updated,'Title changed activity time');
    GLib.file_set_contents(file, '{malformed'); await delay(180); assert(row().label === 'Burst 7','Malformed title erased fallback');
    GLib.file_set_contents(file, JSON.stringify({title:'x'.repeat(10000)})); await delay(180);
    assert(row().label === 'Burst 7','Oversized metadata read');
    Gio.File.new_for_path(file).delete(null); await delay(180);
    write('Replaced'); await until(() => row().label === 'Replaced');
    titles.setActive(false); const count = updates;
    assert(!entry.cancel && !entry.tick && !entry.deadline && entry.monitors.length === 0,'Hide leaked resources');
    write('While hidden'); await delay(200); assert(updates === count,'Hidden callback');
    titles.setActive(true); await until(() => row().label === 'While hidden');
    write('Late'); titles.stop(); await delay(180); assert(row().label === 'While hidden','Late callback after stop');
    assert(titles.sources.size === 0,'Stop retained sources');
    // Missing directory is discovered only through its exact parent's event.
    Gio.File.new_for_path(file).delete(null); Gio.File.new_for_path(directory).delete(null);
    titles.remember(event,source); titles.setActive(true); await delay(150);
    GLib.mkdir_with_parents(directory,0o700); write('Created later');
    await until(() => row().label === 'Created later');
    titles.setActive(false);
    Gio.File.new_for_path(file).delete(null);
    Gio.File.new_for_path(file).make_symbolic_link(source.transcript,null);
    titles.setActive(true); await delay(180); assert(row().label === 'Created later','Followed symlink');
    store.expire(Date.now()+1); titles.sync(); assert(titles.sources.size === 0,'Expired source retained');
    print('AGENT TITLES PASS');
} finally {titles.stop();}
