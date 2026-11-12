import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {label} from './widgets.js';

// One noninteractive popup per view, shared by its hover/focus targets. No
// repeating timers or hidden updates; a hover delay uses one cancellable source.
export class HoverTip {
    constructor(owner, {delay = 0, styleClass = ''} = {}) {
        this.owner = owner;
        this.delay = delay;
        this.timer = 0;
        this.ready = false;
        this.tip = label('', 'ubuntu-island-date-tooltip', false);
        if (styleClass) this.tip.add_style_class_name(styleClass);
        this.tip.clutter_text.line_wrap = true;
        this.tip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.tip.set_text_direction(Clutter.TextDirection.LTR);
        this.tip.hide();
        Main.layoutManager.addTopChrome(this.tip, {affectsInputRegion: false});
        owner.connect('notify::mapped', () => this.refresh());
        owner.connect('notify::allocation', () => this.refresh());
        owner.connect('destroy', () => {
            this._cancel();
            this.destroyed = true;
            Main.layoutManager.removeChrome(this.tip);
            this.tip.destroy();
            this.target = null;
        });
    }

    addTarget(actor, text) {
        const sync = () => {
            if (this.destroyed) return;
            // Keep a keyboard explanation stable while unrelated targets
            // receive pointer/allocation events during a live layout update.
            if (this.target?.actor !== actor && this.target?.actor.has_key_focus() && !actor.has_key_focus()) return;
            if (actor.mapped && (actor.hover || actor.has_key_focus())) {
                if (this.target?.actor !== actor) this._cancel();
                this.target = {actor, text};
            } else if (this.target?.actor !== actor) return;
            this.refresh();
        };
        actor.connectObject('destroy', () => {
            if (this.destroyed || this.target?.actor !== actor) return;
            this._cancel(); this.target = null;
        }, this.owner);
        actor.connectObject('notify::hover', sync, 'notify::mapped', sync,
            'notify::allocation', sync, 'key-focus-in', sync, 'key-focus-out', sync, this.owner);
    }

    _cancel() {
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = 0;
        this.ready = false;
        this.tip.hide();
    }

    refresh() {
        if (this.destroyed) return;
        const target = this.target?.actor;
        if (!this.owner.mapped || !target?.mapped || !(target.hover || target.has_key_focus())) {
            this._cancel(); return;
        }
        if (this.delay && !this.ready && !target.has_key_focus()) {
            if (!this.timer) this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.delay, () => {
                this.timer = 0;
                this.ready = true;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        const text = this.target.text();
        if (!text) { this.tip.hide(); return; }
        target.accessible_description = text;
        if (this.tip.text !== text) this.tip.text = text;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) { this.tip.hide(); return; }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const gap = 6 * scale, margin = 8 * scale;
        // A hidden popup may still have its default font on the first hover.
        this.tip.ensure_style();
        this.tip.width = -1;
        // Measure complete lines, not the previous allocation's wrapped layout.
        this.tip.clutter_text.line_wrap = false;
        const width = Math.min(this.tip.get_preferred_width(-1)[1], 360 * scale, monitor.width - 2 * margin);
        this.tip.clutter_text.line_wrap = true;
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
