import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {containsPoint} from './services/presentation.js';

export const IslandState = Object.freeze({
    COLLAPSED: 'collapsed',
    EXPANDING: 'expanding',
    EXPANDED: 'expanded',
    COLLAPSING: 'collapsing',
});

const COLLAPSED_HEIGHT = 34;
const HEIGHT_BUDGET = 0.8; // of the monitor height
const clampRange = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

// The island is a single chrome-managed St.Widget surface: the compact pill
// and the expanded card are two children of the same actor, morphed with
// width/height/opacity tweens instead of a separate popup menu. The opaque
// surface paints reliably on mixed-scale monitors without backdrop sampling.
export class IslandSurface {
    constructor({settings, pill, card, onStateChange}) {
        this._settings = settings;
        this._onStateChange = onStateChange;
        this.state = IslandState.COLLAPSED;
        this._token = 0; // invalidates stale transition completions on interrupt
        this._hoverOpen = 0;
        this._hoverClose = 0;
        this._hoverEnabled = false;
        this._hoverOpenMs = 180;
        this._hoverCloseMs = 350;
        this._layoutSignal = 0;
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
        this._pill.x_align = Clutter.ActorAlign.FILL;
        this._pill.x_expand = true;
        this._pill.y_align = Clutter.ActorAlign.CENTER;
        this._card.hide();
        this.actor.add_child(this._pill);
        this.actor.add_child(this._card);
        // 1px inner top highlight, the "sheen" line of a glass panel.
        this._sheen = new St.Widget({style_class: 'ubuntu-island-sheen'});
        this._sheen.x_align = Clutter.ActorAlign.FILL;
        this._sheen.y_align = Clutter.ActorAlign.START;
        this.actor.add_child(this._sheen);

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
        const token = ++this._token;
        this._setState(IslandState.EXPANDING);
        this._cancelHoverTimers();
        if (!this._takeGrab()) {
            this._setState(IslandState.COLLAPSED);
            return;
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
        this._easeSize(this._expandedWidth, this._expandedHeight, duration, () => {
            if (token !== this._token) return;
            this._setState(IslandState.EXPANDED);
            this.relayout();
            this.actor.grab_key_focus();
        });
        this._easeOpacity(this._pill, 0, duration);
        this._easeOpacity(this._card, 255, duration);
    }

    collapse() {
        if (this.state === IslandState.COLLAPSED || this.state === IslandState.COLLAPSING) return;
        const token = ++this._token;
        this._setState(IslandState.COLLAPSING);
        // Release input immediately so apps receive clicks during the close.
        this._releaseGrab();
        this._pill.reactive = true;
        this._pill.can_focus = true;
        const duration = this._animationMs();
        this._easeSize(this._collapsedWidth, this._collapsedHeight, duration, () => {
            if (token !== this._token) return;
            this._card.hide();
            this._setState(IslandState.COLLAPSED);
        });
        this._easeOpacity(this._pill, 255, duration);
        this._easeOpacity(this._card, 0, duration);
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
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const [x, y] = event.get_coords();
            const [left, top] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            if (!containsPoint(x, y, left, top, width, height)) {
                this.collapse();
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.collapse();
            return Clutter.EVENT_STOP;
        } else if (type === Clutter.EventType.KEY_PRESS &&
            (event.get_key_symbol() === Clutter.KEY_Tab || event.get_key_symbol() === Clutter.KEY_ISO_Left_Tab)) {
            const backward = Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
            this._card.navigate_focus(global.stage.key_focus,
                backward ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _easeSize(width, height, duration, onDone) {
        if (duration <= 0) {
            this.actor.set_size(width, height);
            onDone?.();
            return;
        }
        this.actor.ease({
            width,
            height,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: onDone,
        });
    }

    _easeOpacity(actor, value, duration) {
        if (duration <= 0) {
            actor.opacity = value;
            return;
        }
        actor.ease({opacity: value, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // Interrupted/suppressed transitions (settings change, fullscreen hide)
    // settle here so rapid toggling can never leave a half-sized surface.
    _snapCollapsed() {
        this._token++;
        this._releaseGrab();
        this.actor.remove_all_transitions();
        this._pill.remove_all_transitions();
        this._card.remove_all_transitions();
        this._pill.reactive = true;
        this._pill.can_focus = true;
        this._pill.opacity = 255;
        this._card.opacity = 0;
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
        if (!this._hoverEnabled || this._grabSuspended) return;
        if (!this.expanded) {
            // Pointer left the pill before the open delay elapsed: stand down.
            this._cancelHoverTimers();
            return;
        }
        if (this._hoverClose) return;
        this._hoverClose = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hoverCloseMs, () => {
            this._hoverClose = 0;
            if (this._hoverEnabled && this.expanded && !this._pointerInside()) this.collapse();
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
            monitor.y + (this.expanded ? 8 * this._scale : 0));
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
