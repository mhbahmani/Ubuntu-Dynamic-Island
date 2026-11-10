import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {WeatherHttp} from '../services/weather-http.js';
import {CurrentLocation, openLocationSettings} from '../services/commute-location.js';
import {RouteMap} from './commute-map-view.js';
import {point} from '../services/commute-model.js';

// GTK map and tile requests exist only while the route editor is open.
export async function editRoute(parent, existing, onSave, options = {}) {
    const dialog = new Adw.Window({title: existing ? 'Edit route' : 'Add route', transient_for: parent, modal: true,
        default_width: 860, default_height: 740});
    const outer = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
    dialog.set_content(outer);
    const bar = new Adw.HeaderBar(); outer.append(bar);
    const save = new Gtk.Button({label: 'Save route'}); save.add_css_class('suggested-action'); bar.pack_end(save);
    const form = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_start: 14, margin_end: 14});
    const name = new Gtk.Entry({placeholder_text: 'Route name (optional; defaults to Start → Destination)', text: existing?.name ?? ''}); form.append(name);
    const endpoints = new Gtk.Box({spacing: 8});
    const start = new Gtk.ToggleButton({label: 'A · Set start', active: true});
    const end = new Gtk.ToggleButton({label: 'B · Set destination', group: start});
    const originName = new Gtk.Entry({placeholder_text: 'Start name', text: existing?.originName ?? '', hexpand: true});
    const destinationName = new Gtk.Entry({placeholder_text: 'Destination name', text: existing?.destinationName ?? '', hexpand: true});
    endpoints.append(start); endpoints.append(originName); endpoints.append(end); endpoints.append(destinationName); form.append(endpoints);
    const locationRow = new Gtk.Box({spacing: 8});
    const current = new Gtk.CheckButton({label: 'Use current location as start on each refresh', active: existing?.originMode === 'current', hexpand: true});
    const locate = new Gtk.Button({label: 'Locate me'}); locationRow.append(current); locationRow.append(locate);
    const locationSettings = new Gtk.Button({label: 'Location settings'});
    locationSettings.connect('clicked', openLocationSettings); locationRow.append(locationSettings);
    form.append(locationRow);
    const searchRow = new Gtk.Box({spacing: 8});
    const search = new Gtk.Entry({placeholder_text: 'Search an address or place (then choose a result)', hexpand: true});
    const searchButton = new Gtk.Button({label: 'Search'}); searchRow.append(search); searchRow.append(searchButton); form.append(searchRow);
    const results = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2}); form.append(results);
    const feedback = new Gtk.Label({label: 'Select A or B, then click the map. Drag a pin to refine it.', xalign: 0, wrap: true}); form.append(feedback);
    outer.append(form);
    const map = new RouteMap((id, p) => set(id, p, false), message => { feedback.label = message; }, options);
    outer.append(map.actor);
    const coordinates = new Gtk.Box({spacing: 8, margin_start: 14, margin_end: 14});
    const a = new Gtk.Entry({placeholder_text: 'Start latitude, longitude', hexpand: true});
    const b = new Gtk.Entry({placeholder_text: 'Destination latitude, longitude', hexpand: true});
    coordinates.append(a); coordinates.append(b); outer.append(coordinates);
    outer.append(new Gtk.Label({label: 'Map © OpenStreetMap contributors · Dashed line joins endpoints; it is not the driving route.', wrap: true, margin_bottom: 10}));
    let dead = false, selected = 'origin', generation = 0, lastSearch = 0;
    const draft = {origin: point(existing?.origin), destination: point(existing?.destination)};
    const http = new WeatherHttp('UbuntuIsland/11 RouteEditor (github.com/mhbahmani/ubuntu-dynamic-island)');
    const location = new CurrentLocation();
    const update = () => {
        a.text = draft.origin ? `${draft.origin.latitude.toFixed(6)}, ${draft.origin.longitude.toFixed(6)}` : '';
        b.text = draft.destination ? `${draft.destination.latitude.toFixed(6)}, ${draft.destination.longitude.toFixed(6)}` : '';
        save.sensitive = Boolean(draft.destination && (current.active || draft.origin));
    };
    const set = (id, p, pan = true) => {
        if (!point(p)) return;
        draft[id] = point(p);
        if (id === 'origin') current.active = false; // A manually chosen pin is a fixed start.
        update();
        if (pan) map.set(id, p);
    };
    map.load(draft);
    start.connect('toggled', () => { if (start.active) { selected = 'origin'; map.select('origin'); } });
    end.connect('toggled', () => { if (end.active) { selected = 'destination'; map.select('destination'); } });
    name.connect('changed', update);
    current.connect('toggled', update);
    for (const [entry, id] of [[a, 'origin'], [b, 'destination']]) entry.connect('activate', () => {
        const parts = entry.text.split(',').map(s => s.trim());
        const values = parts.map(s => s ? Number(s) : NaN);
        const p = values.length === 2 ? point({latitude: values[0], longitude: values[1]}) : null;
        if (p) set(id, p); else feedback.label = 'Enter latitude, longitude in decimal degrees.';
    });
    locate.connect('clicked', async () => {
        locate.sensitive = false; feedback.label = 'Requesting this computer’s location…';
        try {
            const p = await location.get(); if (dead) return;
            const tracking = current.active;
            set('origin', p); current.active = tracking; start.active = true;
            feedback.label = `Location accuracy: about ${Math.round(p.accuracy)} m. Confirm the start pin before saving.`;
        } catch (e) { if (!dead) feedback.label = e.message; }
        finally { if (!dead) locate.sensitive = true; }
    });
    const doSearch = async () => {
        const query = search.text.trim();
        if (query.length < 3 || Date.now() - lastSearch < 1100) return;
        lastSearch = Date.now(); const token = ++generation; const target = selected;
        http.cancel(); while (results.get_first_child()) results.remove(results.get_first_child());
        feedback.label = 'Searching…';
        try {
            const list = await http.get(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&q=${encodeURIComponent(query)}`);
            if (dead || token !== generation) return;
            feedback.label = list.length ? 'Choose a result, then refine the pin on the map.' : 'No results. Pan the map or enter coordinates.';
            for (const item of list.slice(0, 4)) {
                const p = point({latitude: Number(item.lat), longitude: Number(item.lon)}); if (!p) continue;
                const choice = new Gtk.Button({label: String(item.display_name).slice(0, 140)});
                choice.connect('clicked', () => {
                    set(target, p);
                    const entry = target === 'origin' ? originName : destinationName;
                    if (!entry.text.trim()) entry.text = String(item.name || query).slice(0, 80);
                    while (results.get_first_child()) results.remove(results.get_first_child());
                    feedback.label = 'Pin selected. Drag to refine its position.';
                }); results.append(choice);
            }
        } catch { if (!dead && token === generation) feedback.label = 'Search unavailable. Select points on the map or enter coordinates.'; }
    };
    searchButton.connect('clicked', doSearch); search.connect('activate', doSearch);
    save.connect('clicked', () => {
        if (!draft.destination || (!current.active && !draft.origin)) return;
        onSave({id: existing?.id ?? GLib.uuid_string_random(), name: name.text.trim().slice(0, 60),
            ...draft, originMode: current.active ? 'current' : 'fixed',
            originName: originName.text.trim() || 'Start', destinationName: destinationName.text.trim() || 'Destination'});
        dialog.close();
    });
    dialog.connect('close-request', () => { dead = true; ++generation; http.cancel(); location.cancel(); map.stop(); return false; });
    update(); dialog.present();
    // Exposed only to the local native fixture, never to remote map content.
    return {dialog, map, set, name, save, draft, current, originName, destinationName};
}
