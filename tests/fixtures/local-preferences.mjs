import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const {default: Preferences} = await import('./prefs.js');
const root = Gio.File.new_for_uri(import.meta.url).get_parent();
const [, bytes] = root.get_child('metadata.json').load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
metadata.path = root.get_path();
metadata.dir = root;
Adw.init();
let finish;
const finished = new Promise(resolve => { finish = resolve; });
const window = new Adw.PreferencesWindow({title: 'Ubuntu Island', default_width: 650, default_height: 750});
new Preferences(metadata).fillPreferencesWindow(window);
window.connect('close-request', () => { finish(); return false; });
window.present();
if (GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1') {
    const {editRoute} = await import('./commute-map.js');
    const settings = new Preferences(metadata).getSettings();
    window.set_visible_page_name('commute');
    await editRoute(window, null, route => {
        const all = JSON.parse(settings.get_string('commute-routes'));
        all.push(route); settings.set_string('commute-routes', JSON.stringify(all));
        settings.set_string('commute-selected', route.id);
    });
}
await finished;
