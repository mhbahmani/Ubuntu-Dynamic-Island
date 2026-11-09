import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as proc from '../services/proc.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
    const files = {
        '/proc/stat': 'cpu 100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3 4',
        '/proc/meminfo': 'MemTotal: 1000 kB\nMemAvailable: 400 kB',
        '/proc/net/route': 'Iface Destination Gateway Flags\neth0 00000000 0102A8C0 0003',
        '/proc/net/dev': 'header\nheader\neth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0',
        '/proc/loadavg': '0.25 0.5 0.5 1/20 100',
        '/proc/net/ipv6_route': '',
    };
    const timers = new Map(), events = [], held = [];
    const failures = new Set(), stalls = new Set();
    let id = 0, now = 1;
    const timer = (type, callback) => { timers.set(++id, {type, callback}); return id; };
    const source = readFileSync(new URL('../services/system.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Monitor = vm.runInNewContext(`${source}\nSystemMonitor`, {...proc, TextDecoder, console,
        Gio: {
            Cancellable: class {
                callbacks = [];
                cancel() { this.cancelled = true; for (const callback of this.callbacks) callback(); }
            },
            File: {new_for_path: path => ({load_contents_async(cancel, callback) {
                const contents = files[path];
                let finished = false;
                const finish = () => {
                    if (finished) return;
                    finished = true;
                    callback({load_contents_finish() {
                        if (cancel.cancelled || failures.has(path)) throw Error('read failed');
                        return [true, new TextEncoder().encode(contents)];
                    }}, {});
                };
                cancel.callbacks.push(() => queueMicrotask(finish));
                if (stalls.has(path)) held.push(finish);
                else queueMicrotask(finish);
            }})},
        },
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
            get_monotonic_time: () => now * 1e6,
            timeout_add_seconds: (_priority, _seconds, callback) => timer('sample', callback),
            timeout_add: (_priority, _ms, callback) => timer('deadline', callback),
            Source: {remove: id => timers.delete(id)},
        },
    });
    const monitor = new Monitor(state => events.push(state), 1);
    return {monitor, files, events, timers, failures, stalls, held,
        advance: () => { now++; },
        expire: () => { for (const [id, t] of timers) if (t.type === 'deadline') { timers.delete(id); t.callback(); } },
    };
}

test('monitor keeps sampling CPU, memory and network after startup without duplicate timers', async () => {
    const h = harness();
    h.monitor.start(); h.monitor.start(); await flush();
    assert.equal(h.events[0].cpu, null);
    h.files['/proc/stat'] = 'cpu 120 0 120 860 0 0 0 0 0 0';
    h.files['/proc/net/dev'] = 'header\nheader\neth0: 1100 0 0 0 0 0 0 0 700 0 0 0 0 0 0 0';
    h.advance();
    [...h.timers.values()][0].callback(); await flush();
    assert.equal(Math.round(h.events[1].cpu), 40);
    assert.equal(h.events[1].memory, 60);
    assert.equal(h.events[1].rxBytes, 1000);
    assert.equal(h.events[1].txBytes, 500);
    assert.equal(h.timers.size, 1);
    h.monitor.stop(); assert.equal(h.timers.size, 0);
});

test('a failed network read does not erase CPU, RAM or load data', async () => {
    const h = harness(); h.failures.add('/proc/net/route');
    h.monitor.start(); await flush();
    h.files['/proc/stat'] = 'cpu 120 0 120 860 0 0 0 0 0 0';
    h.advance(); await h.monitor._tick();
    assert.equal(Math.round(h.events.at(-1).cpu), 40);
    assert.equal(h.events.at(-1).memory, 60);
    assert.equal(h.events.at(-1).loadAvg, 0.25);
    h.monitor.stop();
});

test('a stalled read times out, publishes other metrics and can recover next tick', async () => {
    const h = harness(); h.stalls.add('/proc/meminfo');
    h.monitor.start(); await flush(); h.expire(); await flush();
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0].memory, null);
    assert.equal(h.events[0].iface, 'eth0');
    h.stalls.clear(); h.advance(); await h.monitor._tick();
    assert.equal(h.events.at(-1).memory, 60);
    h.monitor.stop();
});

test('stop and immediate restart discard late samples from the previous run', async () => {
    const h = harness(); h.stalls.add('/proc/stat');
    h.monitor.start(); h.monitor.stop(); h.stalls.clear();
    h.monitor.start(); await flush();
    for (const finish of h.held) finish();
    await flush();
    assert.equal(h.events.length, 1);
    assert.equal(h.timers.size, 1);
    h.monitor.stop();
});
