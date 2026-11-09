import {CurrentLocation} from '../services/commute-location.js';
// Run with GSETTINGS_BACKEND=memory and GNOME's helper typelib/library paths.
// Constructs real GTK controls without presenting a window or touching user settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {routingKeyPreferences} from '../commute-prefs.js';
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
for (const name of ['appearance', 'notch', 'modules', 'weather', 'commute', 'agents']) {
    window.set_visible_page_name(name);
    if (window.visible_page_name !== name) throw new Error(`Missing preferences tab: ${name}`);
}
const agentsEnabled = find(window, 'Enable Agents');
if (!agentsEnabled || settings.get_boolean('enable-agents')) throw new Error('Agents must default off');
agentsEnabled.active = true;
if (!settings.get_boolean('enable-agents')) throw new Error('Agents toggle did not save');
settings.set_boolean('enable-agents', false);
if (agentsEnabled.active) throw new Error('Agents toggle did not follow settings');
const destination = find(window, 'Default destination');
destination.selected = 2;
if (settings.get_string('agents-destination') !== 'desktop') throw new Error('Desktop destination did not save');
settings.set_string('agents-destination', 'web');
if (destination.selected !== 3) throw new Error('Web destination did not follow settings');
const agentProvider = find(window, 'Default agent');
agentProvider.selected = 1;
if (settings.get_string('agents-provider') !== 'codex') throw new Error('Agent selection did not save');
const shortcutRow = find(window, 'Quick Ask shortcut');
if (!shortcutRow || settings.get_strv('island-quick-ask-shortcut').length) throw new Error('Quick Ask shortcut must default disabled');
const shortcutLabel = shortcutRow.activatable_widget.get_child();
settings.set_strv('island-quick-ask-shortcut', ['<Super><Alt>space']);
if (shortcutLabel.accelerator !== '<Super><Alt>space') throw new Error('Shortcut display did not follow settings');
settings.set_strv('island-quick-ask-shortcut', []);
if (shortcutLabel.accelerator !== '') throw new Error('Shortcut display did not clear');
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
// Allocate the real adaptive row, including a font size that made the old
// seven-label strip force the entire preferences window wider.
const orderPreview = music.get_parent().get_parent();
if (!(orderPreview instanceof Adw.Squeezer)) throw new Error('Order preview is not adaptive');
const [minimum, natural] = orderPreview.measure(Gtk.Orientation.HORIZONTAL, -1);
if (minimum > 300 || minimum >= natural) throw new Error('Order preview still forces a wide window');
const checkOrderWidth = width => {
    const fullWidth = orderPreview.measure(Gtk.Orientation.HORIZONTAL, -1)[1];
    orderPreview.allocate(width, 120, -1, null);
    const strip = orderPreview.get_visible_child();
    if (!strip || strip.get_width() > width) throw new Error(`Order preview overflows at ${width}px`);
    let count = 0;
    for (let chip = strip.get_first_child(); chip; chip = chip.get_next_sibling()) {
        count++;
        const image = chip.get_child().get_first_child();
        if (image.pixel_size !== (width >= fullWidth ? 18 : 14)) throw new Error('Order icons did not adapt to available space');
    }
    if (count !== 7) throw new Error('Compact order preview lost a module');
};
for (const width of [900, 560, 360, 300, 900]) checkOrderWidth(width);
const largeType = new Gtk.CssProvider();
largeType.load_from_data('* { font-size: 26px; }', -1);
orderPreview.get_style_context().add_provider(largeType, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
for (const width of [560, 360, 300]) checkOrderWidth(width);
const compactNetwork = tooltip(orderPreview.get_visible_child(), 'Network');
compactNetwork.emit('clicked');
tooltip(window, 'Move selected item right').emit('clicked');
if (settings.get_strv('pill-order')[2] !== 'network') throw new Error('Compact order selection or keyboard movement failed');
orderPreview.get_style_context().remove_provider(largeType);
window.set_visible_page_name('appearance');
const interval = find(window, 'ETA refresh interval');
if (!interval || interval.adjustment.lower !== 10 || interval.adjustment.value !== 15)
    throw new Error('Commute interval bounds/default incorrect');
interval.adjustment.value = 20;
if (settings.get_int('commute-interval') !== 20) throw new Error('Commute interval failed to save');
settings.set_int('commute-interval', 10);
if (interval.adjustment.value !== 10) throw new Error('Commute interval failed to update');
const commuteIndicator = find(window, 'Show Commute ETA');
if (!commuteIndicator || !tooltip(window, 'Commute')) throw new Error('Commute notch controls missing');
commuteIndicator.active = true;
if (!settings.get_boolean('pill-show-commute')) throw new Error('Commute notch toggle did not save');
settings.set_boolean('pill-show-commute', false);
if (commuteIndicator.active) throw new Error('Commute notch toggle did not follow settings');
const routingSource = find(window, 'Preferred routing source');
settings.set_string('commute-provider', 'mapbox');
if (routingSource.selected !== 6) throw new Error('Mapbox source missing from preferences');
const titleMode = find(window, 'Music name behavior');
const titleCharacters = find(window, 'Title character limit');
if (!titleMode || !titleCharacters || titleMode.selected !== 0 || titleCharacters.adjustment.upper !== 40)
    throw new Error('Title mode defaults or bounds missing');
titleMode.selected = 1;
if (settings.get_string('pill-title-mode') !== 'scroll' || titleCharacters.sensitive) throw new Error('Scrolling mode failed');
settings.set_string('pill-title-mode', 'fit');
if (titleMode.selected !== 2) throw new Error('Fit mode binding failed');
titleMode.selected = 0; titleCharacters.adjustment.value = 20;
if (!titleCharacters.sensitive || settings.get_int('pill-title-characters') !== 20) throw new Error('Title limit binding failed');
const arrows = find(window, 'Network arrow shape');
const offline = find(window, 'When offline');
if (!offline || offline.selected !== 0) throw new Error('Offline preference missing or default incorrect');
offline.selected = 2;
if (settings.get_string('pill-offline-mode') !== 'hide') throw new Error('Offline preference did not save');
settings.set_string('pill-offline-mode', 'edge');
if (offline.selected !== 1) throw new Error('Broken edge preference did not follow settings');
offline.selected = 0;
if (settings.get_string('pill-offline-mode') !== 'icon') throw new Error('Connection icon preference did not save');
settings.set_string('pill-offline-mode', 'hide');
if (offline.selected !== 2) throw new Error('Hide preference did not follow settings');
settings.set_string('pill-offline-mode', 'icon');
if (offline.selected !== 0) throw new Error('Offline preference did not follow settings');
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
const opening = find(window, 'Open on expand');
if (!opening || opening.selected !== 0 || settings.get_string('expand-tab') !== 'last')
    throw new Error('Default opening tab is not last used');
opening.selected = 6;
if (settings.get_string('expand-tab') !== 'commute') throw new Error('Opening tab did not save');
settings.set_string('expand-tab', 'audio');
if (opening.selected !== 3) throw new Error('Opening tab did not follow settings');
settings.set_string('expand-tab', 'last');
const theme = find(window, 'Color theme');
const opacity = find(window, 'Background opacity');
const matte = find(window, 'Matte tone');
if (!theme || !opacity || !matte) throw new Error('Appearance controls are missing');
theme.selected = 1;
if (settings.get_string('color-theme') !== 'ocean') throw new Error('Theme selection did not save');
settings.set_string('color-theme', 'forest');
if (theme.selected !== 2) throw new Error('Theme selection did not follow settings');
opacity.adjustment.value = 0;
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
// Accessible provider ordering persists and follows external settings changes.
const moveBalad = tooltip(window, 'Move down: Balad (experimental)');
if (!moveBalad) throw new Error('Provider priority controls missing');
moveBalad.emit('clicked');
if (settings.get_strv('commute-provider-order')[1] !== 'balad') throw new Error('Provider order did not save');
settings.set_strv('commute-provider-order', ['osrm', 'balad']);
if (!find(window, '1. OSRM demo')) throw new Error('Provider order did not follow settings');
settings.set_string('commute-provider', 'balad');
if (routingSource.selected !== 7) throw new Error('Balad selection missing');
const openWith = find(window, 'Open route in');
if (!openWith || openWith.selected !== 0) throw new Error('Route app selector missing');
openWith.selected = 1;
if (settings.get_string('commute-open-with') !== 'balad') throw new Error('Route app did not save');
settings.set_string('commute-open-with', 'neshan');
if (openWith.selected !== 2) throw new Error('Route app did not follow settings');

settings.set_string('commute-routes', JSON.stringify([
    {id: 'a', name: 'Route A', origin: {latitude: 35.7, longitude: 51.3}, destination: {latitude: 35.8, longitude: 51.4}},
    {id: 'b', name: 'Route B', origin: {latitude: 35.7, longitude: 51.3}, destination: {latitude: 35.8, longitude: 51.4}},
]));
settings.set_string('commute-selected', 'a');
buttonLabel(find(window, 'Route B'), 'Select').emit('clicked');
if (settings.get_string('commute-selected') !== 'b' || !buttonLabel(find(window, 'Route B'), 'Selected'))
    throw new Error('Saved route selection failed');

// Exercise real GTK controls with injected credentials and validation: never
// read/write the actual keyring or send account credentials during this test.
const wait = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { resolve(); return GLib.SOURCE_REMOVE; }));
function buttonLabel(widget, text) {
    if (widget instanceof Gtk.Button && widget.label === text) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const result = buttonLabel(child, text); if (result) return result;
    }
    return null;
}
const keyWindow = new Adw.PreferencesWindow();
const page = new Adw.PreferencesPage(); keyWindow.add(page);
let value = 'old-key', reject = true, writes = 0, releaseValidation;
const keyGroup = routingKeyPreferences(settings, keyWindow, {
    http: {cancel() {}}, load: async () => ({mapbox: value}),
    store: async (_provider, key) => { value = key; writes++; },
    validate: async () => { if (reject) throw new Error('Key rejected.'); if (releaseValidation) await releaseValidation; },
});
page.add(keyGroup); await wait();
const entry = find(keyWindow, 'Mapbox API key');
const keyStatus = find(keyWindow, 'Mapbox');
if (buttonLabel(keyStatus, 'Get API key')?.uri !== 'https://console.mapbox.com/account/access-tokens/') throw new Error('Provider key link missing');
const saveKey = buttonLabel(entry, 'Validate & save');
const removeKey = buttonLabel(entry, 'Remove');
if (!keyStatus.subtitle.startsWith('Key stored') || !removeKey.sensitive) throw new Error('Stored key not indicated');
entry.text = 'invalid-key'; saveKey.emit('clicked'); await wait();
if (writes || value !== 'old-key' || !keyStatus.subtitle.includes('Key rejected')) throw new Error('Rejected replacement changed saved key');
reject = false; entry.text = 'new-key'; saveKey.emit('clicked'); await wait();
if (writes !== 1 || value !== 'new-key' || entry.text || !keyStatus.subtitle.includes('verified')) throw new Error('Valid key failed to save');
removeKey.emit('clicked'); await wait();
if (value || !keyStatus.subtitle.startsWith('No key stored') || removeKey.sensitive) throw new Error('Key removal status incorrect');
releaseValidation = new Promise(resolve => { keyWindow._releaseValidation = resolve; });
entry.text = 'late-key'; saveKey.emit('clicked');
if (saveKey.sensitive || entry.sensitive) throw new Error('Validation allowed duplicate submissions');
keyWindow.emit('close-request'); keyWindow._releaseValidation(); await wait();
if (writes !== 2 || value) throw new Error('Validation saved a key after closing preferences');
window.close();
print('Preferences controls and bidirectional settings passed');
