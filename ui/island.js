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
const HEIGHT_BUDGET = 0.8; // of the monitor height
// A dismissing outside press may still be held: releasing the modal grab
// mid-press strands Clutter's pointer emission chain, so later clicks (the
// notch reopen click) route through the stale chain and never arrive. Wait
// for the press's release, capped for a release that never comes.
const DISMISS_GUARD_MS = 400;
const clampRange = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

// The island is a single chrome-managed St.Widget surface: the compact pill
// and expanded card keep stable layouts in a centered content viewport while
// the surface grows and their transforms blend, without a separate popup menu.
// The opaque surface paints reliably on mixed-scale monitors without backdrop sampling.
export class IslandSurface {
    constructor({settings, pill, card, onStateChange, onBeforeExpand, onEscape, onSwitchTab}) {
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

        this.actor = new St.Widget({
            style_class: 'ubuntu-island-surface ubuntu-island-surface-collapsed',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            can_focus: true,
            clip_to_allocation: true,
        });
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
        track(this.actor, 'notify::visible', () => {
            // Chrome hides us over fullscreen windows; never reappear expanded.
            if (!this.actor.visible) this._snapCollapsed();
        });
        // Dismissal follows the PopupMenu pattern: while open we hold a modal
        // grab, so every press/key reaches this captured-event handler — even
        // presses over windows, which never emit stage events on Wayland.
        track(this.actor, 'captured-event', (actor, event) => this._onCapturedEvent(actor, event));
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
            affectsInputRegion: true,
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
        this._collapsedHeight = COLLAPSED_HEIGHT * this._scale;
        this._border = 2 * this._scale;
        this._collapsedWidth = Math.max(
            this._scale * clampRange(this._settings.get_int('pill-width'), 150, 210),
            Math.ceil(this._pill._islandMinimumWidth?.() ?? 0) + this._border);
        this._expandedWidth = this._scale * clampRange(this._settings.get_int('expanded-width'), 380, 480);
        if (this.expanded) this.relayout();
        else this._snapCollapsed();
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
        this._onBeforeExpand?.();
        const token = ++this._token;
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
        this._easeContent(this._pill, {opacity: 0, scale_x: 0.9, scale_y: 0.9}, duration * 0.65);
        this._easeContent(this._card, {opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0}, duration);
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
        this._setState(IslandState.COLLAPSING);
        // Release input immediately so apps receive clicks during the close.
        this._releaseGrab();
        this._pill.reactive = true;
        this._pill.can_focus = true;
        const duration = Math.round(this._animationMs() * 0.75);
        this._easeContent(this._pill, {opacity: 255, scale_x: 1, scale_y: 1}, duration);
        this._easeContent(this._card, {opacity: 0, scale_x: 0.97, scale_y: 0.97,
            translation_y: -4 * this._scale}, duration * 0.65);
        this._easeSize(this._collapsedWidth, this._collapsedHeight, duration, () => {
            if (token !== this._token) return;
            this._card.hide();
            this._resetContent();
            this._setState(IslandState.COLLAPSED);
        }, Clutter.AnimationMode.EASE_OUT_CUBIC);
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
        const open = this.expanded;
        this.actor.set_style_class_name(open
            ? 'ubuntu-island-surface ubuntu-island-surface-open'
            : 'ubuntu-island-surface ubuntu-island-surface-collapsed');
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
            const backward = Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
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
        this.actor.remove_all_transitions();
        if (duration <= 0 || (this.actor.width === width && this.actor.height === height &&
            this.actor.translation_y === translation_y)) {
            this.actor.set_size(width, height);
            this.actor.translation_y = translation_y;
            onDone?.();
            return;
        }
        this.actor.ease({
            width,
            height,
            translation_y,
            duration,
            mode,
            onComplete: onDone,
        });
    }

    _easeContent(actor, properties, duration) {
        actor.remove_all_transitions();
        if (duration <= 0) {
            Object.assign(actor, properties);
            return;
        }
        actor.ease({...properties, duration: Math.round(duration), mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
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
        this._recenter();
        if (this.state !== IslandState.COLLAPSED) this._setState(IslandState.COLLAPSED);
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
        this.actor.set_position(
            Math.round(monitor.x + (monitor.width - this.actor.width) / 2),
            monitor.y);
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
