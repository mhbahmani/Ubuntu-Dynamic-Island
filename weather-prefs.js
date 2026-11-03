import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {WeatherHttp} from './services/weather-http.js';
import {parseLocation} from './services/weather-model.js';

export function weatherPreferences(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Weather',
        description: 'Opt in below, then select a location. Requests run while the Weather tab or its enabled notch indicator is visible. Coordinates are sent to the selected weather services.'});
    const enabled = new Adw.SwitchRow({title: 'Enable Weather', subtitle: 'Applies after disabling and re-enabling the extension'});
    settings.bind('enable-weather', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(enabled);
    const selected = new Adw.ActionRow({title: 'Selected location', use_markup: false});
    const update = () => { selected.subtitle = parseLocation(settings.get_string('weather-location'))?.name ?? 'None'; };
    update();
    const id = settings.connect('changed::weather-location', update);
    group.add(selected);
    const search = new Adw.EntryRow({title: 'Search city (English or Persian)', show_apply_button: true});
    group.add(search);
    const feedback = new Adw.ActionRow({title: 'Enter a city and press Apply', subtitle: 'Choose a result to confirm the location'});
    group.add(feedback);
    const http = new WeatherHttp();
    const results = [];
    let generation = 0;
    const clear = () => { for (const result of results) group.remove(result); results.length = 0; };
    search.connect('apply', async () => {
        const query = search.text.trim();
        const token = ++generation;
        http.cancel(); clear();
        if (query.length < 2) { feedback.title = 'Enter at least two characters'; return; }
        feedback.title = 'Searching…';
        try {
            const body = await http.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
            if (token !== generation) return;
            feedback.title = body.results?.length ? 'Select the matching location' : 'No matching city. Try coordinates below.';
            for (const place of (body.results ?? []).slice(0, 5)) {
                const location = parseLocation({...place, name: [place.name, place.admin1, place.country].filter(Boolean).join(', ')});
                if (!location) continue;
                const result = new Adw.ActionRow({title: location.name, use_markup: false,
                    subtitle: `${location.latitude}, ${location.longitude} · ${location.timezone}`});
                const select = new Gtk.Button({label: 'Use', valign: Gtk.Align.CENTER});
                select.connect('clicked', () => {
                    settings.set_string('weather-location', JSON.stringify(location));
                    feedback.title = 'Location saved'; clear();
                });
                result.add_suffix(select); group.add(result); results.push(result);
            }
        } catch {
            if (token === generation) feedback.title = 'Search unavailable. Retry or enter coordinates below.';
        }
    });
    const manual = new Adw.EntryRow({title: 'Coordinates: latitude, longitude, timezone', show_apply_button: true});
    group.add(manual);
    group.add(new Adw.ActionRow({title: 'Example: 35.6892, 51.3890, Asia/Tehran',
        subtitle: 'Manual coordinates work even when city search is unavailable.'}));
    manual.connect('apply', () => {
        const parts = manual.text.split(',').map(p => p.trim());
        const location = parts.length === 3 ? parseLocation({latitude: parts[0], longitude: parts[1], timezone: parts[2]}) : null;
        if (!location) { feedback.title = 'Invalid coordinates or IANA timezone'; return; }
        ++generation; http.cancel(); clear();
        settings.set_string('weather-location', JSON.stringify(location));
        feedback.title = 'Location saved';
    });
    for (const [key, title, values, names] of [
        ['weather-motion', 'Weather motion', ['off', 'subtle', 'live'], ['Off — static scene', 'Subtle — four seconds on opening', 'Live — while visible']],
        ['weather-units', 'Temperature units', ['celsius', 'fahrenheit'], ['Celsius', 'Fahrenheit']],
        ['weather-provider', 'Preferred source', ['open-meteo', 'met', 'wttr'],
            ['Open-Meteo → MET Norway → wttr.in', 'MET Norway → Open-Meteo → wttr.in', 'wttr.in → Open-Meteo → MET Norway']],
    ]) {
        const choice = new Adw.ComboRow({title, model: Gtk.StringList.new(names), selected: Math.max(0, values.indexOf(settings.get_string(key)))});
        choice.connect('notify::selected', () => settings.set_string(key, values[choice.selected]));
        group.add(choice);
    }
    window.connect('close-request', () => { ++generation; http.cancel(); settings.disconnect(id); return false; });
    return group;
}
