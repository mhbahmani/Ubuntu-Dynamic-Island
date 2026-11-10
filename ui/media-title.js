import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';
import {titleText, titleLimit} from '../services/notch-model.js';

// One clipped label, animated by Clutter. No JavaScript frame timer or repaint loop.
export class MediaTitle {
    constructor() {
        this.actor = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.label = new St.Label({style_class: 'ubuntu-island-pill-title', x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this.label);
        this.label.clutter_text.single_line_mode = true;
        this.motionSettings = St.Settings.get();
        this.motionId = this.motionSettings.connect('notify::enable-animations', () => this.sync());
        this.actor.connect('notify::mapped', () => { if (this.actor.mapped) this.setBudget(this.budget); this.sync(); });
        this.actor.connect('notify::width', () => this.sync());
        this.actor.connect('destroy', () => {
            this.dead = true; this.stop(); this.motionSettings.disconnect(this.motionId);
        });
        this.mode = 'fixed'; this.limit = 12; this.full = ''; this.budget = 240;
    }
    configure(text, mode, limit, visible, expanded, animations) {
        this.full = text; this.mode = mode; this.limit = titleLimit(limit);
        this.expanded = expanded; this.animations = animations;
        this.actor.visible = visible; this.label.visible = visible;
        const displayKey = `${mode}:${this.limit}:${text}`;
        const display = displayKey === this.displayKey ? this.label.text : titleText(text, mode, limit);
        this.displayKey = displayKey;
        if (this.label.text !== display) { this.label.text = display; this.stop(); }
        this.label.clutter_text.ellipsize = mode === 'scroll' ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
        this.setBudget(this.budget);
        this.sync();
    }
    setBudget(budget) {
        this.budget = budget;
        if (!this.actor.get_stage()) return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const natural = this.label.clutter_text.get_preferred_width(-1)[1];
        // Fixed trimming caps long titles; short titles need only their measured
        // width, otherwise the unused slot becomes a gap before the next icon.
        const width = this.mode === 'scroll' ? Math.min(budget, 84 * scale)
            : Math.min(natural, budget, this.mode === 'fixed' ? this.limit * 7 * scale : Infinity);
        this.desiredWidth = Math.max(1, width);
        this.actor.width = this.desiredWidth;
        this.actor.height = this.label.get_preferred_height(-1)[1];
        // Prevent the label's minimum width from expanding its clipped viewport.
        this.label.width = this.mode === 'scroll' ? natural : Math.max(1, width);
    }
    stop() {
        this.animationKey = null;
        this.label.remove_transition('island-title-scroll');
        this.label.translation_x = 0;
    }
    sync() {
        if (this.dead) return;
        if (!this.actor.mapped) { this.stop(); return; }
        const extent = Math.max(0, this.label.clutter_text.get_preferred_width(-1)[1] - this.actor.width);
        const active = this.mode === 'scroll' && this.actor.mapped && this.actor.visible && !this.expanded &&
            this.animations && this.motionSettings.enable_animations && extent > 1;
        if (!active) { this.stop(); return; }
        const key = `${this.full}:${this.actor.width}:${extent}`;
        if (key === this.animationKey) return;
        this.stop(); this.animationKey = key;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const pause = 1200;
        const travel = Math.max(800, Math.round(extent / (24 * scale) * 1000));
        const duration = 2 * (pause + travel);
        // One native round trip includes both pauses. Implicit ease() may
        // complete synchronously during remapping, so never chain callbacks.
        const transition = new Clutter.KeyframeTransition({property_name: 'translation-x',
            interval: new Clutter.Interval({value_type: GObject.TYPE_FLOAT}),
            duration, repeat_count: -1, remove_on_complete: false, progress_mode: Clutter.AnimationMode.LINEAR});
        transition.set_from(0);
        transition.set_to(0);
        transition.set_key_frames([pause / duration, (pause + travel) / duration, (2 * pause + travel) / duration]);
        transition.set_values([0, -extent, -extent].map(number => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_FLOAT);
            value.set_float(number);
            return value;
        }));
        transition.set_modes([Clutter.AnimationMode.LINEAR, Clutter.AnimationMode.LINEAR, Clutter.AnimationMode.LINEAR]);
        this.label.add_transition('island-title-scroll', transition);
    }
}
