import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCpu, cpuPercent, memoryPercent, defaultInterface, networkBytes, formatRate} from '../services/proc.js';

test('CPU counter delta, not cumulative percentage', () => {
    const first = parseCpu('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3');
    const last = parseCpu('cpu  120 0 120 860 0 0 0 0 0 0\n');
    assert.equal(Math.round(cpuPercent(first, last)), 40);
    assert.equal(cpuPercent(null, first), null);
});
test('MemAvailable is used rather than MemFree', () => {
    assert.equal(memoryPercent('MemTotal: 1000 kB\nMemAvailable: 375 kB\n'), 62.5);
});
test('Default route determines interface', () => {
    assert.equal(defaultInterface('Iface Destination Gateway Flags\neth0 00000000 0102A8C0 0003\n'), 'eth0');
    const net = 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\neth0: 12345 1 0 0 0 0 0 0 56789 1 0 0 0 0 0 0';
    assert.deepEqual(networkBytes(net, 'eth0'), {rx: 12345, tx: 56789});
    assert.equal(networkBytes(net, 'wlan0'), null);
});
test('Rate units', () => {
    assert.equal(formatRate(2048), '2.0 KiB/s');
    assert.equal(formatRate(-1), '—');
});
