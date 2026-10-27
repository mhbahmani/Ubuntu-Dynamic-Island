import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

class Signals {
    handlers = new Map();
    next = 0;
    connect(name, callback) { const id = ++this.next; this.handlers.set(id, [name, callback]); return id; }
    disconnect(id) { this.handlers.delete(id); }
    emit(name) { for (const [id, [signal, callback]] of [...this.handlers])
        if (signal === name && this.handlers.has(id)) callback(this); }
}
function harness(windows = []) {
    const display = new Signals();
    const timers = new Map();
    let next = 0;
    const source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
    const Extension = vm.runInNewContext(`${source}\nUbuntuIsland`, {
        Extension: class {}, console,
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            timeout_add_seconds(priority, time, callback) { timers.set(++next, callback); return next; },
            Source: {remove: id => timers.delete(id)}},
        global: {display, get_window_actors: () => windows.map(meta_window => ({meta_window})),
            get_current_time: () => 1},
    });
    const extension = new Extension();
    extension.metadata = {name: 'Ubuntu Island'};
    extension._enabled = true;
    extension._island = {suspended: false, suspendGrab() { this.suspended = true; }, resumeGrab() { this.suspended = false; }};
    extension.openPreferences = () => {};
    return {extension, timers, display};
}
function window(title) {
    return Object.assign(new Signals(), {title, activated: 0,
        get_title() { return this.title; }, activate() { this.activated++; }});
}

test('live preview tracks delayed titles, reuses its window and cleans up on close', () => {
    const prefs = window(null);
    const unrelated = window('Settings');
    const {extension, timers, display} = harness([prefs, unrelated]);
    extension._openPreferencesLive();
    assert(extension._island.suspended);
    assert.equal(extension._prefsWindow, undefined);
    prefs.title = 'Ubuntu Island';
    prefs.emit('notify::title');
    assert.equal(extension._prefsWindow, prefs);
    assert.equal(timers.size, 0);
    extension._openPreferencesLive();
    assert.equal(prefs.activated, 1);
    assert.equal(extension._prefsWindow, prefs);
    prefs.emit('unmanaged');
    assert.equal(extension._island.suspended, false);
    assert.equal(display.handlers.size, 0);
    assert.equal(prefs.handlers.size, 0);
    assert.equal(unrelated.handlers.size, 0);
});

test('failed or timed-out preferences launch restores normal interaction', async () => {
    const {extension, timers, display} = harness();
    extension.openPreferences = () => Promise.reject(new Error('fixture launch failure'));
    extension._openPreferencesLive();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(extension._island.suspended, false);
    assert.equal(timers.size, 0);
    assert.equal(display.handlers.size, 0);
    extension.openPreferences = () => {};
    extension._openPreferencesLive();
    const [id, callback] = [...timers][0];
    timers.delete(id);
    callback();
    assert.equal(extension._island.suspended, false);
    assert.equal(display.handlers.size, 0);
});
