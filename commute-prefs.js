import {editRoute} from './commute-map.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {routesFrom, PROVIDER_NAMES, routeTitle} from './services/commute-model.js';
import {saveRoutingKey} from './services/commute-keys.js';

export function commutePreferences(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Driving routes',
        description: 'Opt in to send endpoints to routing services while Commute is visible. Free public estimates do not include live traffic. Map setup uses OpenStreetMap tiles and address search.'});
    const enabled = new Adw.SwitchRow({title: 'Enable Commute', subtitle: 'Applies after disabling and re-enabling the extension'});
    settings.bind('enable-commute', enabled, 'active', Gio.SettingsBindFlags.DEFAULT); group.add(enabled);
    const interval = new Adw.SpinRow({title: 'ETA refresh interval', subtitle: 'Minutes · minimum 10 · only while visible',
        adjustment: new Gtk.Adjustment({lower: 10, upper: 120, step_increment: 5, page_increment: 15})});
    settings.bind('commute-interval', interval.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT); group.add(interval);
    const providers = ['auto', 'fossgis', 'osrm', 'ors', 'graphhopper', 'neshan'];
    const provider = new Adw.ComboRow({title: 'Preferred routing source', model: Gtk.StringList.new([
        'Automatic — configured keys, then public routing', 'FOSSGIS — public, no key', 'OSRM demo — public, no key',
        'openrouteservice — free-plan key', 'GraphHopper — free-plan key', 'Neshan — traffic, key required'])});
    const syncProvider = () => { provider.selected = Math.max(0, providers.indexOf(settings.get_string('commute-provider'))); };
    syncProvider(); provider.connect('notify::selected', () => settings.set_string('commute-provider', providers[provider.selected]));
    const providerId = settings.connect('changed::commute-provider', syncProvider); group.add(provider);
    const fallback = new Adw.SwitchRow({title: 'Use backup routing sources', subtitle: 'May send endpoints to multiple providers. Public OSRM hosts share infrastructure.'});
    settings.bind('commute-fallback', fallback, 'active', Gio.SettingsBindFlags.DEFAULT); group.add(fallback);
    const addRow = new Adw.ActionRow({title: 'Saved routes', subtitle: 'Set both endpoints on a map. Up to 12 routes.'});
    const add = new Gtk.Button({label: 'Add route on map', valign: Gtk.Align.CENTER}); addRow.add_suffix(add); group.add(addRow);
    const rows = [];
    const open = async route => {
        try {
            await editRoute(window, route, value => {
                const all = routesFrom(settings.get_string('commute-routes'));
                const i = all.findIndex(r => r.id === value.id);
                if (i < 0) { if (all.length >= 12) return; all.push(value); } else all[i] = value;
                settings.set_string('commute-routes', JSON.stringify(all));
                settings.set_string('commute-selected', value.id);
            });
        } catch (error) { addRow.subtitle = 'Could not open the route editor. Reopen preferences and try again.'; console.warn(`Route editor: ${error.message}`); }
    };
    add.connect('clicked', () => open(null));
    const render = () => {
        for (const row of rows) group.remove(row); rows.length = 0;
        const all = routesFrom(settings.get_string('commute-routes')); add.sensitive = all.length < 12;
        for (const route of all) {
            const item = new Adw.ActionRow({title: routeTitle(route), subtitle: `${route.originMode === 'current' ? 'Current location' : route.originName} → ${route.destinationName}`, use_markup: false});
            const edit = new Gtk.Button({label: 'Edit', valign: Gtk.Align.CENTER}); edit.connect('clicked', () => open(route)); item.add_suffix(edit);
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Remove route', valign: Gtk.Align.CENTER});
            remove.connect('clicked', () => settings.set_string('commute-routes', JSON.stringify(routesFrom(settings.get_string('commute-routes')).filter(r => r.id !== route.id)))); item.add_suffix(remove);
            group.add(item); rows.push(item);
        }
    };
    const id = settings.connect('changed::commute-routes', render); render();
    const keys = new Adw.PreferencesGroup({title: 'Optional provider keys', description: 'Stored in the desktop keyring. Leave blank to use public routing. A key’s quota and regional availability depend on your provider account.'});
    for (const provider of ['ors', 'graphhopper', 'neshan']) {
        const row = new Adw.PasswordEntryRow({title: `${PROVIDER_NAMES[provider]} API key`});
        const save = new Gtk.Button({label: 'Save', valign: Gtk.Align.CENTER});
        const clear = new Gtk.Button({label: 'Remove', valign: Gtk.Align.CENTER});
        const store = async value => {
            save.sensitive = clear.sensitive = false;
            try { await saveRoutingKey(provider, value); row.text = ''; row.title = `${PROVIDER_NAMES[provider]} key ${value ? 'saved' : 'removed'}`;
                settings.set_int('commute-keys-revision', settings.get_int('commute-keys-revision') + 1);
            } catch { row.title = `${PROVIDER_NAMES[provider]}: keyring unavailable`; }
            finally { save.sensitive = clear.sensitive = true; }
        };
        save.connect('clicked', () => { if (row.text.trim()) store(row.text.trim()); }); clear.connect('clicked', () => store(''));
        row.add_suffix(save); row.add_suffix(clear); keys.add(row);
    }
    window.connect('close-request', () => { settings.disconnect(id); settings.disconnect(providerId); return false; });
    return [group, keys];
}
