import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {LAYOUTS} from '../services/notifications-model.js';

export function notificationsPreferences(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Notifications',
        description: 'Mirrors the notifications GNOME keeps under the clock. Nothing is stored or sent anywhere.'});
    const enabled = new Adw.SwitchRow({title: 'Enable Notifications', subtitle: 'Applies after disabling and re-enabling the extension'});
    settings.bind('enable-notifications', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(enabled);
    const layout = new Adw.ComboRow({title: 'Layout', subtitle: 'Also switchable from the tab',
        model: Gtk.StringList.new(['Compact list', 'Grouped by app'])});
    const syncLayout = () => { layout.selected = Math.max(0, LAYOUTS.indexOf(settings.get_string('notifications-layout'))); };
    syncLayout();
    layout.connect('notify::selected', () => settings.set_string('notifications-layout', LAYOUTS[layout.selected]));
    const layoutId = settings.connect('changed::notifications-layout', syncLayout);
    window.connect('close-request', () => { settings.disconnect(layoutId); return false; });
    group.add(layout);
    const badge = new Adw.SwitchRow({title: 'Count on the tab', subtitle: 'Small number on the Notifications tab for unseen notifications'});
    settings.bind('notifications-tab-badge', badge, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(badge);

    const notch = new Adw.PreferencesGroup({title: 'In the notch'});
    for (const [key, title, subtitle] of [
        ['notifications-peek', 'Show new notifications', 'App icon and title for 4 seconds · Follows Do Not Disturb and app banner settings'],
        ['pill-show-notifications', 'Show unseen count', 'Notifications that arrived since the tab was last opened'],
    ]) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        notch.add(row);
    }

    const system = new Adw.PreferencesGroup({title: 'GNOME settings',
        description: 'Do Not Disturb and per-app banners are GNOME settings; the island follows them.'});
    const open = new Adw.ActionRow({title: 'Notification settings', activatable: true});
    open.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    open.connect('activated', () => {
        try {
            GLib.spawn_async(null, ['gnome-control-center', 'notifications'], null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (error) {
            open.subtitle = `Could not open Settings: ${error.message}`;
        }
    });
    system.add(open);
    return [group, notch, system];
}
