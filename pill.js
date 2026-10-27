import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {icon, label, row, clip} from './widgets.js';

// Compact notch content shown while collapsed. The St.Button gives keyboard
// focus semantics and an accessibility name for the toggle action.
export class Pill {
    constructor(onToggle, onToggleTitle) {
        this.actor = new St.Button({
            style_class: 'ubuntu-island-pill',
            can_focus: false,
            reactive: true,
            accessible_name: 'Open Ubuntu Island',
        });
        this.actor.connect('clicked', onToggle);
        if (onToggleTitle) {
            // Middle-click quickly hides the track name without opening the
            // island; a plain click still expands.
            this.actor.connect('button-press-event', (actor, event) => {
                if (event.get_button() !== 2) return Clutter.EVENT_PROPAGATE;
                onToggleTitle();
                return Clutter.EVENT_STOP;
            });
        }

        const content = row('ubuntu-island-pill-content');
        this.actor.set_child(content);

        this._mediaIcon = icon('audio-x-generic-symbolic', 14);
        this._title = label('Island', 'ubuntu-island-pill-title');
        this._bluetooth = icon('bluetooth-symbolic', 12);
        this._bluetooth.visible = false;
        this._cpuDot = new St.Widget({style_class: 'ubuntu-island-cpu-dot'});
        content.add_child(this._mediaIcon);
        content.add_child(this._title);
        content.add_child(new St.Widget({x_expand: true}));
        content.add_child(this._cpuDot);
        content.add_child(this._bluetooth);
    }

    // pillWidth comes from settings; the title clip length adapts so the row
    // never overflows the pill's fixed width (St labels cannot ellipsize).
    // showTitle=false hides the track name, keeping the play state icon.
    render({media, system, bluetooth, expanded, showMetrics, showTitle = true, pillWidth = 170}) {
        const available = Boolean(media?.available);
        const titleBudget = Math.max(6, Math.floor((pillWidth - 92) / 6.5));
        this._title.visible = Boolean(showTitle);
        this._title.text = available ? clip(String(media.title ?? ''), titleBudget) : 'Island';
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
