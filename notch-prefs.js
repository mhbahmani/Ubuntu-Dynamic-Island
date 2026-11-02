import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {notchOrder, ARROW_STYLES, WEATHER_STYLES, arrowSvg, ARROW_ANGLE_MIN, ARROW_ANGLE_MAX} from './services/notch-model.js';

export function notchPreview(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Notch order',
        description: 'Drag items to reorder them. Select an item and use the arrows to move it with the keyboard. Hidden items keep their position.'});
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
        margin_top: 8, margin_bottom: 12});
    const preview = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER});
    preview.add_css_class('linked');
    const names = {media: 'Music', weather: 'Weather', network: 'Network', cpu: 'CPU', bluetooth: 'Bluetooth', commute: 'Commute'};
    const icons = {media: 'audio-x-generic-symbolic', weather: 'weather-clear-symbolic',
        network: 'network-transmit-receive-symbolic', cpu: 'utilities-system-monitor-symbolic', bluetooth: 'bluetooth-symbolic', commute: 'find-location-symbolic'};
    let selected = 'media';
    const controls = new Gtk.Box({spacing: 8, halign: Gtk.Align.CENTER});
    const left = new Gtk.Button({icon_name: 'go-previous-symbolic', tooltip_text: 'Move selected item left'});
    const right = new Gtk.Button({icon_name: 'go-next-symbolic', tooltip_text: 'Move selected item right'});
    const caption = new Gtk.Label({label: 'Music', width_chars: 10});
    controls.append(left); controls.append(caption); controls.append(right);
    const move = (id, target) => {
        const order = notchOrder(settings.get_strv('pill-order'));
        const from = order.indexOf(id);
        if (from < 0 || target < 0 || target >= order.length) return false;
        order.splice(from, 1); order.splice(target, 0, id);
        selected = id;
        settings.set_strv('pill-order', order);
        return true;
    };
    left.connect('clicked', () => move(selected, notchOrder(settings.get_strv('pill-order')).indexOf(selected) - 1));
    right.connect('clicked', () => move(selected, notchOrder(settings.get_strv('pill-order')).indexOf(selected) + 1));
    const render = () => {
        while (preview.get_first_child()) preview.remove(preview.get_first_child());
        const order = notchOrder(settings.get_strv('pill-order'));
        order.forEach((id, index) => {
            const chip = new Gtk.ToggleButton({active: selected === id, tooltip_text: names[id]});
            const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin_start: 4, margin_end: 4, margin_top: 7, margin_bottom: 7});
            content.append(new Gtk.Image({icon_name: icons[id], pixel_size: 18}));
            content.append(new Gtk.Label({label: names[id]}));
            chip.set_child(content);
            chip.connect('clicked', () => { selected = id; render(); });
            const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
            drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(id));
            chip.add_controller(drag);
            const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
            drop.connect('drop', (_target, value) => move(value, index));
            chip.add_controller(drop);
            preview.append(chip);
        });
        caption.label = names[selected];
        left.sensitive = order.indexOf(selected) > 0;
        right.sensitive = order.indexOf(selected) < order.length - 1;
    };
    box.append(preview); box.append(controls); group.add(box);
    const signal = settings.connect('changed::pill-order', render);
    window.connect('close-request', () => { settings.disconnect(signal); return false; });
    render();
    return group;
}

export function notchStyles(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Indicator style', description: 'Applies immediately to the collapsed notch. Download stays red; upload stays green.'});
    const root = Gio.File.new_for_uri(import.meta.url).get_parent();
    const arrows = [new Gtk.Image({pixel_size: 18}), new Gtk.Image({pixel_size: 18})];
    const weather = new Gtk.Image({pixel_size: 22});
    const pair = new Gtk.Box({spacing: 6}); arrows.forEach(icon => pair.append(icon));
    const bindings = [
        ['pill-arrow-style', 'Network arrow shape', ARROW_STYLES, ['Thin arrows ↑ ↓', 'Chevrons'], pair],
        ['pill-weather-style', 'Weather icon style', WEATHER_STYLES, ['Colorful', 'Minimal outline'], weather],
    ];
    for (const [key, title, choices, names, preview] of bindings) {
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(names)});
        row.add_prefix(preview);
        const sync = () => {
            row.selected = Math.max(0, choices.indexOf(settings.get_string(key)));
            if (key === 'pill-arrow-style') arrows.forEach((icon, i) => icon.set_from_gicon(new Gio.BytesIcon({bytes: GLib.Bytes.new(new TextEncoder().encode(arrowSvg(choices[row.selected], i ? 'up' : 'down', settings.get_int('pill-arrow-angle'))))})));
            else if (row.selected === 1) weather.set_from_icon_name('weather-few-clouds-symbolic');
            else weather.set_from_gicon(new Gio.FileIcon({file: root.resolve_relative_path('assets/weather/notch/clouds.svg')}));
        };
        sync();
        row.connect('notify::selected', () => settings.set_string(key, choices[row.selected]));
        const id = settings.connect(`changed::${key}`, sync);
        const angleId = settings.connect('changed::pill-arrow-angle', sync);
        window.connect('close-request', () => { settings.disconnect(id); settings.disconnect(angleId); return false; });
        group.add(row);
        if (key === 'pill-arrow-style') {
            const angle = new Adw.SpinRow({title: 'Chevron angle', subtitle: 'Degrees · 40–120 · smaller makes a sharper tip',
                adjustment: new Gtk.Adjustment({lower: ARROW_ANGLE_MIN, upper: ARROW_ANGLE_MAX, step_increment: 1, page_increment: 5})});
            settings.bind('pill-arrow-angle', angle.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
            const sensitivity = () => { angle.sensitive = settings.get_string('pill-arrow-style') !== 'classic'; };
            sensitivity(); const sensitivityId = settings.connect('changed::pill-arrow-style', sensitivity);
            window.connect('close-request', () => { settings.disconnect(sensitivityId); return false; });
            group.add(angle);
        }
    }
    return group;
}
