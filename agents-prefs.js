import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AGENTS, TERMINALS} from './services/agents-model.js';
import {agentExecutable} from './services/agent-launch.js';
import {runtimePath, encoder, writeBytes} from './helpers/agents/io.js';

export function agentsPreferences(settings, window, path) {
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
    const launch = new Adw.PreferencesGroup({title:'Quick Ask',description:'Use existing agent sign-in and permissions. Desktop and web destinations copy the prompt for you to paste.'});
    combo(launch,'agents-provider','Default agent',Object.keys(AGENTS),Object.values(AGENTS));
    combo(launch,'agents-destination','Default destination',['terminal','copy-terminal','desktop','web'],['Start in terminal','Copy & open terminal','Copy & open desktop app','Copy & open website']);
    combo(launch,'agents-terminal','Terminal',TERMINALS,['GNOME Terminal','GNOME Console','Kitty','WezTerm']);
    entry(launch,'agents-project','Default project folder (absolute path)');
    const groups = [options,launch];
    const apps = Gio.AppInfo.get_all().filter(app => app.get_id() && app.should_show()).sort((a,b)=>a.get_display_name().localeCompare(b.get_display_name()));
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
        const group = new Adw.PreferencesGroup({title:name,description:'Observer events only. Restart the agent after setup. Sessions already open may not appear until their next event.'});
        groups.push(group);
        entry(group,`agents-${provider}-executable`,'CLI executable (blank = detect)');
        entry(group,`agents-${provider}-config`,'Config directory (blank = provider default)');
        combo(group,`agents-${provider}-desktop`,'Desktop destination',['',...apps.map(a=>a.get_id())],['Choose an installed app',...apps.map(a=>a.get_display_name())]);
        if (provider === 'opencode') combo(group,'agents-opencode-major','Plugin API version',['1','2'],['V1 · installed 1.x releases','V2 · experimental adapter']);
        const status = new Adw.ActionRow({title:'Local integration',subtitle:agentExecutable(provider,settings.get_string(`agents-${provider}-executable`))
            ? 'CLI detected. Review setup to enable status events.' : 'CLI not found. Set its executable path or choose a desktop destination.'});
        group.add(status);
        const controls = new Gtk.Box({spacing:6,halign:Gtk.Align.END,margin_bottom:10});
        const review = new Gtk.Button({label:'Review setup…'}), remove = new Gtk.Button({label:'Remove'}), test = new Gtk.Button({label:'Test event'}), inspect = new Gtk.Button({label:'Check'});
        for (const button of [inspect,review,remove,test]) controls.append(button);
        group.add(controls);
        const busy = value => { for (const button of [inspect,review,remove,test]) button.sensitive = !value; };
        async function run(action) {
            busy(true);
            try {
                const result = await setup(action,provider);
                if (closed) return;
                status.subtitle = `${result.installed ? 'Installed' : 'Not installed'} · ${result.path}\n${result.note}`;
                if (action === 'plan') {
                    const dialog = new Adw.MessageDialog({transient_for:window,modal:true,heading:`Enable ${name} status?`,
                        body:`Adds only Island's observer to ${result.path}. Existing configuration is preserved with a backup.\n${result.note}`});
                    const text = new Gtk.TextView({editable:false,cursor_visible:false,monospace:true,wrap_mode:Gtk.WrapMode.WORD_CHAR});
                    text.buffer.text = result.snippet;
                    const scroll = new Gtk.ScrolledWindow({min_content_height:160,max_content_height:260,propagate_natural_height:true}); scroll.set_child(text);
                    dialog.extra_child = scroll;
                    dialog.add_response('cancel','Cancel'); dialog.add_response('install','Enable integration'); dialog.default_response = 'cancel'; dialog.close_response = 'cancel';
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
    }
    return groups;
}
