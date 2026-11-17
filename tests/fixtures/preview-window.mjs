import Gtk from 'gi://Gtk?version=4.0';
import {editRoute} from '../preferences/commute-map.js';
// Real preferences-window lifecycle fixture, without the Extensions app service.
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import Gdk from 'gi://Gdk';
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
const preferences = new Preferences(metadata);
preferences.fillPreferencesWindow(window);
window.set_visible_page_name('notch');
window.present();
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
// SIGUSR1 is sent by the parent after its focus, map capture and raise checks.
// A fixed delay can close this window before software-rendered CI reaches them.
const parentFinished = new Promise(resolve => GLibUnix.signal_add_full(GLib.PRIORITY_DEFAULT, 10, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
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
    await parentFinished;
    editor.save.emit('clicked');
    if (!saved || saved.name !== '' || !near(saved.origin.latitude, 35.73)) throw new Error('Map did not save confirmed endpoints');
    if (!map.dead || map.timer) throw new Error('Map resources not cleaned up');
    const second = await editRoute(window, saved, () => {}, {offline: true});
    second.current.active = true;
    second.set('origin', {latitude: 35.72, longitude: 51.33});
    if (second.current.active) throw new Error('Manual start still requests device location');
    second.dialog.close();
    print('[Island Smoke] Map editor PASS: click, drag, save, reopen, cleanup');
    const find = widget => {
        if (widget.tooltip_text === 'Set Quick Ask shortcut') return widget;
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            const found = find(child); if (found) return found;
        }
        return null;
    };
    window.set_visible_page_name('agents');
    const edit = find(window), settings = preferences.getSettings();
    const record = async () => {
        edit.emit('clicked'); await delay(100);
        const windows = Gtk.Window.get_toplevels();
        for (let i = 0; i < windows.get_n_items(); i++) {
            const dialog = windows.get_item(i);
            if (dialog.title !== 'Set Quick Ask shortcut') continue;
            const controllers = dialog.observe_controllers();
            for (let j = 0; j < controllers.get_n_items(); j++) {
                const controller = controllers.get_item(j);
                if (controller instanceof Gtk.EventControllerKey) return {dialog, controller};
            }
        }
        throw new Error('Shortcut recorder did not open');
    };
    let recorder = await record();
    recorder.controller.emit('key-pressed', Gdk.KEY_a, 0, 0);
    if (settings.get_strv('island-quick-ask-shortcut').length) throw new Error('Recorder accepted a bare letter');
    recorder.controller.emit('key-pressed', Gdk.KEY_Left, 0, Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.ALT_MASK);
    if (settings.get_strv('island-quick-ask-shortcut').length) throw new Error('Recorder accepted GNOME workspace switching');
    recorder.controller.emit('key-pressed', Gdk.KEY_space, 0, Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.ALT_MASK);
    if (settings.get_strv('island-quick-ask-shortcut').length !== 1) throw new Error('Recorder did not save a valid shortcut');
    recorder = await record();
    recorder.controller.emit('key-pressed', Gdk.KEY_Escape, 0, 0);
    if (settings.get_strv('island-quick-ask-shortcut').length !== 1) throw new Error('Escape changed the shortcut');
    recorder = await record();
    recorder.controller.emit('key-pressed', Gdk.KEY_BackSpace, 0, 0);
    if (settings.get_strv('island-quick-ask-shortcut').length) throw new Error('Recorder did not disable the shortcut');
    print('[Island Smoke] Shortcut recorder PASS: validation, save, cancel, disable');
    await delay(300);
    window.close(); finish();
};
run().catch(error => { printerr(`[Island Smoke] FAIL map editor: ${error.message}`); window.close(); finish(); });
await finished;
