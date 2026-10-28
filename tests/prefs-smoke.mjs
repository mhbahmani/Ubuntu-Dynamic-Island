// Run with GSETTINGS_BACKEND=memory and GNOME's helper typelib/library paths.
// Constructs real GTK controls without presenting a window or touching user settings.
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';

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
window.close();
print('Preferences controls and bidirectional settings passed');
