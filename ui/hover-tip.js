import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {label} from './widgets.js';

// One noninteractive popup per view, shared by its hover/focus targets. No
// repeating timers or hidden updates; a hover delay uses one cancellable source.
export class HoverTip {
    constructor(owner, {delay = 0, styleClass = '', motionSettings = null, dismissOnPress = false, viewport = null} = {}) {
        this.owner = owner;
        this.delay = delay;
        this.motionSettings = motionSettings;
        this.dismissOnPress = dismissOnPress;
        this.viewport = viewport;
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
        viewport?.get_vscroll_bar().get_adjustment().connectObject('notify::value', () => {
            if (this.scrollLater || !owner.mapped) return;
            this.scrollLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this.scrollLater = 0;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
        }, owner);
        owner.connect('destroy', () => {
            this._cancel();
            this.destroyed = true;
            Main.layoutManager.removeChrome(this.tip);
            this.tip.destroy();
            this.target = null;
            this.suppressed = this.pointerFocus = null;
        });
    }

    addTarget(actor, text) {
        const sync = () => {
            if (this.destroyed) return;
            if (this.suppressed === actor) return;
            // Keep a keyboard explanation stable while unrelated targets
            // receive pointer/allocation events during a live layout update.
            if (this.target?.actor !== actor && this.target?.actor !== this.pointerFocus &&
                this.target?.actor.has_key_focus() && !actor.has_key_focus()) return;
            if (actor.mapped && (actor.hover || actor.has_key_focus())) {
                if (this.target?.actor !== actor) this._cancel();
                this.target = {actor, text};
            } else if (this.target?.actor !== actor) return;
            this.refresh();
        };
        actor.connectObject('destroy', () => {
            if (this.suppressed === actor) this.suppressed = null;
            if (this.pointerFocus === actor) this.pointerFocus = null;
            if (this.destroyed || this.target?.actor !== actor) return;
            this._cancel(); this.target = null;
        }, this.owner);
        actor.connectObject('notify::hover', sync, 'notify::mapped', sync,
            'notify::allocation', sync, 'key-focus-in', sync, 'key-focus-out', sync, this.owner);
        if (this.dismissOnPress) {
            actor.connectObject('button-press-event', () => {
                this.suppressed = actor;
                this.pointerFocus = actor;
                this._cancel();
                return Clutter.EVENT_PROPAGATE;
            }, 'notify::hover', () => {
                if (!actor.hover && this.suppressed === actor) this.suppressed = null;
            }, 'key-focus-out', () => {
                if (this.suppressed === actor) this.suppressed = null;
                if (this.pointerFocus === actor) this.pointerFocus = null;
            }, 'key-press-event', () => {
                if (this.pointerFocus === actor) {
                    this.suppressed = this.pointerFocus = null; sync();
                }
                return Clutter.EVENT_PROPAGATE;
            }, this.owner);
        }
    }

    _cancel() {
        if (this.timer) GLib.Source.remove(this.timer);
        if (this.scrollLater) global.compositor.get_laters().remove(this.scrollLater);
        this.scrollLater = 0;
        this.timer = 0;
        this.ready = false;
        this.tip.remove_all_transitions();
        this.tip.opacity = 255;
        this.tip.hide();
    }

    _animationMs() {
        if (!this.motionSettings || this.motionSettings.get_boolean('disable-animations') ||
            !St.Settings.get().enable_animations) return 0;
        // Reuse GNOME 46's cached profile; no extra D-Bus client or polling.
        const profile = Main.panel.statusArea.quickSettings?._powerProfiles?.quickSettingsItems?.[0]?._proxy?.ActiveProfile;
        if (profile === 'power-saver') return 0;
        return Math.min(160, this.motionSettings.get_int('animation-duration'));
    }

    refresh() {
        if (this.destroyed) return;
        const target = this.target?.actor;
        const keyboardFocus = target?.has_key_focus() && target !== this.pointerFocus;
        if (!this.owner.mapped || !target?.mapped || target === this.suppressed || !(target.hover || keyboardFocus)) {
            this._cancel(); return;
        }
        if (this.viewport) {
            const [, top] = this.viewport.get_transformed_position();
            const [, height] = this.viewport.get_transformed_size();
            const [, y] = target.get_transformed_position();
            const [, h] = target.get_transformed_size();
            if (y + h <= top || y >= top + height) { this._cancel(); return; }
        }
        if (this.delay && !this.ready && !keyboardFocus) {
            if (!this.timer) this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.delay, () => {
                this.timer = 0;
                this.ready = true;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        const text = this.target.text();
        if (!text) { this._cancel(); return; }
        target.accessible_description = text;
        if (this.tip.text !== text) this.tip.text = text;
        const monitor = Main.layoutManager.findMonitorForActor(target) || Main.layoutManager.primaryMonitor;
        if (!monitor) { this.tip.hide(); return; }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const gap = 6 * scale, margin = 8 * scale;
        // A hidden popup may still have its default font on the first hover.
        this.tip.ensure_style();
        this.tip.width = -1;
        // Measure complete lines, not the previous allocation's wrapped layout.
        this.tip.clutter_text.line_wrap = false;
        const width = Math.ceil(Math.min(this.tip.get_preferred_width(-1)[1], 360 * scale, monitor.width - 2 * margin));
        this.tip.clutter_text.line_wrap = true;
        this.tip.width = width;
        const height = this.tip.get_preferred_height(width)[1];
        const [x, y] = target.get_transformed_position(), [w, h] = target.get_transformed_size();
        const below = y + h + gap;
        // Whole stage pixels keep the settled text off fractional raster origins.
        this.tip.set_position(Math.round(Math.max(monitor.x + margin,
            Math.min(x + (w - width) / 2, monitor.x + monitor.width - width - margin))),
        Math.round(Math.max(monitor.y + margin, below + height <= monitor.y + monitor.height - margin ? below : y - height - gap)));
        if (!this.tip.visible) {
            const duration = this._animationMs();
            this.tip.opacity = duration ? 0 : 255;
            this.tip.show();
            if (duration) this.tip.ease({opacity: 255, duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }
}
