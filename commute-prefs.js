import {editRoute} from './commute-map.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {routesFrom, PROVIDER_NAMES, providerPriority, routeTitle, ROUTE_APPS} from './services/commute-model.js';
import {routingKeys, saveRoutingKey} from './services/commute-keys.js';

import {WeatherHttp} from './services/weather-http.js';
import {validateRoutingKey} from './services/commute-validation.js';

export function commutePreferences(settings, window, dependencies = {}) {
    const group = new Adw.PreferencesGroup({title: 'Driving routes',
        description: 'Opt in to send endpoints to routing services while the Commute tab or its notch indicator is visible. OSRM estimates exclude traffic; Balad is an experimental keyless source. Map setup uses OpenStreetMap tiles and address search.'});
    const enabled = new Adw.SwitchRow({title: 'Enable Commute', subtitle: 'Applies after disabling and re-enabling the extension'});
    settings.bind('enable-commute', enabled, 'active', Gio.SettingsBindFlags.DEFAULT); group.add(enabled);
    const interval = new Adw.SpinRow({title: 'ETA refresh interval', subtitle: 'Minutes · minimum 10 · only while visible',
        adjustment: new Gtk.Adjustment({lower: 10, upper: 120, step_increment: 5, page_increment: 15})});
    settings.bind('commute-interval', interval.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT); group.add(interval);
    const providers = ['auto', 'fossgis', 'osrm', 'ors', 'graphhopper', 'neshan', 'mapbox', 'balad'];
    const provider = new Adw.ComboRow({title: 'Preferred routing source', model: Gtk.StringList.new([
        'Automatic — use provider priority', 'FOSSGIS — public, no key', 'OSRM demo — public, no key',
        'openrouteservice — free-plan key', 'GraphHopper — free-plan key', 'Neshan — traffic, key required', 'Mapbox — traffic-aware, free-plan token', 'Balad — experimental, no key'])});
    provider.subtitle = 'Traffic-aware ETA: configure Neshan or Mapbox. Public OSRM has no live traffic.';
    const syncProvider = () => { provider.selected = Math.max(0, providers.indexOf(settings.get_string('commute-provider'))); };
    syncProvider(); provider.connect('notify::selected', () => settings.set_string('commute-provider', providers[provider.selected]));
    const providerId = settings.connect('changed::commute-provider', syncProvider); group.add(provider);
    const routeApps = Object.keys(ROUTE_APPS);
    const openWith = new Adw.ComboRow({title: 'Open route in',
        subtitle: 'Opens driving directions in your browser. Independent of the ETA source; no API key needed.',
        model: Gtk.StringList.new(Object.values(ROUTE_APPS))});
    const syncOpenWith = () => { openWith.selected = Math.max(0, routeApps.indexOf(settings.get_string('commute-open-with'))); };
    syncOpenWith();
    openWith.connect('notify::selected', () => settings.set_string('commute-open-with', routeApps[openWith.selected]));
    const openWithId = settings.connect('changed::commute-open-with', syncOpenWith);
    group.add(openWith);
    const fallback = new Adw.SwitchRow({title: 'Use backup routing sources', subtitle: 'May send endpoints to multiple providers. Public OSRM hosts share infrastructure.'});
    settings.bind('commute-fallback', fallback, 'active', Gio.SettingsBindFlags.DEFAULT); group.add(fallback);
    const priority = new Adw.PreferencesGroup({title: 'Provider priority',
        description: 'Default: Balad, then Mapbox if configured. Public OSRM is a last resort in Automatic when no Mapbox token is stored. Reorder below or choose a preferred source. Balad traffic freshness is unverified.'});
    const priorityRows = [];
    const renderPriority = () => {
        for (const row of priorityRows) priority.remove(row);
        priorityRows.length = 0;
        const order = providerPriority(settings.get_strv('commute-provider-order'));
        order.forEach((name, index) => {
            const row = new Adw.ActionRow({title: `${index + 1}. ${PROVIDER_NAMES[name]}`});
            for (const [offset, icon, label] of [[-1, 'go-up-symbolic', 'Move up'], [1, 'go-down-symbolic', 'Move down']]) {
                const button = new Gtk.Button({icon_name: icon, tooltip_text: `${label}: ${PROVIDER_NAMES[name]}`, valign: Gtk.Align.CENTER,
                    sensitive: index + offset >= 0 && index + offset < order.length});
                button.connect('clicked', () => {
                    const changed = [...order];
                    [changed[index], changed[index + offset]] = [changed[index + offset], changed[index]];
                    settings.set_strv('commute-provider-order', changed);
                });
                row.add_suffix(button);
            }
            priority.add(row); priorityRows.push(row);
        });
    };
    const priorityId = settings.connect('changed::commute-provider-order', renderPriority); renderPriority();
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
            const selected = settings.get_string('commute-selected') === route.id || (!settings.get_string('commute-selected') && all[0]?.id === route.id);
            const select = new Gtk.Button({label: selected ? 'Selected' : 'Select', valign: Gtk.Align.CENTER, sensitive: !selected});
            select.connect('clicked', () => settings.set_string('commute-selected', route.id)); item.add_suffix(select);
            const edit = new Gtk.Button({label: 'Edit', valign: Gtk.Align.CENTER}); edit.connect('clicked', () => open(route)); item.add_suffix(edit);
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Remove route', valign: Gtk.Align.CENTER});
            remove.connect('clicked', () => settings.set_string('commute-routes', JSON.stringify(routesFrom(settings.get_string('commute-routes')).filter(r => r.id !== route.id)))); item.add_suffix(remove);
            group.add(item); rows.push(item);
        }
    };
    const id = settings.connect('changed::commute-routes', render);
    const selectionId = settings.connect('changed::commute-selected', render); render();
    const keyControls = routingKeyPreferences(settings, window, dependencies);
    window.connect('close-request', () => { settings.disconnect(id); settings.disconnect(selectionId); settings.disconnect(providerId); settings.disconnect(priorityId); settings.disconnect(openWithId); return false; });
    return [group, priority, keyControls];
}

export function routingKeyPreferences(settings, window, dependencies = {}) {
    const http = dependencies.http ?? new WeatherHttp();
    const load = dependencies.load ?? (cancel => routingKeys(cancel, true));
    const store = dependencies.store ?? saveRoutingKey;
    const validate = dependencies.validate ?? ((provider, value) => validateRoutingKey(provider, value, (url, headers) => http.get(url, headers)));
    const cancellable = new Gio.Cancellable();
    let closed = false;
    const keys = new Adw.PreferencesGroup({title: 'Provider API keys',
        description: 'Keys stay in the desktop keyring. Validation sends one test route between public Tehran landmarks to the provider; this may consume quota. Invalid or unverified replacements are not saved.'});
    const urls = {mapbox: 'https://console.mapbox.com/account/access-tokens/', neshan: 'https://platform.neshan.org/panel/',
        ors: 'https://account.heigit.org/', graphhopper: 'https://graphhopper.com/dashboard/'};
    const controls = [];
    for (const provider of ['mapbox', 'neshan', 'ors', 'graphhopper']) {
        const status = new Adw.ActionRow({title: PROVIDER_NAMES[provider], subtitle: 'Checking keyring…', use_markup: false});
        status.add_suffix(new Gtk.LinkButton({label: 'Get API key', uri: urls[provider], valign: Gtk.Align.CENTER}));
        keys.add(status);
        const row = new Adw.PasswordEntryRow({title: `${PROVIDER_NAMES[provider]} API key`});
        const save = new Gtk.Button({label: 'Validate & save', valign: Gtk.Align.CENTER, sensitive: false});
        const clear = new Gtk.Button({label: 'Remove', valign: Gtk.Align.CENTER, sensitive: false});
        let stored = false, busy = false, loaded = false;
        const sync = () => { save.sensitive = loaded && !busy && Boolean(row.text.trim()); clear.sensitive = loaded && !busy && stored; row.sensitive = !busy; };
        const message = text => { status.subtitle = `${stored ? 'Key stored' : 'No key stored'} · ${text}`; };
        const run = async value => {
            if (closed || busy || !loaded) return;
            busy = true; sync(); row.remove_css_class('error');
            message(value ? 'Validating…' : 'Removing…');
            let validated = !value;
            try {
                if (value) { await validate(provider, value); validated = true; }
                if (closed) return;
                await store(provider, value, cancellable);
                if (closed) return;
                stored = Boolean(value); row.text = ''; message(value ? 'Routing access verified' : 'Removed');
                settings.set_int('commute-keys-revision', settings.get_int('commute-keys-revision') + 1);
            } catch (error) {
                if (closed) return;
                row.add_css_class('error');
                // Validation errors are sanitized by validateRoutingKey.
                message(validated ? 'Keyring write failed. Try again.' : error.message);
            } finally { busy = false; if (!closed) sync(); }
        };
        row.connect('notify::text', sync);
        save.connect('clicked', () => run(row.text.trim())); clear.connect('clicked', () => run(''));
        row.add_suffix(save); row.add_suffix(clear); keys.add(row);
        controls.push({provider, initialize(value) { stored = Boolean(value); loaded = true; message('Not tested this session'); sync(); },
            unavailable() { status.subtitle = 'Keyring unavailable. Reopen preferences to retry.'; }});
    }
    load(cancellable).then(values => { if (!closed) for (const control of controls) control.initialize(values[control.provider]); })
        .catch(() => { if (!closed) for (const control of controls) control.unavailable(); });
    window.connect('close-request', () => { closed = true; cancellable.cancel(); http.cancel(); return false; });
    return keys;
}
