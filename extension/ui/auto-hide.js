import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {IslandState} from './island.js';

// Grace before a revealed notch hides again after the pointer leaves it.
export const HIDE_GRACE_MS = 700;
// Height of the reveal strip at the top edge while the notch is hidden.
const EDGE_HEIGHT = 8;
// A resting pointer may drift this far (logical px) and still count as resting.
const DWELL_TOLERANCE = 24;

// Auto-hide keeps the collapsed notch above the screen edge, separate from the
// top bar. One invisible zone, stacked just below the island, tracks the
// pointer without polling: a thin strip at the edge while hidden, and the
// notch's own footprint once revealed (the surface itself is not reactive
// while collapsed, so its margins would otherwise report nothing).
//
// The pointer must rest at the edge for the reveal delay; sweeping across it
// restarts the wait, so passing movements never change the state. Clicking
// the zone reveals and opens at once. Leaving a revealed notch hides it after
// HIDE_GRACE_MS. Opening the island always reveals it first.
export class NotchAutoHide {
    constructor(island) {
        this._island = island;
        this._enabled = false;
        this._revealMs = 350;
        this._zone = null;
        this._connections = [];
        this._dwell = 0;
        this._hide = 0;
        this._origin = null;
        this._holdUntil = 0;
    }

    get enabled() {
        return this._enabled;
    }

    configure(enabled, revealMs) {
        this._revealMs = Math.max(100, Math.min(1500, Number(revealMs) || 350));
        enabled = Boolean(enabled);
        if (enabled === this._enabled) return;
        this._enabled = enabled;
        if (enabled) this._start();
        else this._stop();
    }

    // Keep the notch revealed for a while, such as during a notification peek.
    hold(duration) {
        if (!this._enabled) return;
        this._holdUntil = Math.max(this._holdUntil, GLib.get_monotonic_time() / 1000 + duration);
        this._reveal();
    }

    // Island state or geometry changed.
    sync() {
        if (!this._enabled) return;
        const island = this._island;
        const collapsed = island.state === IslandState.COLLAPSED;
        this._zone.visible = collapsed && island.actor.visible;
        if (!collapsed) {
            this._cancelDwell();
            this._cancelHide();
            return;
        }
        this._placeZone();
        if (!island.concealed) this._scheduleHide();
    }

    destroy() {
        this._stop();
        this._island = null;
    }

    _start() {
        const island = this._island;
        this._zone = new St.Widget({name: 'ubuntu-island-reveal-zone', reactive: true, visible: false});
        Main.layoutManager.addChrome(this._zone, {trackFullscreen: true, affectsStruts: false});
        // Below the island, so the notch's content receives its own events.
        this._zone.get_parent()?.set_child_below_sibling(this._zone, island.actor);
        const track = (owner, signal, handler) => this._connections.push([owner, owner.connect(signal, handler)]);
        track(this._zone, 'enter-event', (_actor, event) => this._enterZone(event));
        track(this._zone, 'motion-event', (_actor, event) => this._moveInZone(event));
        track(this._zone, 'leave-event', () => this._leave());
        // Only a click that starts on the zone opens; a drag ending here does not.
        track(this._zone, 'button-press-event', () => { this._pressed = true; return Clutter.EVENT_STOP; });
        track(this._zone, 'button-release-event', () => this._click());
        track(island.pill, 'enter-event', () => this._cancelHide());
        track(island.pill, 'leave-event', () => this._leave());
        for (const property of ['notify::width', 'notify::height', 'notify::visible'])
            track(island.actor, property, () => this.sync());
        this.sync();
        if (!this._pointerOverNotch()) this._conceal();
    }

    _stop() {
        this._cancelDwell();
        this._cancelHide();
        for (const [owner, id] of this._connections) owner.disconnect(id);
        this._connections = [];
        if (this._zone) {
            Main.layoutManager.removeChrome(this._zone);
            this._zone.destroy();
        }
        this._zone = null;
        this._holdUntil = 0;
        this._island?.setConcealed(false, false);
    }

    _placeZone() {
        const island = this._island;
        const monitor = Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors[0];
        if (!monitor || !this._zone) return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.round(island.actor.width);
        const height = island.concealed ? EDGE_HEIGHT * scale : Math.round(island.collapsedHeight);
        this._zone.set_position(Math.round(monitor.x + (monitor.width - width) / 2), monitor.y);
        this._zone.set_size(width, height);
    }

    _enterZone(event) {
        this._cancelHide();
        if (this._island.concealed) this._startDwell(event.get_coords());
        return Clutter.EVENT_PROPAGATE;
    }

    _moveInZone(event) {
        if (!this._island.concealed) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Still sweeping: wait for the pointer to settle before revealing.
        if (!this._origin || Math.hypot(x - this._origin[0], y - this._origin[1]) > DWELL_TOLERANCE * scale)
            this._startDwell([x, y]);
        return Clutter.EVENT_PROPAGATE;
    }

    _leave() {
        this._pressed = false;
        this._cancelDwell();
        if (!this._island.concealed) this._scheduleHide();
        return Clutter.EVENT_PROPAGATE;
    }

    _click() {
        if (!this._pressed) return Clutter.EVENT_PROPAGATE;
        this._pressed = false;
        this._cancelDwell();
        this._reveal();
        this._island.toggle();
        return Clutter.EVENT_STOP;
    }

    _startDwell(origin) {
        this._cancelDwell();
        this._origin = origin;
        this._dwell = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._revealMs, () => {
            this._dwell = 0;
            this._origin = null;
            this._reveal();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelDwell() {
        if (this._dwell) GLib.Source.remove(this._dwell);
        this._dwell = 0;
        this._origin = null;
    }

    _reveal() {
        this._cancelDwell();
        this._island.setConcealed(false);
        this._placeZone();
        this._scheduleHide();
    }

    _conceal() {
        this._island.setConcealed(true);
        this._placeZone();
    }

    _scheduleHide() {
        if (this._hide || this._island.state !== IslandState.COLLAPSED) return;
        const held = Math.max(0, this._holdUntil - GLib.get_monotonic_time() / 1000);
        this._hide = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(Math.max(HIDE_GRACE_MS, held)), () => {
            this._hide = 0;
            const island = this._island;
            if (!this._enabled || island.state !== IslandState.COLLAPSED || island.concealed) return GLib.SOURCE_REMOVE;
            // A later hold, or the pointer coming back (its enter cancelled
            // this timer; a leave re-arms it), keeps the notch down.
            if (GLib.get_monotonic_time() / 1000 < this._holdUntil) this._scheduleHide();
            else if (!this._pointerOverNotch() && !island.pill.has_key_focus()) this._conceal();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHide() {
        if (this._hide) GLib.Source.remove(this._hide);
        this._hide = 0;
    }

    _pointerOverNotch() {
        const [x, y] = global.get_pointer();
        const actor = this._island.actor;
        const [left, top] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return x >= left && x < left + width && y >= top && y < top + height;
    }
}
