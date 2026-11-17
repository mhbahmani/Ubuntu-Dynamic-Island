import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AGENTS, TERMINALS, TERMINAL_NAMES} from '../services/agents-model.js';
import {agentExecutable, initializeAgentSettings, defaultTerminal} from '../services/agent-launch.js';
import {runtimePath, encoder, writeBytes} from '../helpers/agents/io.js';
import {quickAskShortcut} from './shortcut-prefs.js';

export function agentsPreferences(settings, window, path) {
    initializeAgentSettings(settings);
    let closed = false;
    const jobs = new Set(), cancels = new Set();
    window.connect('close-request', () => {
        closed = true;
        for (const cancel of cancels) cancel.cancel();
        for (const job of jobs) job.force_exit();
        return false;
    });
    const options = new Adw.PreferencesGroup({title:'Agent sessions',
        description:'Experimental local observers. No account access, API keys, or transcript collection. Enable the module, then re-enable the extension.'});
    for (const [key,title] of [['enable-agents','Enable Agents'],['pill-show-agents','Show agent counts in the notch'],['agents-notify','Notify when an agent needs attention or finishes']]) {
        const row = new Adw.SwitchRow({title}); settings.bind(key,row,'active',Gio.SettingsBindFlags.DEFAULT); options.add(row);
    }
    const expiry = new Adw.SpinRow({title:'Remove inactive sessions after',
        subtitle:'Minutes without new activity. Checked only when you open the Agents tab.',
        adjustment:new Gtk.Adjustment({lower:1,upper:10080,step_increment:15,page_increment:60}),digits:0});
    settings.bind('agents-inactive-minutes',expiry,'value',Gio.SettingsBindFlags.DEFAULT); options.add(expiry);
    function entry(group, key, title) {
        const row = new Adw.EntryRow({title}); settings.bind(key,row,'text',Gio.SettingsBindFlags.DEFAULT); group.add(row); return row;
    }
    function combo(group, key, title, values, names) {
        const row = new Adw.ComboRow({title,model:Gtk.StringList.new(names)});
        const sync = () => { row.selected = Math.max(0, values.indexOf(settings.get_string(key))); };
        sync(); row.connect('notify::selected', () => { if (values[row.selected]) settings.set_string(key,values[row.selected]); });
        const id = settings.connect(`changed::${key}`,sync);
        window.connect('close-request', () => { settings.disconnect(id); return false; }); group.add(row); return row;
    }
    const launch = new Adw.PreferencesGroup({title:'Quick Ask',description:'Start a CLI session using your existing sign-in and permissions. Installed harnesses and terminals are detected automatically.'});
    launch.add(quickAskShortcut(settings, window));
    combo(launch,'agents-provider','Default harness',Object.keys(AGENTS),Object.values(AGENTS));
    const systemTerminal = defaultTerminal();
    const terminal = combo(launch,'agents-terminal','Terminal',['auto', ...TERMINALS],
        ['System default', ...TERMINALS.map(id => TERMINAL_NAMES[id])]);
    const terminalDescription = () => {
        terminal.subtitle = terminal.selected === 0
            ? systemTerminal ? `Detected: ${systemTerminal.name}` : 'No default terminal found.' : '';
    };
    terminal.connect('notify::selected', terminalDescription); terminalDescription();
    entry(launch,'agents-project','Default project folder');
    const groups = [options,launch];
    async function setup(action, provider) {
        const process = Gio.Subprocess.new(['/usr/bin/gjs','-m',`${path}/helpers/agents/setup.js`,action,provider,
            settings.get_string(`agents-${provider}-config`),settings.get_string('agents-opencode-major')],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        jobs.add(process);
        const cancel = new Gio.Cancellable(); cancels.add(cancel);
        let timedOut = false;
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT,3000,()=>{
            timedOut = true; cancel.cancel(); process.force_exit(); return GLib.SOURCE_REMOVE;
        });
        try {
            const output = await new Promise((resolve,reject)=>process.communicate_utf8_async(null,cancel,(p,r)=>{
                try { const [,text] = p.communicate_utf8_finish(r); resolve(text); } catch(e) { reject(e); }
            }));
            if (output.length > 65536) throw new Error('Unexpected setup response.');
            const result = JSON.parse(output);
            if (!result.ok) throw new Error(result.error);
            return result;
        } finally { if (!timedOut) GLib.Source.remove(timer); jobs.delete(process); cancels.delete(cancel); }
    }
    async function testEvent(provider) {
        const cancel = new Gio.Cancellable(); cancels.add(cancel); let expired = false, connection;
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT,1000,()=>{expired=true;cancel.cancel();return GLib.SOURCE_REMOVE;});
        try {
            const client = new Gio.SocketClient({timeout:1});
            connection = await new Promise((resolve,reject)=>client.connect_async(new Gio.UnixSocketAddress({path:runtimePath()}),cancel,
                (c,r)=>{try {resolve(c.connect_finish(r));}catch(e){reject(e);}}));
            await writeBytes(connection.get_output_stream(),encoder.encode(JSON.stringify({v:1,provider,session:`test-${provider}`,label:'Integration test',state:'input'})),cancel);
        } finally { if (!expired) GLib.Source.remove(timer); cancels.delete(cancel); try {connection?.close(null);} catch {} }
    }
    for (const [provider,name] of Object.entries(AGENTS)) {
        const group = new Adw.PreferencesGroup({title:name,description:'Connect this harness to see session status. Restart it after setup.'});
        groups.push(group);
        entry(group,`agents-${provider}-executable`,'CLI executable');
        entry(group,`agents-${provider}-config`,'Config directory');
        if (provider === 'opencode') combo(group,'agents-opencode-major','Plugin API version',['1','2'],['V1 · installed 1.x releases','V2 · experimental adapter']);
        const status = new Adw.ActionRow({title:'Session tracking',subtitle:agentExecutable(provider,settings.get_string(`agents-${provider}-executable`))
            ? 'Enable integration to show this harness’s sessions in the island.' : 'CLI not found. Install the harness or choose its executable path.'});
        group.add(status);
        const review = new Gtk.Button({label:'Enable integration…', valign:Gtk.Align.CENTER});
        review.add_css_class('suggested-action');
        status.add_suffix(review); status.activatable_widget = review;
        const details = new Adw.ExpanderRow({title:'Integration actions'});
        group.add(details);
        function actionRow(title, subtitle, icon) {
            const row = new Adw.ActionRow({title, subtitle});
            const control = new Gtk.Button({icon_name:icon, valign:Gtk.Align.CENTER, tooltip_text:title});
            row.add_suffix(control); row.activatable_widget = control; details.add_row(row);
            return control;
        }
        const inspect = actionRow('Refresh status', 'Check the local integration again', 'view-refresh-symbolic');
        const test = actionRow('Send test event', 'Check that sessions reach the island', 'media-playback-start-symbolic');
        const remove = actionRow('Remove integration', 'Keep other harness settings intact', 'user-trash-symbolic');
        let installed = false;
        const busy = value => {
            for (const control of [inspect,review,test]) control.sensitive = !value;
            remove.sensitive = !value && installed;
        };
        async function run(action) {
            busy(true);
            try {
                initializeAgentSettings(settings);
                const result = await setup(action,provider);
                if (closed) return;
                installed = result.installed;
                const found = agentExecutable(provider, settings.get_string(`agents-${provider}-executable`));
                status.subtitle = found
                    ? installed ? `Integration installed. ${result.note}` : 'Not set up. Enable integration to show sessions in the island.'
                    : 'CLI not found. Install the harness or choose its executable path.';
                status.tooltip_text = result.path;
                review.label = installed ? 'Reconfigure…' : 'Enable integration…';
                if (installed) review.remove_css_class('suggested-action');
                else review.add_css_class('suggested-action');
                if (action === 'plan') {
                    const dialog = new Adw.MessageDialog({transient_for:window,modal:true,heading:`${installed ? 'Reconfigure' : 'Enable'} ${name} tracking?`,
                        body:`Adds only Island's observer to ${result.path}. Existing configuration is preserved with a backup.\n${result.note}`});
                    const text = new Gtk.TextView({editable:false,cursor_visible:false,monospace:true,wrap_mode:Gtk.WrapMode.WORD_CHAR});
                    text.buffer.text = result.snippet;
                    const scroll = new Gtk.ScrolledWindow({min_content_height:160,max_content_height:260,propagate_natural_height:true}); scroll.set_child(text);
                    const changes = new Gtk.Expander({label:'Show configuration changes', child:scroll});
                    dialog.extra_child = changes;
                    dialog.add_response('cancel','Cancel');
                    dialog.add_response('install', installed ? 'Apply changes' : 'Enable integration');
                    dialog.set_response_appearance('install', Adw.ResponseAppearance.SUGGESTED);
                    dialog.default_response = 'install'; dialog.close_response = 'cancel';
                    dialog.connect('response',(_d,response)=>{if(response==='install'&&!closed)void run('install');}); dialog.present();
                }
            } catch(e) { if(!closed) status.subtitle = e.message; }
            finally { if(!closed) busy(false); }
        }
        review.connect('clicked',()=>void run('plan')); inspect.connect('clicked',()=>void run('status')); remove.connect('clicked',()=>void run('remove'));
        test.connect('clicked',async()=>{
            busy(true);
            try {await testEvent(provider);if(!closed)status.subtitle='Test event sent. Open the Agents tab.';}
            catch {if(!closed)status.subtitle='Observer unavailable. Enable Agents, then re-enable the extension.';}
            finally {if(!closed)busy(false);}
        });
        void run('status');
    }
    return groups;
}
