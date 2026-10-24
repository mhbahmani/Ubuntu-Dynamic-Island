import St from 'gi://St';
import {icon, label, row, clip} from './widgets.js';

// Compact notch content shown while collapsed. The St.Button gives keyboard
// focus semantics and an accessibility name for the toggle action.
export class Pill {
    constructor(onToggle) {
        this.actor = new St.Button({
            style_class: 'ubuntu-island-pill',
            can_focus: false,
            reactive: true,
            accessible_name: 'Open Ubuntu Island',
        });
        this.actor.connect('clicked', onToggle);
        const content = row();
        this.actor.set_child(content);

        this._mediaIcon = icon('audio-x-generic-symbolic', 15);
        this._title = label('Island', 'ubuntu-island-title');
        const spacer = new St.Widget({x_expand: true});
        this._cpuDot = new St.Widget({style_class: 'ubuntu-island-cpu-dot'});
        this._bluetooth = icon('bluetooth-symbolic', 13);
        this._bluetooth.visible = false;
        content.add_child(this._mediaIcon);
        content.add_child(this._title);
        content.add_child(spacer);
        content.add_child(this._cpuDot);
        content.add_child(this._bluetooth);
    }

    render({media, system, bluetooth, expanded, showMetrics}) {
        const available = Boolean(media?.available);
        this._title.text = available ? clip(String(media.title ?? ''), 18) : 'Island';
        this._mediaIcon.icon_name = available
            ? (media.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic')
            : 'audio-x-generic-symbolic';
        this._bluetooth.visible = Boolean(bluetooth?.available && bluetooth.devices.some(d => d.connected));
        this._cpuDot.visible = Boolean(showMetrics && system?.cpu != null);
        this._cpuDot.set_style_class_name(
            system?.cpu == null ? 'ubuntu-island-cpu-dot'
            : system.cpu < 50 ? 'ubuntu-island-cpu-dot ubuntu-island-dot-low'
            : system.cpu < 85 ? 'ubuntu-island-cpu-dot ubuntu-island-dot-mid'
            : 'ubuntu-island-cpu-dot ubuntu-island-dot-high');
        this.actor.accessible_name = expanded ? 'Close Ubuntu Island' : 'Open Ubuntu Island';
    }
}
