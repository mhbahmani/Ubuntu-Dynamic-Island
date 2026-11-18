import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {containsPoint} from '../services/presentation.js';

export const IslandState = Object.freeze({
    COLLAPSED: 'collapsed',
    EXPANDING: 'expanding',
    EXPANDED: 'expanded',
    COLLAPSING: 'collapsing',
});

const COLLAPSED_HEIGHT = 34;
// Open corner radius plus the 1px edge (stylesheet.css, -surface-open). While
// docked at the panel edge the open shape's top is tucked this far above the
// surface clip, so its rounded top corners never show against the edge.
const OPEN_TUCK = 21;
const HEIGHT_BUDGET = 0.8; // of the monitor height
// Collapsed padding around the notch content (34px notch, 26px content).
const COLLAPSED_PADDING = 8;
const PANEL_PADDING = 2;
// A dismissing outside press may still be held: releasing the modal grab
// mid-press strands Clutter's pointer emission chain, so later clicks (the
// notch reopen click) route through the stale chain and never arrive. Wait
// for the press's release, capped for a release that never comes.
const DISMISS_GUARD_MS = 400;
const clampRange = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

// The island is a single chrome-managed St.Widget surface: the compact pill
// and expanded card keep stable layouts in a centered content viewport while
// the surface grows and their transforms blend, without a separate popup menu.
// Layers, bottom to top: an optional backdrop that blurs the desktop behind
// the surface (Matte tone), the theme tint and hairline edge (Background
// opacity), then sharp content. Only the tint layer carries transparency.
export class IslandSurface {
    constructor({settings, pill, card, backdrop = null, onStateChange, onBeforeExpand, onEscape, onSwitchTab}) {
        this._settings = settings;
        this._onStateChange = onStateChange;
        this._onBeforeExpand = onBeforeExpand;
        this._onEscape = onEscape;
        this._onSwitchTab = onSwitchTab;
        this.state = IslandState.COLLAPSED;
        this._token = 0; // invalidates stale transition completions on interrupt
        this._hoverOpen = 0;
        this._hoverClose = 0;
        this._hoverEnabled = false;
        this._hoverOpenMs = 180;
        this._hoverCloseMs = 350;
        this._layoutSignal = 0;
        this._dismissIdle = 0;
        this._dismissArmed = false;
        this._grab = null;
        this._grabSuspended = false;
        this._blend = false;
        this._concealed = false;

        this.actor = new St.Widget({
            style_class: 'ubuntu-island-surface ubuntu-island-surface-collapsed',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            can_focus: true,
            clip_to_allocation: true,
        });
        this._backdrop = backdrop;
        // Blur and tint share the surface's shape in one layer. Tucking it
        // extends that layer above the surface clip: its height is bound to
        // the surface plus the tuck and it is lifted by the same amount.
        this._shape = new Clutter.Actor({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        this._tuckBind = new Clutter.BindConstraint({source: this.actor,
            coordinate: Clutter.BindCoordinate.HEIGHT, offset: 0});
        this._shape.add_constraint_with_name('tuck', this._tuckBind);
        this.actor.add_child(this._shape);
        if (backdrop) {
            this._shape.add_child(backdrop);
            this.actor._islandBackdrop = backdrop;
        }
        this._material = new St.Widget({style_class: 'ubuntu-island-material', x_expand: true, y_expand: true});
        this._shape.add_child(this._material);
        backdrop?.setRadiusSource(this._material);
        // Blend style: the top bar's own color covers the collapsed notch and
        // fades to the theme tint as the card opens. It fills the surface's
        // clip, so its corners stay square and never round off at the dock.
        this._panelLayer = new St.Widget({style_class: 'ubuntu-island-panel-layer',
            x_expand: true, y_expand: true, visible: false, reactive: false});
        this.actor.add_child(this._panelLayer);
        this._pill = pill;
        this._card = card;
        // BinLayout clamps children to its changing allocation. Keep the two
        // content layers at their own sizes instead: only this viewport and
        // the surface morph, without reflowing text during every frame.
        this._content = new Clutter.Actor({layout_manager: new Clutter.FixedLayout(),
            x_expand: true, y_expand: true});
        this.actor.add_child(this._content);
        for (const layer of [this._pill, this._card]) {
            layer.set_position(0, 0);
            layer.add_constraint(new Clutter.AlignConstraint({source: this._content,
                align_axis: Clutter.AlignAxis.X_AXIS, factor: 0.5}));
            this._content.add_child(layer);
        }
        this._pill.add_constraint(new Clutter.AlignConstraint({source: this._content,
            align_axis: Clutter.AlignAxis.Y_AXIS, factor: 0.5}));
        this._pill.set_pivot_point(0.5, 0.5);
        this._card.set_pivot_point(0.5, 0);
        this._card.hide();
        // 1px inner top highlight, the "sheen" line of a glass panel.
        this._sheen = new St.Widget({style_class: 'ubuntu-island-sheen'});
        this._sheen.x_align = Clutter.ActorAlign.FILL;
        this._sheen.y_align = Clutter.ActorAlign.START;
        this.actor.add_child(this._sheen);

        // Static, CSS-scaled split underline, outside the pill's content layout.
        this._connectionEdge = new St.BoxLayout({style_class: 'ubuntu-island-connection-edge',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.END,
            x_expand: true, y_expand: true,
            visible: false, reactive: false});
        for (let i = 0; i < 2; i++)
            this._connectionEdge.add_child(new St.Widget({style_class: 'ubuntu-island-connection-edge-segment'}));
        this.actor.add_child(this._connectionEdge);
        this._connectionEdgeRequested = false;

        this._themeContext = St.ThemeContext?.get_for_stage(global.stage) ?? null;
        this.applyDimensions();

        this._connections = [];
        const track = (owner, signal, handler) =>
            this._connections.push([owner, owner.connect(signal, handler)]);
        if (this._themeContext) track(this._themeContext, 'notify::scale-factor', () => this.applyDimensions());
        track(this.actor, 'notify::width', () => this._recenter());
        // Hover, press, focus, typing and resizes repaint parts of the
        // island. Widen those frames to a full backdrop repaint up front.
        track(this.actor, 'queue-relayout', () => this._backdrop?.invalidate());
        track(this.actor, 'notify::visible', () => {
            // Chrome hides us over fullscreen windows; never reappear expanded.
            if (!this.actor.visible) this._snapCollapsed();
        });
        // Dismissal follows the PopupMenu pattern: while open we hold a modal
        // grab, so every press/key reaches this captured-event handler — even
        // presses over windows, which never emit stage events on Wayland.
        track(this.actor, 'captured-event', (actor, event) => this._onCapturedEvent(actor, event));
        if (Main.panel) {
            track(Main.panel, 'style-changed', () => this._syncPanelColor());
            track(Main.panel, 'notify::height', () => { if (this._blend) this.applyDimensions(); });
        }
        track(Main.sessionMode, 'updated', () => {
            if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) {
                this._snapCollapsed();
                this.actor.hide();
            } else {
                this.actor.show();
            }
        });
        track(this._pill, 'enter-event', () => this._hoverEnterPill());
        for (const part of [this._pill, this._card]) {
            track(part, 'enter-event', () => this._hoverEnter());
            track(part, 'leave-event', () => this._hoverLeave());
        }
    }

    get material() {
        return this._material;
    }

    get pill() {
        return this._pill;
    }

    get collapsedHeight() {
        return this._collapsedHeight;
    }

    get backdropRadius() {
        return this._backdrop?.blurRadius ?? 0;
    }

    // Tint style (theme colors, opacity alpha) and frosting strength apply
    // live to their own layers; content and layout are untouched.
    setAppearance(style, matte, opacity) {
        this._material.set_style(style);
        this._backdrop?.configure({matte, opacity, scale: this._scale});
    }

    invalidateBackdrop() {
        this._backdrop?.invalidate();
    }

    get expanded() {
        return this.state === IslandState.EXPANDED || this.state === IslandState.EXPANDING;
    }

    setConnectionEdge(active) {
        this._connectionEdgeRequested = Boolean(active);
        this._connectionEdge.visible = this._connectionEdgeRequested && this.state === IslandState.COLLAPSED;
    }

    show() {
        Main.layoutManager.addChrome(this.actor, {
            trackFullscreen: true, // hidden while the monitor has a fullscreen window
            affectsStruts: false,
        });
        this._layoutSignal = Main.layoutManager.connect('monitors-changed', () => {
            this.applyDimensions();
            this._recenter();
        });
        this._recenter();
    }

    destroy() {
        if (this._dismissIdle) GLib.Source.remove(this._dismissIdle);
        this._dismissIdle = 0;
        this._cancelHoverTimers();
        this._releaseGrab();
        if (this._layoutSignal) Main.layoutManager.disconnect(this._layoutSignal);
        this._layoutSignal = 0;
        for (const [owner, id] of this._connections) owner.disconnect(id);
        this._connections = [];
        if (this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }

    applyDimensions() {
        this._scale = this._themeContext?.scale_factor ?? 1;
        // Larger notch text makes the content taller than its 26px minimum;
        // the notch grows with it. Blend style matches the top bar's height.
        const content = this._pill.mapped ? Math.ceil(this._pill.get_preferred_height(-1)[1]) : 0;
        const panel = this._blend ? Main.panel?.height ?? 0 : 0;
        this._collapsedHeight = panel > 0
            ? Math.max(panel, content + PANEL_PADDING * this._scale)
            : Math.max(COLLAPSED_HEIGHT * this._scale, content + COLLAPSED_PADDING * this._scale);
        this._border = 2 * this._scale;
        // The 1px edge lives on the tint layer, so inset content to keep the
        // geometry the surface's own border used to give it.
        for (const side of ['margin_top', 'margin_right', 'margin_bottom', 'margin_left'])
            this._content[side] = this._scale;
        this._collapsedWidth = Math.max(
            this._scale * clampRange(this._settings.get_int('pill-width'), 150, 210),
            Math.ceil(this._pill._islandMinimumWidth?.() ?? 0) + this._border);
        this._expandedWidth = this._scale * clampRange(this._settings.get_int('expanded-width'), 380, 480);
        this._backdrop?.configure({scale: this._scale});
        if (this.expanded) this.relayout();
        else if (this.state === IslandState.COLLAPSING) this._retargetCollapse();
        else this._snapCollapsed();
    }

    // ---- blend with the top bar ----

    setPanelBlend(enabled) {
        enabled = Boolean(enabled);
        if (enabled === this._blend) return;
        this._blend = enabled;
        this._syncPanelColor();
        this._settleBlend();
        this.applyDimensions();
    }

    get panelBlend() {
        return this._blend;
    }

    _syncPanelColor() {
        if (!this._blend) return;
        let color = null;
        try {
            color = Main.panel?.get_theme_node().get_background_color() ?? null;
        } catch {
            color = null; // the panel is not styled yet; keep the last color
        }
        if (!color) return;
        const alpha = Math.round(color.alpha / 255 * 1000) / 1000;
        this._panelLayer.set_style(`background-color: rgba(${color.red},${color.green},${color.blue},${alpha});`);
    }

    // Collapsed in blend style: only the top bar color shows. Open: the
    // theme tint, edge and sheen, as in the island style.
    _settleBlend() {
        const collapsed = this.state === IslandState.COLLAPSED;
        const tinted = !this._blend || !collapsed;
        for (const layer of [this._material, this._sheen, this._panelLayer]) layer.remove_all_transitions();
        this._material.opacity = this._sheen.opacity = tinted ? 255 : 0;
        this._panelLayer.opacity = tinted ? 0 : 255;
        this._panelLayer.visible = this._blend && collapsed;
    }

    _easeBlend(open, duration) {
        if (!this._blend) return;
        this._panelLayer.show();
        const fade = (actor, opacity, time, mode) => {
            actor.remove_all_transitions();
            if (time <= 0) actor.opacity = opacity;
            else actor.ease({opacity, duration: Math.max(1, Math.round(time)), mode});
        };
        // Opening leaves the top bar quickly; closing settles into it at the
        // end, as the surface reaches the bar's size.
        const mode = open ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_IN_CUBIC;
        const time = open ? duration * 0.35 : duration;
        fade(this._panelLayer, open ? 0 : 255, time, mode);
        fade(this._material, open ? 255 : 0, time, mode);
        fade(this._sheen, open ? 255 : 0, time, mode);
    }

    // ---- auto-hide placement ----

    // A concealed notch sits above the monitor's top edge (collapsed only).
    // Opening always reveals it first, sliding down while the card grows.
    setConcealed(concealed, animate = true) {
        concealed = Boolean(concealed) && this.state === IslandState.COLLAPSED;
        if (concealed === this._concealed) return;
        this._concealed = concealed;
        const monitor = this._monitor();
        this.actor.remove_transition('y');
        if (!concealed) this.actor.opacity = 255;
        if (!monitor) return;
        const y = this._restingY(monitor);
        const duration = animate ? Math.round(this._animationMs() * (concealed ? 0.9 : 0.75)) : 0;
        if (duration <= 0) {
            this.actor.y = y;
            if (concealed) this.actor.opacity = 0;
            return;
        }
        this.actor.ease({y, duration,
            mode: concealed ? Clutter.AnimationMode.EASE_IN_CUBIC : Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => { if (this._concealed) this.actor.opacity = 0; }});
    }

    get concealed() {
        return this._concealed;
    }

    _restingY(monitor) {
        return monitor.y - (this._concealed ? this._collapsedHeight + this._scale : 0);
    }

    setHoverEnabled(enabled, openDelayMs, closeDelayMs) {
        this._hoverEnabled = Boolean(enabled);
        this._hoverOpenMs = Math.max(0, openDelayMs);
        this._hoverCloseMs = Math.max(0, closeDelayMs);
        if (!this._hoverEnabled) this._cancelHoverTimers();
    }

    toggle() {
        if (this.expanded) this.collapse();
        else this.expand();
    }

    expand() {
        if (this.expanded) return;
        const fromRest = this.state === IslandState.COLLAPSED;
        this.setConcealed(false);
        this._onBeforeExpand?.();
        const token = ++this._token;
        // Start tucked: the open shape's rounded top is hidden above the edge,
        // so switching shapes is invisible until the descent reveals it.
        if (fromRest) this._setTuck(OPEN_TUCK * this._scale);
        this._setState(IslandState.EXPANDING);
        this._cancelHoverTimers();
        if (!this._takeGrab()) {
            this._snapCollapsed();
            return;
        }
        if (fromRest) {
            this._card.scale_x = this._card.scale_y = 0.97;
            this._card.translation_y = -4 * this._scale;
        }
        this._card.show();
        this._pill.reactive = false;
        this._pill.can_focus = false;
        const natural = this._card._islandPreferredHeight
            ? this._card._islandPreferredHeight(this._expandedWidth - this._border)
            : this._cardContent().get_preferred_height(this._expandedWidth - this._border)[1];
        this._expandedHeight = Math.max(this._collapsedHeight, Math.min(natural + this._border, this._heightBudget()));
        this._sizeCard(this._expandedHeight);
        const duration = this._animationMs();
        // A centered, uniform contraction takes both ends inward as the old
        // notch descends and fades. It never stretches or redistributes text.
        // The notch clears early and the card fades in on an ease-in-out
        // curve, so the two layers hand off instead of overlapping mid-surface.
        this._easeContent(this._pill, {opacity: 0, scale_x: 0.9, scale_y: 0.9}, duration * 0.65,
            {duration: duration * 0.35});
        this._easeContent(this._card, {opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0}, duration,
            {duration: duration * 0.75, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
        this._easeBlend(true, duration);
        this._easeSize(this._expandedWidth, this._expandedHeight, duration, () => {
            if (token !== this._token) return;
            this._setState(IslandState.EXPANDED);
            this.relayout();
            if (!this._card._islandFocus?.()) this.actor.grab_key_focus();
        }, Clutter.AnimationMode.EASE_OUT_QUART);
    }

    collapse() {
        if (this.state === IslandState.COLLAPSED || this.state === IslandState.COLLAPSING) return;
        const token = ++this._token;
        // The notch re-renders its collapsed items here; a new minimum width
        // updates the target below instead of snapping the close.
        this._setState(IslandState.COLLAPSING);
        // Release input immediately so apps receive clicks during the close.
        this._releaseGrab();
        this._pill.reactive = true;
        this._pill.can_focus = true;
        this._pill.width = Math.max(1, this._collapsedWidth - this._border);
        const duration = Math.round(this._animationMs() * 0.75);
        // Mirror the opening: the card lifts and fades first, then the notch
        // grows back into place without both layers cross-fading mid-surface.
        this._easeContent(this._card, {opacity: 0, scale_x: 0.97, scale_y: 0.97,
            translation_y: -4 * this._scale}, duration * 0.65, {duration: duration * 0.5});
        // Ease-in-out keeps the notch nearly clear while the card fades, with
        // no timeline delay: those run on a wall-clock source, not the frame clock.
        this._easeContent(this._pill, {opacity: 255, scale_x: 1, scale_y: 1}, duration,
            {mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
        this._easeBlend(false, duration);
        this._easeSize(this._collapsedWidth, this._collapsedHeight, duration,
            () => this._finishCollapse(token), Clutter.AnimationMode.EASE_OUT_CUBIC);
    }

    _finishCollapse(token) {
        if (token !== this._token) return;
        this._card.hide();
        this._resetContent();
        this._setState(IslandState.COLLAPSED);
        this._setTuck(0); // the docked shape's top corners are square
        this._settleBlend();
    }

    // Notch content can change width mid-close (items return, media updates,
    // settings). Continue toward the new size in the remaining time.
    _retargetCollapse() {
        this._pill.width = Math.max(1, this._collapsedWidth - this._border);
        const transition = this.actor.get_transition('width') ?? this.actor.get_transition('height');
        if (!transition) return; // collapse() has not started resizing yet
        const remaining = Math.max(0, transition.get_duration() - transition.get_elapsed_time());
        const token = this._token;
        this._easeSize(this._collapsedWidth, this._collapsedHeight, remaining,
            () => this._finishCollapse(token), Clutter.AnimationMode.EASE_OUT_CUBIC);
    }

    // Content-driven height refresh while open (sections appearing/vanishing).
    relayout() {
        if (!this.expanded) return;
        const natural = this._card._islandPreferredHeight
            ? this._card._islandPreferredHeight(this._expandedWidth - this._border)
            : this._cardContent().get_preferred_height(this._expandedWidth - this._border)[1];
        const target = Math.max(this._collapsedHeight, Math.min(natural + this._border, this._heightBudget()));
        this._expandedHeight = target;
        this._sizeCard(target);
        // During opening, preserve the transition's completion callback.
        if (this.state === IslandState.EXPANDED)
            this._easeSize(this._expandedWidth, target, Math.min(160, this._animationMs()), null);
    }

    _cardContent() {
        return this._card.get_child?.() ?? this._card;
    }

    _sizeCard(height) {
        // Give content its final geometry once; only the containing surface
        // morphs. Reflowing every label and device row each frame causes jank.
        this._card.set_size(this._expandedWidth - this._border, Math.max(1, height - this._border));
    }

    _setState(state) {
        this.state = state;
        this.setConnectionEdge(this._connectionEdgeRequested);
        // The open shape stays until the close docks; its rounded top is tucked
        // above the edge by then (see OPEN_TUCK), so the switch never shows.
        const open = state !== IslandState.COLLAPSED;
        this.actor.set_style_class_name(open
            ? 'ubuntu-island-surface ubuntu-island-surface-open'
            : 'ubuntu-island-surface ubuntu-island-surface-collapsed');
        // Blur only while the card is open or animating; the collapsed notch
        // and a hidden surface run no backdrop effects.
        this._backdrop?.setActive(state !== IslandState.COLLAPSED);
        this._backdrop?.queue_relayout(); // corner radii follow the state class
        this._recenter();
        this._onStateChange?.(state);
    }

    _takeGrab() {
        if (this._grabSuspended || this._grab) return true;
        try {
            this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
            this.actor.reactive = true;
            return true;
        } catch (e) {
            console.warn(`[Ubuntu Island] input grab failed: ${e.message}`);
            this._grab = null;
            return false;
        }
    }

    // Live-tuning mode: while the separate preferences window is open, the
    // island stays expanded but gives up its modal grab — otherwise the grab
    // would swallow every click meant for that GTK window. Inside the island
    // widgets keep working (they are shell actors); outside-click/Escape
    // dismissal is suspended until resumeGrab().
    suspendGrab() {
        this._cancelHoverTimers();
        this._grabSuspended = true;
        this._releaseGrab();
    }

    resumeGrab() {
        if (!this._grabSuspended) return;
        this._grabSuspended = false;
        if (this.expanded) this._takeGrab();
    }

    _releaseGrab() {
        if (!this._grab) return;
        try {
            Main.popModal(this._grab);
        } catch (e) {
            console.warn(`[Ubuntu Island] releasing input grab: ${e.message}`);
        }
        this._grab = null;
        this.actor.reactive = false;
    }

    _onCapturedEvent(actor, event) {
        this._backdrop?.invalidate();
        if (!this.expanded || this._grabSuspended) return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const [x, y] = event.get_coords();
            const [left, top] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            if (!containsPoint(x, y, left, top, width, height)) {
                // Pop the modal only after Clutter finishes dispatching this
                // press AND its release. Changing the grab inside capture
                // mutates the active event chain and can strand the pointer's
                // implicit grab; the guard timeout also covers a release that
                // never arrives (button held or lost by the backend).
                this._armDismissal(DISMISS_GUARD_MS);
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END ||
                   type === Clutter.EventType.TOUCH_CANCEL) {
            if (!this._dismissArmed) return Clutter.EVENT_PROPAGATE;
            // The dismissing press finished; collapse once this release ends dispatch.
            this._armDismissal(0);
            return Clutter.EVENT_PROPAGATE;
        } else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            if (this._onEscape?.()) return Clutter.EVENT_STOP;
            this._armDismissal(0); // key dismissals carry no pending pointer sequence
            return Clutter.EVENT_STOP;
        } else if (type === Clutter.EventType.KEY_PRESS &&
            (event.get_key_symbol() === Clutter.KEY_Tab || event.get_key_symbol() === Clutter.KEY_ISO_Left_Tab)) {
            const backward = event.get_key_symbol() === Clutter.KEY_ISO_Left_Tab ||
                Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
            if (event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                this._onSwitchTab?.(backward ? -1 : 1);
                return Clutter.EVENT_STOP;
            }
            this._card.navigate_focus(global.stage.key_focus,
                backward ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // A positive delay arms the release guard (collapse at the cap); zero
    // collapses at the next idle, still outside the current input dispatch.
    _armDismissal(delay) {
        if (this._dismissIdle) GLib.Source.remove(this._dismissIdle);
        this._dismissIdle = 0;
        this._dismissArmed = delay > 0;
        this._dismissIdle = delay > 0
            ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => this._runDismissal())
            : GLib.idle_add(GLib.PRIORITY_DEFAULT, () => this._runDismissal());
        return this._dismissIdle;
    }

    _runDismissal() {
        this._dismissIdle = 0;
        this._dismissArmed = false;
        if (this.expanded && !this._grabSuspended) this.collapse();
        return GLib.SOURCE_REMOVE;
    }

    _easeSize(width, height, duration, onDone, mode = Clutter.AnimationMode.EASE_OUT_QUAD) {
        const translation_y = this.expanded ? 8 * this._scale : 0;
        // The tuck follows the drop: rounded top corners slide out from under
        // the panel edge as the card descends and back under as it docks.
        const tuck = this.expanded ? 0 : OPEN_TUCK * this._scale;
        // Keep a running reveal (y): opening a hidden notch slides it down.
        for (const property of ['width', 'height', 'translation-y']) this.actor.remove_transition(property);
        this._stopTuck();
        if (duration <= 0 || (this.actor.width === width && this.actor.height === height &&
            this.actor.translation_y === translation_y && this._tuckBind.offset === tuck)) {
            this.actor.set_size(width, height);
            this.actor.translation_y = translation_y;
            this._setTuck(tuck);
            onDone?.();
            return;
        }
        this._shape.ease({translation_y: 0 - tuck, duration, mode});
        this._shape.ease_property('@constraints.tuck.offset', tuck, {duration, mode});
        this.actor.ease({
            width,
            height,
            translation_y,
            duration,
            mode,
            onComplete: onDone,
        });
    }

    get tuck() {
        return this._tuckBind.offset;
    }

    _stopTuck() {
        this._shape.remove_transition('translation-y');
        this._shape.remove_transition('@constraints.tuck.offset');
    }

    _setTuck(tuck) {
        this._stopTuck();
        this._tuckBind.offset = tuck;
        this._shape.translation_y = 0 - tuck;
    }

    // Opacity may run on its own duration or curve (`fade`) so a layer can
    // appear late or vanish early without changing how its transform moves.
    _easeContent(actor, properties, duration, fade = null) {
        actor.remove_all_transitions();
        if (duration <= 0) {
            Object.assign(actor, properties);
            return;
        }
        const mode = Clutter.AnimationMode.EASE_OUT_CUBIC;
        if (!fade || properties.opacity === undefined) {
            actor.ease({...properties, duration: Math.round(duration), mode});
            return;
        }
        const {opacity, ...transform} = properties;
        actor.ease({...transform, duration: Math.round(duration), mode});
        actor.ease({opacity, mode: fade.mode ?? mode,
            duration: Math.max(1, Math.round(fade.duration ?? duration))});
    }

    _resetContent() {
        for (const layer of [this._pill, this._card]) {
            layer.remove_all_transitions();
            layer.scale_x = layer.scale_y = 1;
            layer.translation_y = 0;
        }
        this._pill.width = Math.max(1, this._collapsedWidth - this._border);
        this._pill.opacity = 255;
        this._card.opacity = 0;
    }

    // Interrupted/suppressed transitions (settings change, fullscreen hide)
    // settle here so rapid toggling can never leave a half-sized surface.
    _snapCollapsed() {
        this._token++;
        this._releaseGrab();
        this.actor.remove_all_transitions();
        this.actor.translation_y = 0;
        this._resetContent();
        this._pill.reactive = true;
        this._pill.can_focus = true;
        this._card.hide();
        this.actor.set_size(this._collapsedWidth, this._collapsedHeight);
        this._recenter(); // also settles an interrupted reveal or hide
        this.actor.opacity = this._concealed ? 0 : 255;
        if (this.state !== IslandState.COLLAPSED) this._setState(IslandState.COLLAPSED);
        this._setTuck(0);
        this._settleBlend();
    }

    _animationMs() {
        if (this._settings.get_boolean('disable-animations')) return 0;
        try {
            if (!St.Settings.get().enable_animations) return 0; // reduced motion
        } catch {
            // St.Settings unavailable; the user preference still applies.
        }
        return clampRange(this._settings.get_int('animation-duration'), 0, 500);
    }

    // ---- optional hover behavior (click always works; hover is opt-in) ----

    _hoverEnterPill() {
        if (!this._hoverEnabled || this.expanded) return;
        this._cancelHoverTimers();
        this._hoverOpen = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hoverOpenMs, () => {
            this._hoverOpen = 0;
            if (this._hoverEnabled && !this.expanded) this.expand();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hoverEnter() {
        if (this._hoverClose) {
            GLib.Source.remove(this._hoverClose);
            this._hoverClose = 0;
        }
    }

    _hoverLeave() {
        if (!this._hoverEnabled || this._grabSuspended || this._card._islandKeepOpen?.()) return;
        if (!this.expanded) {
            // Pointer left the pill before the open delay elapsed: stand down.
            this._cancelHoverTimers();
            return;
        }
        if (this._hoverClose) return;
        this._hoverClose = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hoverCloseMs, () => {
            this._hoverClose = 0;
            if (this._hoverEnabled && this.expanded && !this._card._islandKeepOpen?.() && !this._pointerInside()) this.collapse();
            return GLib.SOURCE_REMOVE;
        });
    }

    _pointerInside() {
        const [x, y] = global.get_pointer();
        const [left, top] = this.actor.get_transformed_position();
        const [width, height] = this.actor.get_transformed_size();
        return containsPoint(x, y, left, top, width, height);
    }

    _cancelHoverTimers() {
        for (const key of ['_hoverOpen', '_hoverClose']) {
            if (this[key]) {
                GLib.Source.remove(this[key]);
                this[key] = 0;
            }
        }
    }

    // ---- placement ----

    _monitor() {
        return Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors[0] ?? null;
    }

    _recenter() {
        const monitor = this._monitor();
        if (!monitor) return;
        const x = Math.round(monitor.x + (monitor.width - this.actor.width) / 2);
        // A reveal or hide in progress owns y; width changes only re-center.
        if (this.actor.get_transition('y')) this.actor.x = x;
        else this.actor.set_position(x, this._restingY(monitor));
    }

    _heightBudget() {
        const monitor = this._monitor();
        return Math.floor((monitor ? monitor.height : 1024) * HEIGHT_BUDGET);
    }

    _clampHeight() {
        if (!this.expanded) return;
        const max = this._heightBudget();
        if (this.actor.height > max) this.actor.height = max;
    }
}
