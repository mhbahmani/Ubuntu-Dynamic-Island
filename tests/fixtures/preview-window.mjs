import Gtk from 'gi://Gtk?version=4.0';
import {editRoute} from '../commute-map.js';
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
let finish;
const finished = new Promise(resolve => { finish = resolve; });
const window = new Adw.PreferencesWindow({title: 'Ubuntu Island', default_width: 650, default_height: 750});
new Preferences(metadata).fillPreferencesWindow(window);
window.set_visible_page_name('notch');
window.present();
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const run = async () => {
    await delay(1000);
    let saved;
    const editor = await editRoute(window, null, value => { saved = value; }, {offline: true});
    await delay(150);
    const map = editor.map;
    const click = point => {
        const p = map.screen(point);
        map.drag.emit('drag-begin', p.x, p.y); map.drag.emit('drag-end', 0, 0);
    };
    click({latitude: 35.72, longitude: 51.33});
    map.select('destination'); click({latitude: 35.68, longitude: 51.39});
    const start = map.screen(map.points.origin), end = map.screen({latitude: 35.73, longitude: 51.34});
    map.drag.emit('drag-begin', start.x, start.y);
    map.drag.emit('drag-update', end.x - start.x, end.y - start.y);
    map.drag.emit('drag-end', end.x - start.x, end.y - start.y);
    const near = (a, b) => Math.abs(a - b) < .000001;
    editor.name.text = '';
    editor.originName.text = 'Work'; editor.destinationName.text = 'Home';
    if (!editor.save.sensitive) throw new Error('Route name is still required');
    if (!near(editor.draft.origin?.latitude, 35.73) || !near(editor.draft.destination?.longitude, 51.39))
        throw new Error('Map click/drag failed to update endpoint coordinates');
    await delay(2000); // Allow the parent Shell fixture to capture the map window.
    editor.save.emit('clicked');
    if (!saved || saved.name !== '' || !near(saved.origin.latitude, 35.73)) throw new Error('Map did not save confirmed endpoints');
    if (!map.dead || map.timer) throw new Error('Map resources not cleaned up');
    const second = await editRoute(window, saved, () => {}, {offline: true});
    second.current.active = true;
    second.set('origin', {latitude: 35.72, longitude: 51.33});
    if (second.current.active) throw new Error('Manual start still requests device location');
    second.dialog.close();
    print('[Island Smoke] Map editor PASS: click, drag, save, reopen, cleanup');
    await delay(300);
    window.close(); finish();
};
run().catch(error => { printerr(`[Island Smoke] FAIL map editor: ${error.message}`); window.close(); finish(); });
await finished;
