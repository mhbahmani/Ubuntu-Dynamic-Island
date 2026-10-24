import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const IslandState = Object.freeze({
    COLLAPSED: 'collapsed',
    EXPANDING: 'expanding',
    EXPANDED: 'expanded',
    COLLAPSING: 'collapsing',
});

const COLLAPSED_HEIGHT = 32;
const HEIGHT_BUDGET = 0.8; // of the monitor height
const clampRange = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

// The island is a single chrome-managed St.Widget surface: the compact pill
// and the expanded card are two children of the same actor, morphed with
// width/height/opacity tweens instead of a separate popup menu. The surface
// itself is not reactive, so clicks outside the pill (and outside the open
// card) pass through to the applications underneath.
export class IslandSurface {
    constructor({settings, pill, card, onStateChange}) {
        this._settings = settings;
        this._onStateChange = onStateChange;
        this.state = IslandState.COLLAPSED;
        this._token = 0; // invalidates stale transition completions on interrupt
        this._stagePress = 0;
        this._stageKey = 0;
        this._hoverOpen = 0;
        this._hoverClose = 0;
        this._hoverEnabled = false;
        this._hoverOpenMs = 180;
        this._hoverCloseMs = 350;
        this._layoutSignal = 0;

        this.actor = new St.Widget({
            style_class: 'ubuntu-island-surface ubuntu-island-surface-collapsed',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            clip_to_allocation: true,
        });
        this._pill = pill;
        this._card = card;
        this._pill.x_align = Clutter.ActorAlign.CENTER;
        this._pill.y_align = Clutter.ActorAlign.START;
        this._card.hide();
        this.actor.add_child(this._pill);
        this.actor.add_child(this._card);

        this._connections = [];
        const track = (owner, signal, handler) =>
            this._connections.push([owner, owner.connect(signal, handler)]);
        track(this.actor, 'notify::width', () => this._recenter());
        track(this.actor, 'notify::visible', () => {
            // Chrome hides us over fullscreen windows; never reappear expanded.
            if (!this.actor.visible) this._snapCollapsed();
        });
        track(this._pill, 'enter-event', () => this._hoverEnterPill());
        for (const part of [this._pill, this._card]) {
            track(part, 'enter-event', () => this._hoverEnter());
            track(part, 'leave-event', () => this._hoverLeave());
        }

        this.applyDimensions();
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
            this._recenter();
            this._clampHeight();
        });
        this._recenter();
    }

    destroy() {
        this._cancelHoverTimers();
        this._syncStageHandlers(false);
        if (this._layoutSignal) Main.layoutManager.disconnect(this._layoutSignal);
        this._layoutSignal = 0;
        for (const [owner, id] of this._connections) owner.disconnect(id);
        this._connections = [];
        if (this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }

    applyDimensions() {
        this._collapsedWidth = clampRange(this._settings.get_int('pill-width'), 150, 210);
        this._expandedWidth = clampRange(this._settings.get_int('expanded-width'), 380, 480);
        if (!this.expanded) {
            this._token++;
            this.actor.set_size(this._collapsedWidth, COLLAPSED_HEIGHT);
            this._recenter();
        }
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
        this._card.show();
        const [, natural] = this._card.get_preferred_height(this._expandedWidth);
        this._expandedHeight = Math.max(COLLAPSED_HEIGHT, Math.min(natural, this._heightBudget()));
        const duration = this._animationMs();
        this._easeSize(this._expandedWidth, this._expandedHeight, duration, () => {
            if (token !== this._token) return;
            this._setState(IslandState.EXPANDED);
        });
        this._easeOpacity(this._pill, 0, duration);
        this._easeOpacity(this._card, 255, duration);
    }

    collapse() {
        if (this.state === IslandState.COLLAPSED || this.state === IslandState.COLLAPSING) return;
        const token = ++this._token;
        this._setState(IslandState.COLLAPSING);
        const duration = this._animationMs();
        this._easeSize(this._collapsedWidth, COLLAPSED_HEIGHT, duration, () => {
            if (token !== this._token) return;
            this._card.hide();
            this._setState(IslandState.COLLAPSED);
        });
        this._easeOpacity(this._pill, 255, duration);
        this._easeOpacity(this._card, 0, duration);
    }

    _setState(state) {
        this.state = state;
        const open = this.expanded;
        this.actor.set_style_class_name(open
            ? 'ubuntu-island-surface ubuntu-island-surface-open'
            : 'ubuntu-island-surface ubuntu-island-surface-collapsed');
        this._syncStageHandlers(open);
        this._onStateChange?.(state);
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
        this.actor.remove_all_transitions();
        this._pill.opacity = 255;
        this._card.opacity = 0;
        this._card.hide();
        this.actor.set_size(this._collapsedWidth, COLLAPSED_HEIGHT);
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

    // Outside clicks and Escape only while open. Outside clicks still
    // propagate so applications underneath keep receiving them.
    _syncStageHandlers(active) {
        if (active && !this._stagePress) {
            this._stagePress = global.stage.connect('button-press-event', (stage, event) => {
                const source = event.get_source();
                if (source && this.actor.contains(source)) return Clutter.EVENT_PROPAGATE;
                this.collapse();
                return Clutter.EVENT_PROPAGATE;
            });
            this._stageKey = global.stage.connect('key-press-event', (stage, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this.collapse();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        } else if (!active && this._stagePress) {
            global.stage.disconnect(this._stagePress);
            this._stagePress = 0;
            global.stage.disconnect(this._stageKey);
            this._stageKey = 0;
        }
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
        if (!this._hoverEnabled) return;
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
        const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        return Boolean(picked && (this.actor.contains(picked) || picked === this.actor));
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
