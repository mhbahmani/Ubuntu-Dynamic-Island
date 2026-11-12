import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import {backdropSlices, blurParams} from '../services/appearance.js';

// Rows per rounded corner band (+1 middle slice); see backdropSlices().
const CORNER_STEPS = 3;
const SLICE_COUNT = 2 * CORNER_STEPS + 1;

// Ask the island backdrop (if any ancestor carries one) to repaint as a whole
// in the same frame as a known partial update, such as a chart or animation.
export function invalidateBackdrop(actor) {
    for (let node = actor; node; node = node.get_parent())
        if (node._islandBackdrop) { node._islandBackdrop.invalidate(); return; }
}

// The bottom layer of the island: Shell.BlurEffect in BACKGROUND mode blurs
// the desktop already painted behind the surface. The tint and content are
// separate siblings painted above it, so they stay sharp and are never part
// of the blur input. Hidden (no effects run) while collapsed or at matte 0.
//
// Background blur reads back the framebuffer. When Mutter repaints only part
// of the island, pixels outside that clip still hold the previous composite
// (tint and text), and blurring them would smear the frost. Every partial
// paint therefore schedules one full repaint of the island; known updaters
// call invalidate() first so their frame is already full.
export const IslandBackdrop = GObject.registerClass(
class IslandBackdrop extends St.Widget {
    _init() {
        super._init({style_class: 'ubuntu-island-backdrop', reactive: false, visible: false,
            x_expand: true, y_expand: true});
        this._options = {matte: 0, opacity: 98, scale: 1};
        this._params = blurParams(0);
        this._active = false;
        this._radiusSource = null;
        this._slices = [];
        this._correction = 0;
        this._expectFull = false;
        this._supported = Boolean(Shell.BlurEffect) && Shell.BlurMode?.BACKGROUND !== undefined;
        if (!this._supported) console.warn('[Ubuntu Island] Shell.BlurEffect is unavailable; matte tone cannot blur');
        this.connect('destroy', () => {
            if (this._correction) GLib.Source.remove(this._correction);
            this._correction = 0;
            this._radiusSource = null;
            this._slices = [];
        });
    }

    // The tint layer owns the corner radii; slices follow its theme node.
    setRadiusSource(actor) {
        this._radiusSource = actor;
        this.queue_relayout();
    }

    configure(options) {
        Object.assign(this._options, options);
        this._update();
    }

    setActive(active) {
        if (this._active === Boolean(active)) return;
        this._active = Boolean(active);
        this._update();
    }

    get blurRadius() {
        return this._supported && this._params.enabled ? this._params.radius : 0;
    }

    invalidate() {
        if (!this.visible || !this.mapped) return;
        this._expectFull = true;
        this.queue_redraw();
    }

    _update() {
        const {matte, opacity, scale} = this._options;
        const params = blurParams(matte, scale, opacity);
        this._params = params;
        const show = this._supported && this._active && params.enabled;
        if (show && !this._slices.length) this._build();
        for (const slice of this._slices) {
            const effect = slice._islandBlur;
            if (effect.radius !== params.radius && params.enabled) effect.radius = params.radius;
            if (Math.abs(effect.brightness - params.brightness) > 0.0005) effect.brightness = params.brightness;
        }
        if (show !== this.visible) {
            this._expectFull = false;
            this.visible = show;
            if (show) this.queue_relayout();
        }
    }

    _build() {
        for (let i = 0; i < SLICE_COUNT; i++) {
            const slice = new St.Widget({reactive: false});
            slice._islandBlur = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius: Math.max(1, this._params.radius),
                brightness: this._params.brightness,
            });
            slice.add_effect_with_name('ubuntu-island-blur', slice._islandBlur);
            this.add_child(slice);
            this._slices.push(slice);
        }
    }

    _radii() {
        try {
            if (!this._radiusSource?.mapped) return [0, 0];
            const node = this._radiusSource.get_theme_node();
            return [node.get_border_radius(St.Corner.TOPLEFT), node.get_border_radius(St.Corner.BOTTOMLEFT)];
        } catch {
            return [0, 0];
        }
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        if (!this._slices.length) return;
        const [top, bottom] = this._radii();
        const pieces = backdropSlices(box.get_width(), box.get_height(), top, bottom, CORNER_STEPS);
        this._slices.forEach((slice, index) => {
            const piece = pieces[index];
            const childBox = new Clutter.ActorBox();
            if (piece) {
                childBox.x1 = piece.x;
                childBox.y1 = piece.y;
                childBox.x2 = piece.x + piece.width;
                childBox.y2 = piece.y + piece.height;
            }
            // Unused slices keep a zero box and a disabled effect; toggling
            // visibility here would queue a relayout during allocation.
            if (slice._islandBlur.enabled !== Boolean(piece)) slice._islandBlur.enabled = Boolean(piece);
            slice.allocate(childBox);
        });
    }

    vfunc_paint(paintContext) {
        super.vfunc_paint(paintContext);
        if (this._expectFull) {
            this._expectFull = false;
            return;
        }
        if (this._correction) return;
        // Defer out of the paint: one full repaint, never a repaint loop
        // (the correction frame is expected to be full and schedules nothing).
        this._correction = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._correction = 0;
            this.invalidate();
            return GLib.SOURCE_REMOVE;
        });
    }
});
