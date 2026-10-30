import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import {notchOrder} from './services/notch-model.js';

export function notchPreview(settings, window) {
    const group = new Adw.PreferencesGroup({title: 'Notch order',
        description: 'Drag items to reorder them. Select an item and use the arrows to move it with the keyboard. Hidden items keep their position.'});
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
        margin_top: 8, margin_bottom: 12});
    const preview = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER});
    preview.add_css_class('linked');
    const names = {media: 'Music', weather: 'Weather', network: 'Network', cpu: 'CPU', bluetooth: 'Bluetooth'};
    const icons = {media: 'audio-x-generic-symbolic', weather: 'weather-clear-symbolic',
        network: 'network-transmit-receive-symbolic', cpu: 'utilities-system-monitor-symbolic', bluetooth: 'bluetooth-symbolic'};
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
            const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin_start: 7, margin_end: 7, margin_top: 7, margin_bottom: 7});
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
