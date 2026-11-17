import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {CalendarEventsService, CALENDAR_MESSAGES} from '../services/calendar-events.js';

export function calendarEventPreferences(settings, window) {
    const group = new Adw.PreferencesGroup({title:'Events',description:
        'Read-only events from GNOME Online Accounts and desktop calendars. Sign-in and synchronization are managed by GNOME.'});
    const enabled = new Adw.SwitchRow({title:'Show desktop calendar events'});
    settings.bind('calendar-events-enabled',enabled,'active',Gio.SettingsBindFlags.DEFAULT); group.add(enabled);
    const status = new Adw.ActionRow({title:'Desktop calendars',subtitle:'Open this page to discover calendars.',use_markup:false});
    group.add(status);
    const manage = new Gtk.Button({label:'Manage accounts',valign:Gtk.Align.CENTER});
    manage.connect('clicked', () => {
        try { Gio.Subprocess.new(['gnome-control-center','online-accounts'],Gio.SubprocessFlags.NONE); }
        catch { status.subtitle = 'Could not open Online Accounts.'; }
    });
    status.add_suffix(manage);
    const accounts = new Map(), rows = new Map(); let syncing = false, sources = [];
    const sync = () => {
        syncing = true;
        const selected = settings.get_strv('calendar-event-sources');
        for (const [uid,row] of rows) { row.active = selected.includes(uid); row.sensitive = enabled.active; }
        syncing = false;
    };
    const render = snapshot => {
        status.subtitle = snapshot.status === 'missing-dependencies'
            ? 'Install gir1.2-ecal-2.0 and gir1.2-edataserver-1.2, then reopen this page.'
            : CALENDAR_MESSAGES[snapshot.status] || 'Choose only the calendars you want to show. Data may come from the local EDS cache.';
        if (!['ready','no-sources'].includes(snapshot.status)) return;
        sources = snapshot.sources;
        const selected = settings.get_strv('calendar-event-sources');
        const shown = [...sources,...selected.filter(uid => !sources.some(s => s.uid === uid))
            .map(uid => ({uid,name:'Unavailable calendar',account:'Unavailable sources'}))];
        for (const [uid,row] of rows) if (!shown.some(s => s.uid === uid)) {
            accounts.get(row._account).remove(row); rows.delete(uid);
        }
        for (const source of shown) {
            const account = source.account || 'On this computer';
            let parent = accounts.get(account);
            if (!parent) {
                parent = new Adw.ExpanderRow({title:account,use_markup:false,expanded:true});
                group.add(parent); accounts.set(account,parent);
            }
            let row = rows.get(source.uid);
            if (row && row._account !== account) { accounts.get(row._account).remove(row); row = null; }
            if (!row) {
                row = new Adw.SwitchRow({use_markup:false}); row._account = account;
                row.connect('notify::active', () => {
                    if (syncing) return;
                    const values = new Set(settings.get_strv('calendar-event-sources'));
                    if (row.active) values.add(source.uid); else values.delete(source.uid);
                    settings.set_strv('calendar-event-sources',[...values]);
                });
                rows.set(source.uid,row); parent.add_row(row);
            }
            row.title = source.name;
            row.subtitle = source.enabled === false ? 'Disabled in desktop account settings' : '';
        }
        for (const [name,parent] of accounts) if (![...rows.values()].some(row => row._account === name)) {
            group.remove(parent); accounts.delete(name);
        }
        sync();
    };
    const path = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
    const reader = window._islandCalendarReader?.(render) || new CalendarEventsService(path,render);
    group.connect('map', () => reader.watch({catalog:true,sources:[],ranges:[],timezone:'UTC'}));
    group.connect('unmap', () => reader.stop());
    const signals = ['calendar-events-enabled','calendar-event-sources'].map(key => settings.connect(`changed::${key}`,sync));
    window.connect('close-request', () => {reader.stop(); signals.forEach(id => settings.disconnect(id)); return false;});
    return group;
}

export function eventNotchPreferences(settings, window) {
    const group = new Adw.PreferencesGroup({title:'Upcoming event',description:
        'Uses selected desktop calendars. All-day events stay in the Calendar agenda.'});
    for (const [key,title] of [['pill-show-event','Show upcoming event in notch'],['pill-event-show-title','Show event title in notch']]) {
        const row = new Adw.SwitchRow({title}); settings.bind(key,row,'active',Gio.SettingsBindFlags.DEFAULT); group.add(row);
    }
    const values = [5,15,30,60];
    const lead = new Adw.ComboRow({title:'Show before event',model:Gtk.StringList.new(values.map(n => `${n} minutes`))});
    lead.selected = Math.max(0,values.indexOf(settings.get_int('calendar-event-lead-minutes')));
    lead.connect('notify::selected', () => settings.set_int('calendar-event-lead-minutes',values[lead.selected]));
    const signal = settings.connect('changed::calendar-event-lead-minutes', () => {
        lead.selected = Math.max(0,values.indexOf(settings.get_int('calendar-event-lead-minutes')));
    });
    window.connect('close-request', () => {settings.disconnect(signal); return false;});
    group.add(lead); return group;
}
