import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {containsPoint} from '../services/presentation.js';

function harness(animation = 220) {
    class Actor {
        constructor(props = {}) { Object.assign(this, {visible: true, opacity: 255, width: 170, height: 34}, props); }
        connect() { return 1; }
        disconnect() {}
        add_child() {}
        hide() { this.visible = false; }
        show() { this.visible = true; }
        set_size(width, height) { Object.assign(this, {width, height}); }
        set_position(x, y) { Object.assign(this, {x, y}); }
        get_preferred_height() { return [34, 620]; }
        set_style_class_name(value) { this.style_class = value; }
        ease(options) { this.transition = options; }
        remove_all_transitions() { this.transition = null; }
        navigate_focus() {}
        get_transformed_position() { return [this.x ?? 0, this.y ?? 0]; }
        get_transformed_size() { return [this.width, this.height]; }
        finish() {
            const options = this.transition;
            this.transition = null;
            if (!options) return;
            if (options.width != null) this.set_size(options.width, options.height);
            options.onComplete?.();
        }
    }
    const modal = new Set();
    const Main = {
        layoutManager: {primaryMonitor: {x: -1280, y: 0, width: 1280, height: 900}},
        sessionMode: {connect: () => 1},
        pushModal: () => { const grab = {}; modal.add(grab); return grab; },
        popModal: grab => { assert.equal(modal.delete(grab), true); },
    };
    const source = readFileSync(new URL('../island.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    const Surface = vm.runInNewContext(`${source}\nIslandSurface`, {
        St: {Widget: Actor, Settings: {get: () => ({enable_animations: true})}, DirectionType: {TAB_FORWARD: 1}},
        Clutter: {BinLayout: class {}, ActorAlign: {}, AnimationMode: {EASE_OUT_QUAD: 0},
            EventType: {BUTTON_PRESS: 1, TOUCH_BEGIN: 2, KEY_PRESS: 3}, KEY_Escape: 27,
            EVENT_STOP: true, EVENT_PROPAGATE: false},
        Shell: {ActionMode: {POPUP: 1}}, Main, containsPoint, console,
    });
    const settings = {get_int: name => ({'pill-width': 170, 'expanded-width': 440, 'animation-duration': animation})[name],
        get_boolean: () => false};
    const pill = new Actor();
    const card = new Actor();
    const surface = new Surface({settings, pill, card});
    return {surface, modal, pill, card};
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

test('settings during collapse cancel child fades and settle dimensions', () => {
    const {surface, pill, card, modal} = harness();
    surface.expand();
    surface.collapse();
    surface.applyDimensions();
    assert.equal(surface.state, 'collapsed');
    assert.equal(pill.transition, null);
    assert.equal(card.transition, null);
    assert.equal(pill.opacity, 255);
    assert.equal(card.opacity, 0);
    assert.equal(modal.size, 0);
});

test('outside click dismisses even when event source is retargeted by the grab', () => {
    const {surface, modal} = harness(0);
    surface.expand();
    assert.equal(surface.state, 'expanded');
    const stopped = surface._onCapturedEvent(surface.actor, {
        type: () => 1, get_coords: () => [10, 850],
        get_source: () => surface.actor,
    });
    assert.equal(stopped, true);
    assert.equal(surface.state, 'collapsed');
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
