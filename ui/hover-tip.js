import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {label} from './widgets.js';

// One noninteractive popup per view, shared by its hover/focus targets. No
// timers or hidden updates; conversions run only for the current target.
export class HoverTip {
    constructor(owner) {
        this.owner = owner;
        this.tip = label('', 'ubuntu-island-date-tooltip', false);
        this.tip.clutter_text.line_wrap = true;
        this.tip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.tip.set_text_direction(Clutter.TextDirection.LTR);
        this.tip.hide();
        Main.layoutManager.addTopChrome(this.tip, {affectsInputRegion: false});
        owner.connect('notify::mapped', () => this.refresh());
        owner.connect('notify::allocation', () => this.refresh());
        owner.connect('destroy', () => {
            this.destroyed = true;
            Main.layoutManager.removeChrome(this.tip);
            this.tip.destroy();
            this.target = null;
        });
    }

    addTarget(actor, text) {
        const sync = () => {
            if (this.destroyed) return;
            if (actor.mapped && (actor.hover || actor.has_key_focus()))
                this.target = {actor, text};
            else if (this.target?.actor !== actor) return;
            this.refresh();
        };
        actor.connectObject('notify::hover', sync, 'notify::mapped', sync,
            'notify::allocation', sync, 'key-focus-in', sync, 'key-focus-out', sync, this.owner);
    }

    refresh() {
        if (this.destroyed) return;
        const target = this.target?.actor;
        if (!this.owner.mapped || !target?.mapped || !(target.hover || target.has_key_focus())) {
            this.tip.hide(); return;
        }
        const text = this.target.text();
        if (!text) { this.tip.hide(); return; }
        target.accessible_description = text;
        if (this.tip.text !== text) this.tip.text = text;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) { this.tip.hide(); return; }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const gap = 6 * scale, margin = 8 * scale;
        this.tip.width = -1;
        const width = Math.min(this.tip.get_preferred_width(-1)[1], 360 * scale, monitor.width - 2 * margin);
        this.tip.width = width;
        const height = this.tip.get_preferred_height(width)[1];
        const [x, y] = target.get_transformed_position(), [w, h] = target.get_transformed_size();
        const below = y + h + gap;
        this.tip.set_position(Math.max(monitor.x + margin,
            Math.min(x + (w - width) / 2, monitor.x + monitor.width - width - margin)),
        Math.max(monitor.y + margin, below + height <= monitor.y + monitor.height - margin ? below : y - height - gap));
        this.tip.show();
    }
}
