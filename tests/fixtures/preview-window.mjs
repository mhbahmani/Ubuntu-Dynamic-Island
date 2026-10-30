// Real preferences-window lifecycle fixture, without the Extensions app service.
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const {default: Preferences} = await import('../prefs.js');
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const [, bytes] = root.get_child('metadata.json').load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
metadata.path = root.get_path();
metadata.dir = root;
Adw.init();
const loop = new GLib.MainLoop(null, false);
const window = new Adw.PreferencesWindow({title: 'Ubuntu Island', default_width: 650, default_height: 750});
new Preferences(metadata).fillPreferencesWindow(window);
window.set_visible_page_name('notch');
window.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2400, () => {
    window.close();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
