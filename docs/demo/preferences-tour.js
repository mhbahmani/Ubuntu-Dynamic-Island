// Runs in the real GTK preferences window, using the private keyfile backend.
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const find = (widget, predicate) => {
    if (predicate(widget)) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const result = find(child, predicate); if (result) return result;
    }
    return null;
};
export async function runPreferencesTour(window, settings) {
    window.set_default_size(700, 620);
    Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_DARK;
    const output = GLib.getenv('ISLAND_VIDEO_OUTPUT');
    const chapters = [];
    const page = name => {
        window.set_visible_page_name(name);
        chapters.push({name, at: GLib.get_monotonic_time() / 1000000});
        GLib.file_set_contents(`${output}/preferences-chapters.json`, JSON.stringify(chapters));
    };
    await delay(700);
    page('appearance'); await delay(1600);
    page('notch'); await delay(600);
    const right = find(window.get_visible_page(), w => w.tooltip_text === 'Move selected item right');
    if (!right) throw new Error('Notch reorder control not found');
    right.grab_focus(); await delay(900);
    const original = settings.get_strv('pill-order');
    right.emit('clicked'); await delay(850);
    right.emit('clicked'); await delay(1200);
    const reordered = settings.get_strv('pill-order');
    if (reordered.indexOf('media') !== original.indexOf('media') + 2)
        throw new Error('Notch controls did not move Music two places');
    window.close();
    GLib.file_set_contents(`${output}/preferences-complete.json`, JSON.stringify({chapters, reordered}));
}
