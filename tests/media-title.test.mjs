import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {titleText, titleLimit} from '../services/notch-model.js';

function harness() {
    class Actor {
        constructor(options = {}) {
            Object.assign(this, {mapped: true, visible: true, translation_x: 0}, options);
            this.signals = new Map(); this.transitions = new Map();
            this.clutter_text = {get_preferred_width: () => [420, 420]};
        }
        connect(name, callback) { const id = this.signals.size + 1; this.signals.set(id, [name, callback]); return id; }
        disconnect(id) { this.signals.delete(id); }
        add_child() {}
        get_stage() { return {}; }
        get_preferred_height() { return [16, 16]; }
        add_transition(name, transition) { this.transitions.set(name, transition); }
        remove_transition(name) { this.transitions.delete(name); }
        ease() { assert.fail('Scrolling must not chain implicit animations during remapping'); }
    }
    class Transition {
        constructor(properties) { Object.assign(this, properties); }
        set_from(value) { this.from = value; }
        set_to(value) { this.to = value; }
        set_key_frames(values) { this.frames = values; }
        set_values(values) { this.values = values; }
        set_modes() {}
    }
    const settings = new Actor({enable_animations: true});
    const source = readFileSync(new URL('../ui/media-title.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Title = vm.runInNewContext(`${source}\nMediaTitle`, {
        St: {Widget: Actor, Label: Actor, Settings: {get: () => settings}, ThemeContext: {get_for_stage: () => ({scale_factor: 1})}},
        Clutter: {FixedLayout: class {}, ActorAlign: {}, AnimationMode: {LINEAR: 0}, KeyframeTransition: Transition,
            Interval: class { constructor(options) { Object.assign(this, options); } }},
        Pango: {EllipsizeMode: {NONE: 0, END: 1}},
        GObject: {TYPE_FLOAT: 1, Value: class { init() {} set_float(number) { this.value = number; } }},
        global: {stage: {}}, titleText, titleLimit,
    });
    return {title: new Title(), settings};
}

test('scrolling survives repeated remaps and releases its native transition on every stop', () => {
    const {title, settings} = harness();
    title.configure('A long title', 'scroll', 12, true, false, true);
    for (let i = 0; i < 20; i++) {
        const transition = title.label.transitions.get('island-title-scroll');
        assert.equal(transition.repeat_count, -1);
        assert.equal(transition.from, transition.to, 'Round trips must return to the original position');
        title.actor.mapped = false;
        title.sync();
        assert.equal(title.label.transitions.size, 0);
        assert.equal(title.animationKey, null);
        title.actor.mapped = true;
        title.sync();
        assert.equal(title.label.transitions.size, 1);
    }
    settings.enable_animations = false;
    title.sync();
    assert.equal(title.label.transitions.size, 0);
    assert.equal(title.label.translation_x, 0);
    settings.enable_animations = true;
    title.sync();
    title.expanded = true;
    title.sync();
    assert.equal(title.label.transitions.size, 0);
    title.expanded = false;
    title.sync();
    const destroy = [...title.actor.signals.values()].find(([name]) => name === 'destroy')[1];
    destroy();
    assert.equal(title.label.transitions.size, 0);
    assert.equal(settings.signals.size, 0);
    title.sync();
    assert.equal(title.label.transitions.size, 0, 'Destroyed titles must not restart scrolling');
});
