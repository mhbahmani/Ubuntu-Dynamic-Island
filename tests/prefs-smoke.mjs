import {CurrentLocation} from '../services/commute-location.js';
// Run with GSETTINGS_BACKEND=memory and GNOME's helper typelib/library paths.
// Constructs real GTK controls without presenting a window or touching user settings.
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const {default: Preferences} = await import('../prefs.js');
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const [, bytes] = root.get_child('metadata.json').load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
metadata.path = root.get_path();
metadata.dir = root;
Adw.init();
const prefs = new Preferences(metadata);
const settings = prefs.getSettings();
const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);
function find(widget, title) {
    if (widget instanceof Adw.PreferencesRow && widget.title === title) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const result = find(child, title);
        if (result) return result;
    }
    return null;
}
for (const name of ['appearance', 'notch', 'modules', 'weather', 'commute']) {
    window.set_visible_page_name(name);
    if (window.visible_page_name !== name) throw new Error(`Missing preferences tab: ${name}`);
}
for (const [title, key] of [['Show music name', 'pill-show-title'], ['Show weather icon', 'pill-show-weather'],
    ['Show upload/download rates', 'pill-show-network']]) {
    const row = find(window, title);
    if (!row) throw new Error(`Missing notch control: ${title}`);
    row.active = true;
    if (!settings.get_boolean(key)) throw new Error(`${title} did not save`);
    settings.set_boolean(key, false);
    if (row.active) throw new Error(`${title} did not follow settings`);
}
function tooltip(widget, text) {
    if (widget.tooltip_text === text) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const result = tooltip(child, text);
        if (result) return result;
    }
    return null;
}
const music = tooltip(window, 'Music');
const network = tooltip(window, 'Network');
if (!music || !network) throw new Error('Order preview missing');
const controllers = music.observe_controllers();
let drop;
for (let i = 0; i < controllers.get_n_items(); i++) {
    const controller = controllers.get_item(i);
    if (controller instanceof Gtk.DropTarget) drop = controller;
}
const sourceControllers = network.observe_controllers();
let drag;
for (let i = 0; i < sourceControllers.get_n_items(); i++) {
    const controller = sourceControllers.get_item(i);
    if (controller instanceof Gtk.DragSource) drag = controller;
}
if (!drag?.emit('prepare', 0, 0)) throw new Error('Drag source has no payload');
if (!drop?.emit('drop', 'network', 0, 0)) throw new Error('Order preview rejected drop');
if (settings.get_strv('pill-order')[0] !== 'network') throw new Error('Drop did not save order');
tooltip(window, 'Move selected item right').emit('clicked');
if (settings.get_strv('pill-order')[1] !== 'network') throw new Error('Keyboard move did not save order');
window.set_visible_page_name('appearance');
const interval = find(window, 'ETA refresh interval');
if (!interval || interval.adjustment.lower !== 10 || interval.adjustment.value !== 15)
    throw new Error('Commute interval bounds/default incorrect');
interval.adjustment.value = 20;
if (settings.get_int('commute-interval') !== 20) throw new Error('Commute interval failed to save');
settings.set_int('commute-interval', 10);
if (interval.adjustment.value !== 10) throw new Error('Commute interval failed to update');
const arrows = find(window, 'Network arrow shape');
const weatherStyle = find(window, 'Weather icon style');
if (!arrows || !weatherStyle) throw new Error('Notch style selectors missing');
arrows.selected = 0;
if (settings.get_string('pill-arrow-style') !== 'classic') throw new Error('Arrow style did not save');
settings.set_string('pill-arrow-style', 'chevron');
if (arrows.selected !== 1) throw new Error('Arrow style did not follow settings');
const angle = find(window, 'Chevron angle');
if (!angle || angle.adjustment.lower !== 40 || angle.adjustment.upper !== 120 || angle.adjustment.value !== 80)
    throw new Error('Chevron angle bounds/default incorrect');
angle.adjustment.value = 95;
if (settings.get_int('pill-arrow-angle') !== 95) throw new Error('Chevron angle did not save');
settings.set_int('pill-arrow-angle', 55);
if (angle.adjustment.value !== 55) throw new Error('Chevron angle did not follow settings');
settings.set_string('pill-arrow-style', 'classic');
if (angle.sensitive) throw new Error('Angle should be disabled for thin arrows');
settings.set_string('pill-arrow-style', 'chevron');
weatherStyle.selected = 1;
if (settings.get_string('pill-weather-style') !== 'minimal') throw new Error('Weather style did not save');
settings.set_string('pill-weather-style', 'colorful');
if (weatherStyle.selected !== 0) throw new Error('Weather style did not follow settings');
const theme = find(window, 'Color theme');
const opacity = find(window, 'Background opacity');
const matte = find(window, 'Matte tone');
if (!theme || !opacity || !matte) throw new Error('Appearance controls are missing');
theme.selected = 1;
if (settings.get_string('color-theme') !== 'ocean') throw new Error('Theme selection did not save');
settings.set_string('color-theme', 'forest');
if (theme.selected !== 2) throw new Error('Theme selection did not follow settings');
opacity.adjustment.value = 0;
const opening = find(window, 'Open on expand');
if (!opening || opening.selected !== 0 || settings.get_string('expand-tab') !== 'last')
    throw new Error('Default opening tab is not last used');
opening.selected = 6;
if (settings.get_string('expand-tab') !== 'commute') throw new Error('Opening tab did not save');
settings.set_string('expand-tab', 'audio');
if (opening.selected !== 3) throw new Error('Opening tab did not follow settings');
settings.set_string('expand-tab', 'last');
if (settings.get_int('surface-opacity') !== 0) throw new Error('Opacity did not save');
settings.set_int('surface-opacity', 100);
if (opacity.adjustment.value !== 100) throw new Error('Opacity control did not follow settings');
matte.adjustment.value = 25;
if (settings.get_int('surface-matte') !== 25) throw new Error('Matte did not save');
settings.set_int('surface-matte', 60);
if (matte.adjustment.value !== 60) throw new Error('Matte control did not follow settings');
const manual = find(window, 'Coordinates: latitude, longitude, timezone');
if (!manual) throw new Error('Weather controls missing');
manual.text = '35.6892, 51.3890, Asia/Tehran';
manual.emit('apply');
if (JSON.parse(settings.get_string('weather-location')).timezone !== 'Asia/Tehran')
    throw new Error('Weather coordinates failed to save');
const previous = settings.get_string('weather-location');
manual.text = '91, 0, Bad/Zone';
manual.emit('apply');
if (settings.get_string('weather-location') !== previous) throw new Error('Invalid coordinates saved');
try {
    await new CurrentLocation().get();
    throw new Error('Disabled Location Services did not reject');
} catch (error) {
    if (error.code !== 'location-disabled') throw error;
}
window.close();
print('Preferences controls and bidirectional settings passed');
