import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {containsPoint} from '../services/presentation.js';

const ANIMATED = ['width', 'height', 'translation_y', 'scale_x', 'scale_y', 'opacity', 'x', 'y'];

function harness(animation = 220, backdrop = null, panel = null) {
    class Actor {
        constructor(props = {}) {
            Object.assign(this, {visible: true, opacity: 255, width: 170, height: 34,
                scale_x: 1, scale_y: 1, translation_y: 0}, props);
        }
        connect() { return 1; }
        disconnect() {}
        add_child() {}
        add_constraint() {}
        add_constraint_with_name(name, constraint) { (this.constraints ??= {})[name] = constraint; }
        ease_property(name, value, options) { (this.properties ??= {})[name] = {value, ...options}; }
        set_pivot_point(x, y) { this.pivot = [x, y]; }
        hide() { this.visible = false; }
        show() { this.visible = true; }
        set_size(width, height) { Object.assign(this, {width, height}); }
        set_position(x, y) { Object.assign(this, {x, y}); }
        get_preferred_height() { return [34, 620]; }
        set_style_class_name(value) { this.style_class = value; }
        set_style(value) { this.style = value; }
        ease(options) { this.transition = {...this.transition, ...options}; }
        remove_all_transitions() { this.transition = null; }
        remove_transition(name) {
            if (!this.transition) return;
            delete this.transition[name.replace('-', '_')];
            if (!ANIMATED.some(key => this.transition[key] != null)) this.transition = null;
        }
        get_transition(name) {
            return this.transition?.[name] == null ? null
                : {get_duration: () => this.transition.duration, get_elapsed_time: () => this.elapsed ?? 0};
        }
        navigate_focus(_from, direction) { this.focusDirection = direction; }
        grab_key_focus() { this.focused = true; }
        get_transformed_position() { return [this.x ?? 0, this.y ?? 0]; }
        get_transformed_size() { return [this.width, this.height]; }
        finish() {
            const options = this.transition;
            this.transition = null;
            if (!options) return;
            for (const key of ANIMATED)
                if (options[key] != null) this[key] = options[key];
            options.onComplete?.();
        }
    }
    const idle = new Map();
    let nextIdle = 0;
    const flushIdle = () => { for (const [id, callback] of idle) { idle.delete(id); callback(); } };
    const addSource = (...args) => { idle.set(++nextIdle, args[args.length - 1]); return nextIdle; };
    const modal = new Set();
    const Main = {
        layoutManager: {primaryMonitor: {x: -1280, y: 0, width: 1280, height: 900}},
        panel,
        sessionMode: {connect: () => 1},
        pushModal: () => { const grab = {}; modal.add(grab); return grab; },
        popModal: grab => { assert.equal(modal.delete(grab), true); },
    };
    const source = readFileSync(new URL('../ui/island.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    const Surface = vm.runInNewContext(`${source}\nIslandSurface`, {
        St: {Widget: Actor, BoxLayout: Actor, Settings: {get: () => ({enable_animations: true})}, DirectionType: {TAB_FORWARD: 1, TAB_BACKWARD: -1}},
        Clutter: {Actor, BinLayout: class {}, FixedLayout: class {}, AlignConstraint: class {},
            BindConstraint: class { constructor(props) { Object.assign(this, props); } }, BindCoordinate: {HEIGHT: 3}, AlignAxis: {}, ActorAlign: {}, AnimationMode: {EASE_OUT_QUAD: 0, EASE_OUT_QUART: 1, EASE_OUT_CUBIC: 2, EASE_IN_OUT_CUBIC: 3, EASE_IN_OUT_QUAD: 4},
            EventType: {BUTTON_PRESS: 1, TOUCH_BEGIN: 2, KEY_PRESS: 3, BUTTON_RELEASE: 4,
                TOUCH_END: 5, TOUCH_CANCEL: 6}, KEY_Escape: 27, KEY_Tab: 9, KEY_ISO_Left_Tab: 65056,
            ModifierType: {SHIFT_MASK: 1, CONTROL_MASK: 4},
            EVENT_STOP: true, EVENT_PROPAGATE: false},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            idle_add: addSource, timeout_add: addSource,
            Source: {remove: id => idle.delete(id)}},
        Shell: {ActionMode: {POPUP: 1}}, Main, containsPoint, console, global: {stage: {key_focus: null}},
    });
    const settings = {get_int: name => ({'pill-width': 170, 'expanded-width': 440, 'animation-duration': animation})[name],
        get_boolean: () => false};
    const pill = new Actor();
    const card = new Actor();
    const surface = new Surface({settings, pill, card, backdrop});
    return {surface, modal, pill, card, flushIdle};
}

test('thirty interrupted toggles settle collapsed and release every modal grab', () => {
    const {surface, modal, card} = harness();
    for (let i = 0; i < 30; i++) surface.toggle();
    surface.actor.finish();
    assert.equal(surface.state, 'collapsed');
    assert.equal(surface.actor.width, 170);
    assert.equal(card.visible, false);
    assert.equal(modal.size, 0);
});

test('backward Tab works with Shift or ISO_Left_Tab, including consumed Shift modifiers', () => {
    const {surface, card} = harness(0);
    surface.expand();
    const directions = [];
    surface._onSwitchTab = direction => directions.push(direction);
    for (const [symbol, modifiers, expected] of [[9, 4, 1], [9, 5, -1], [65056, 4, -1], [65056, 5, -1]]) {
        assert.equal(surface._onCapturedEvent(surface.actor, {
            type: () => 3, get_key_symbol: () => symbol, get_state: () => modifiers,
        }), true);
        assert.equal(directions.at(-1), expected);
    }
    surface._onCapturedEvent(surface.actor, {type: () => 3, get_key_symbol: () => 65056, get_state: () => 0});
    assert.equal(card.focusDirection, -1);
});

test('offline edge hides through expansion and collapse transitions, and clears on reconnect', () => {
    const {surface} = harness();
    surface.setConnectionEdge(true);
    assert.equal(surface._connectionEdge.visible, true);
    surface.expand();
    assert.equal(surface._connectionEdge.visible, false);
    surface.actor.finish();
    surface.setConnectionEdge(true);
    assert.equal(surface._connectionEdge.visible, false, 'Preference changes must not expose the edge while expanded');
    surface.collapse();
    assert.equal(surface._connectionEdge.visible, false);
    surface.actor.finish();
    assert.equal(surface._connectionEdge.visible, true);
    surface.expand();
    surface.setConnectionEdge(false);
    surface._snapCollapsed();
    assert.equal(surface._connectionEdge.visible, false);
});

test('dimension changes during collapse retarget the close instead of snapping it', () => {
    const {surface, pill, card, modal} = harness();
    surface.expand(); surface.actor.finish();
    surface.collapse();
    assert.equal(surface.actor.transition.duration, 165);
    surface.actor.elapsed = 65;
    surface._settings.get_int = name => ({'pill-width': 200, 'expanded-width': 440, 'animation-duration': 220})[name];
    surface.applyDimensions();
    assert.equal(surface.state, 'collapsing');
    assert.equal(surface.actor.transition.width, 200);
    assert.equal(surface.actor.transition.duration, 100, 'Retargeting keeps the remaining close time');
    assert.equal(pill.width, 198);
    assert.notEqual(card.transition, null, 'Content fades continue');
    assert.equal(modal.size, 0);
    surface.actor.finish();
    assert.equal(surface.state, 'collapsed');
    assert.equal(surface.actor.width, 200);
    assert.equal(pill.opacity, 255);
    assert.equal(card.visible, false);
});

test('notch re-render at the start of a close updates its target without snapping', () => {
    const {surface, pill} = harness();
    surface.expand(); surface.actor.finish();
    // The extension re-renders the notch from the state callback; restored
    // items widen it before collapse() starts resizing.
    surface._onStateChange = state => {
        if (state !== 'collapsing') return;
        surface._settings.get_int = name => ({'pill-width': 190, 'expanded-width': 440, 'animation-duration': 220})[name];
        surface.applyDimensions();
    };
    surface.collapse();
    assert.equal(surface.state, 'collapsing');
    assert.equal(surface.actor.transition.width, 190);
    assert.equal(surface.actor.transition.duration, 165);
    assert.equal(pill.width, 188);
    assert.match(surface.actor.style_class, /surface-open/, 'Rounded corners stay until the close docks');
    surface.actor.finish();
    assert.equal(surface.state, 'collapsed');
    assert.match(surface.actor.style_class, /surface-collapsed/);
});

test('closing fades the card out before the notch fades back in', () => {
    const {surface, pill, card} = harness();
    surface.expand(); surface.actor.finish();
    surface.collapse();
    assert(card.transition.duration < surface.actor.transition.duration, 'Card clears before the notch docks');
    assert.equal(pill.transition.mode, 3, 'Notch fades in slowly while the card clears');
    assert.equal(pill.transition.delay, undefined, 'Timeline delays run off the frame clock');
});

test('outside click dismisses even when event source is retargeted by the grab', () => {
    const {surface, modal, flushIdle} = harness(0);
    surface.expand();
    assert.equal(surface.state, 'expanded');
    const stopped = surface._onCapturedEvent(surface.actor, {
        type: () => 1, get_coords: () => [10, 850],
        get_source: () => surface.actor,
    });
    assert.equal(stopped, true);
    assert.equal(modal.size, 1, 'Do not change grabs during press dispatch');
    flushIdle();
    assert.equal(surface.state, 'collapsed');
    assert.equal(modal.size, 0);
});
test('escape dismisses through an idle, never synchronously during key dispatch', () => {
    const {surface, modal, flushIdle} = harness(0);
    surface.expand();
    const stopped = surface._onCapturedEvent(surface.actor, {
        type: () => 3, get_key_symbol: () => 27,
    });
    assert.equal(stopped, true);
    assert.equal(modal.size, 1, 'Do not change grabs during key dispatch');
    flushIdle();
    assert.equal(surface.state, 'collapsed');
    assert.equal(modal.size, 0);
});
test('outside press holds the grab until its release has dispatched', () => {
    const {surface, modal, flushIdle} = harness(0);
    surface.expand();
    surface._onCapturedEvent(surface.actor, {type: () => 1, get_coords: () => [10, 850]});
    assert.equal(surface._dismissArmed, true);
    assert.equal(modal.size, 1, 'Guard must keep the modal through the pending press');
    const propagated = surface._onCapturedEvent(surface.actor, {type: () => 4, get_coords: () => [10, 850]});
    assert.equal(propagated, false);
    assert.equal(surface._dismissArmed, false, 'Release ends the guard');
    assert.equal(surface.state, 'expanded', 'Collapse waits until the release leaves dispatch');
    assert.equal(modal.size, 1);
    flushIdle();
    assert.equal(surface.state, 'collapsed');
    assert.equal(modal.size, 0);
});
test('dismissal guard falls back to the cap when no release ever arrives', () => {
    const {surface, modal, flushIdle} = harness(0);
    surface.expand();
    surface._onCapturedEvent(surface.actor, {type: () => 1, get_coords: () => [10, 850]});
    flushIdle();
    assert.equal(surface.state, 'collapsed');
    assert.equal(modal.size, 0);
});
test('suspended dismissal leaves the island open and clears the guard', () => {
    const {surface, modal, flushIdle} = harness(0);
    surface.expand();
    surface.suspendGrab();
    surface._onCapturedEvent(surface.actor, {type: () => 1, get_coords: () => [10, 850]});
    flushIdle();
    assert.equal(surface.expanded, true);
    assert.equal(surface._dismissArmed, false);
    surface.resumeGrab();
    assert.equal(modal.size, 1);
    surface.collapse();
    assert.equal(modal.size, 0);
});

test('fullscreen snap cancels transitions; stale completion cannot reopen the card', () => {
    const {surface, modal, card} = harness();
    surface.expand();
    const stale = surface.actor.transition.onComplete;
    surface._snapCollapsed();
    stale();
    assert.equal(surface.state, 'collapsed');
    assert.equal(card.visible, false);
    assert.equal(modal.size, 0);
});

test('preferences preview stays open without a grab and restores dismissal', () => {
    const {surface, modal} = harness(0);
    surface.expand();
    surface.suspendGrab();
    assert.equal(surface.expanded, true);
    assert.equal(modal.size, 0);
    surface.applyDimensions();
    assert.equal(surface.expanded, true);
    surface.collapse();
    surface.expand();
    assert.equal(modal.size, 0, 'Reopening during preview must not block preferences');
    surface.resumeGrab();
    assert.equal(modal.size, 1);
    surface.collapse();
    assert.equal(modal.size, 0);
});

test('opening focuses the surface instead of giving the first tab a focus ring', () => {
    const {surface} = harness(0);
    surface.expand();
    assert.equal(surface.actor.focused, true);
});

test('turning off motion during opening settles every transform and cancels pending motion', () => {
    const {surface, pill, card, modal} = harness();
    surface.expand();
    surface.actor.translation_y = 3;
    pill.scale_x = pill.scale_y = 0.94;
    card.translation_y = -2;
    surface._settings.get_boolean = () => true;
    surface.collapse();
    assert.equal(surface.state, 'collapsed');
    assert.equal(surface.actor.translation_y, 0);
    assert.equal(surface.actor.width, 170);
    for (const actor of [surface.actor, pill, card]) assert.equal(actor.transition, null);
    for (const actor of [pill, card]) {
        assert.equal(actor.scale_x, 1);
        assert.equal(actor.scale_y, 1);
        assert.equal(actor.translation_y, 0);
    }
    assert.equal(pill.opacity, 255);
    assert.equal(card.opacity, 0);
    assert.equal(card.visible, false);
    assert.equal(modal.size, 0);
});

test('reversing a close preserves the current content pose and ignores its old completion', () => {
    const {surface, pill, card} = harness();
    surface.expand(); surface.actor.finish();
    surface.collapse();
    const stale = surface.actor.transition.onComplete;
    surface.actor.set_size(350, 400);
    surface.actor.translation_y = 5;
    pill.scale_x = pill.scale_y = 0.96;
    card.scale_x = card.scale_y = 0.98;
    card.translation_y = -1;
    surface.expand();
    assert.equal(pill.scale_x, 0.96);
    assert.equal(card.scale_x, 0.98);
    assert.equal(card.translation_y, -1);
    stale();
    assert.equal(surface.state, 'expanding');
    assert.equal(card.visible, true);
    surface.actor.finish();
    assert.equal(surface.state, 'expanded');
});

test('backdrop blur runs only while the card is open and follows appearance', () => {
    const calls = [];
    const backdrop = {active: false, setRadiusSource: source => { backdrop.source = source; },
        setActive: active => { backdrop.active = active; calls.push(active); },
        configure: options => { backdrop.options = {...backdrop.options, ...options}; },
        queue_relayout() {}, invalidate: () => { backdrop.invalidations = (backdrop.invalidations ?? 0) + 1; },
        get blurRadius() { return 7; }};
    const {surface} = harness(220, backdrop);
    assert.equal(backdrop.source, surface.material);
    assert.equal(backdrop.active, false);
    surface.material.set_style = style => { surface.material.style = style; };
    surface.setAppearance('tint', 80, 60);
    assert.deepEqual(backdrop.options, {scale: 1, matte: 80, opacity: 60});
    assert.equal(surface.material.style, 'tint');
    assert.equal(surface.backdropRadius, 7);
    surface.expand();
    assert.equal(backdrop.active, true);
    surface.actor.finish();
    assert.equal(backdrop.active, true);
    surface.collapse();
    assert.equal(backdrop.active, true); // still visible while the card closes
    surface.actor.finish();
    assert.equal(backdrop.active, false);
    for (let i = 0; i < 10; i++) surface.toggle();
    surface._snapCollapsed();
    assert.equal(backdrop.active, false);
    surface._onCapturedEvent(surface.actor, {type: () => 0});
    assert(backdrop.invalidations >= 1);
});

test('the open shape tucks its rounded top under the edge while docked', () => {
    const {surface} = harness();
    const shape = surface._shape;
    const tuckTarget = () => shape.properties['@constraints.tuck.offset'];
    surface.expand();
    assert.match(surface.actor.style_class, /surface-open/);
    assert.equal(surface.tuck, 21, 'Opening starts with the rounded top hidden');
    assert.equal(shape.translation_y, -21);
    assert.equal(tuckTarget().value, 0, 'The descent reveals the rounded top');
    assert.equal(shape.transition.translation_y, 0);
    assert.equal(tuckTarget().duration, surface.actor.transition.duration);
    surface.actor.finish();
    surface._setTuck(0);
    surface.collapse();
    assert.equal(tuckTarget().value, 21, 'Closing tucks the rounded top as it docks');
    assert.equal(shape.transition.translation_y, -21);
    assert.equal(tuckTarget().duration, surface.actor.transition.duration);
    surface.actor.finish();
    assert.match(surface.actor.style_class, /surface-collapsed/);
    assert.equal(surface.tuck, 0, 'The docked square shape needs no tuck');
    assert.equal(shape.translation_y, 0);
    surface.expand(); surface._snapCollapsed();
    assert.equal(surface.tuck, 0);
});

test('a concealed notch rests above the edge and opening slides it down while the card grows', () => {
    const {surface} = harness();
    surface.setConcealed(true);
    assert.equal(surface.concealed, true);
    assert.equal(surface.actor.transition.y, -35, 'Collapsed height plus a pixel above the monitor');
    surface.actor.finish();
    assert.equal(surface.actor.y, -35);
    assert.equal(surface.actor.opacity, 0);
    surface.setConcealed(true);
    assert.equal(surface.actor.transition, null, 'Concealing twice does nothing');
    surface.expand();
    assert.equal(surface.concealed, false);
    assert.equal(surface.actor.opacity, 255);
    assert.equal(surface.actor.transition.y, 0, 'The reveal survives the size ease');
    assert.equal(surface.actor.transition.width, 440);
    surface.setConcealed(true);
    assert.equal(surface.concealed, false, 'An open island is never concealed');
    surface.actor.finish();
    assert.equal(surface.actor.y, 0);
});

test('an interrupted hide settles at the concealed position', () => {
    const {surface} = harness();
    surface.setConcealed(true);
    surface._snapCollapsed();
    assert.equal(surface.actor.transition, null);
    assert.equal(surface.actor.y, -35);
    assert.equal(surface.actor.opacity, 0);
    surface.setConcealed(false, false);
    assert.equal(surface.actor.y, 0);
    assert.equal(surface.actor.opacity, 255);
});

test('blend style takes the top bar color and height while collapsed and the theme while open', () => {
    const panel = {height: 32, connect: () => 1, disconnect() {},
        get_theme_node: () => ({get_background_color: () => ({red: 0, green: 0, blue: 0, alpha: 255})})};
    const {surface} = harness(220, null, panel);
    assert.equal(surface.actor.height, 34);
    surface.setPanelBlend(true);
    assert.equal(surface.actor.height, 32, 'Matches the top bar');
    assert.equal(surface._panelLayer.style, 'background-color: rgba(0,0,0,1);');
    assert.equal(surface._panelLayer.visible, true);
    assert.equal(surface._panelLayer.opacity, 255);
    assert.equal(surface._material.opacity, 0);
    surface.expand();
    assert.equal(surface._panelLayer.transition.opacity, 0);
    assert.equal(surface._material.transition.opacity, 255);
    assert(surface._panelLayer.transition.duration < surface.actor.transition.duration, 'Leaves the bar early');
    surface.actor.finish(); surface._panelLayer.finish(); surface._material.finish();
    surface.collapse();
    assert.equal(surface._panelLayer.transition.opacity, 255);
    assert.equal(surface._panelLayer.transition.duration, surface.actor.transition.duration, 'Settles into the bar as it docks');
    surface.actor.finish();
    assert.equal(surface._panelLayer.opacity, 255);
    assert.equal(surface._material.opacity, 0);
    surface.setPanelBlend(false);
    assert.equal(surface.actor.height, 34);
    assert.equal(surface._panelLayer.visible, false);
    assert.equal(surface._material.opacity, 255);
});
