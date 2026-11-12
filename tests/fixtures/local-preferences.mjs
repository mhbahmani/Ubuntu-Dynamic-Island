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
window._islandCalendarReader = emit => ({watch() {emit({status:'ready',sources:[{uid:'sample-calendar',name:'Personal (sample)',account:'Sample account',enabled:true}]});},stop() {}});
new Preferences(metadata).fillPreferencesWindow(window);
window.connect('close-request', () => { finish(); return false; });
window.present();
if (GLib.getenv('ISLAND_PREVIEW_PREFERENCES') === 'notch') {
    const find = (widget, title) => {
        if (widget instanceof Adw.PreferencesRow && widget.title === title) return widget;
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            const match = find(child, title); if (match) return match;
        }
        return null;
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        const calendar = find(window, 'Jalali · شمسی');
        if (calendar instanceof Adw.ExpanderRow) {
            calendar.expanded = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                find(calendar, 'Numerals').grab_focus();
                return GLib.SOURCE_REMOVE;
            });
        }
        return GLib.SOURCE_REMOVE;
    });
}
if (GLib.getenv('ISLAND_PREVIEW_PREFERENCES') === 'agents') {
    const find = (widget, title) => {
        if (widget instanceof Adw.PreferencesRow && widget.title === title) return widget;
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            const match = find(child, title); if (match) return match;
        }
        return null;
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        const actions = find(window, 'Integration actions');
        actions.expanded = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            find(actions, 'Refresh status').activatable_widget.grab_focus();
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
}
if (GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1') {
    const {editRoute} = await import('./preferences/commute-map.js');
    const settings = new Preferences(metadata).getSettings();
    window.set_visible_page_name('commute');
    await editRoute(window, null, route => {
        const all = JSON.parse(settings.get_string('commute-routes'));
        all.push(route); settings.set_string('commute-routes', JSON.stringify(all));
        settings.set_string('commute-selected', route.id);
    });
}
await finished;
