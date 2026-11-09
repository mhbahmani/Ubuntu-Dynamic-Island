import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCpu, cpuPercent, memoryPercent, memoryUsage, parseLoadAvg, countCores, defaultInterface, networkBytes, formatRate, formatCapacity} from '../services/proc.js';

test('CPU counter delta, not cumulative percentage', () => {
    const first = parseCpu('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3');
    const last = parseCpu('cpu  120 0 120 860 0 0 0 0 0 0\n');
    assert.equal(Math.round(cpuPercent(first, last)), 40);
    assert.equal(cpuPercent(null, first), null);
});
test('guest CPU time is already counted and invalid samples are rejected', () => {
    assert.deepEqual(parseCpu('cpu 100 20 30 400 50 6 7 8 80 10'), {idle: 450, total: 621});
    assert.throws(() => parseCpu('cpu 1 2 broken 4'));
});
test('IPv6 defaults work without an IPv4 route and reject defaults are ignored', () => {
    const zeros = '0'.repeat(32);
    const route = (iface, metric, flags = '00000003') => `${zeros} 00 ${zeros} 00 ${zeros} ${metric} 0 0 ${flags} ${iface}`;
    const routes = [route('lo', '00000000', '00200200'), route('wlan0', '00000400'),
        route('eth0', '00000100'), route('down', '00000000', '00000002')].join('\n');
    assert.equal(defaultInterface('', routes), 'eth0');
    assert.equal(defaultInterface('', route('lo', '00000000', '00200200')), null);
});
test('MemAvailable is used rather than MemFree', () => {
    assert.equal(memoryPercent('MemTotal: 1000 kB\nMemAvailable: 375 kB\n'), 62.5);
});
test('memoryUsage reports used bytes beside the percentage', () => {
    const usage = memoryUsage('MemTotal: 1000 kB\nMemAvailable: 375 kB\n');
    assert.equal(usage.usedBytes, 625 * 1024);
    assert.equal(usage.percent, 62.5);
    assert.equal(memoryUsage('MemTotal: 1000 kB\n'), null);
});
test('parseLoadAvg takes the 1-minute average', () => {
    assert.equal(parseLoadAvg('0.84 0.90 1.05 2/1381 12345'), 0.84);
    assert.equal(parseLoadAvg('  2.00 2.00 2.00 1/1 5'), 2);
    assert.equal(parseLoadAvg('garbage'), null);
});
test('countCores counts per-core rows only', () => {
    assert.equal(countCores('cpu  1 2 3\ncpu0 1 2 3\ncpu1 1 2 3\n'), 2);
    assert.equal(countCores('cpu  1 2 3\nintr 1\n'), 0);
});
test('formatCapacity tiers', () => {
    assert.equal(formatCapacity(625 * 1024), '625 kB');
    assert.equal(formatCapacity(300 * 1024 * 1024), '300 MB');
    assert.equal(formatCapacity(5.5 * 1024 ** 3), '5.5 GB');
    assert.equal(formatCapacity(-1), '—');
});
test('Default route determines interface', () => {
    assert.equal(defaultInterface('Iface Destination Gateway Flags\neth0 00000000 0102A8C0 0003\n'), 'eth0');
    const net = 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\neth0: 12345 1 0 0 0 0 0 0 56789 1 0 0 0 0 0 0';
    assert.deepEqual(networkBytes(net, 'eth0'), {rx: 12345, tx: 56789});
    assert.equal(networkBytes(net, 'wlan0'), null);
});
test('Lowest-metric default route wins, so VPN tunnels outrank the link', () => {
    const routes = [
        'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT',
        'eth0  00000000 0102A8C0 0003 0 0  600 00000000 0 0 0',
        'tun0  00000000 00000000 0003 0 0    0 00000000 0 0 0',
        'wlan0 00000000 0102A8C0 0003 0 0  900 00000000 0 0 0',
    ].join('\n');
    assert.equal(defaultInterface(routes), 'tun0');
});
test('Down and non-default routes are ignored', () => {
    const routes = [
        'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT',
        'eth0  00000000 0102A8C0 0002 0 0  600 00000000 0 0 0',
        'wlan0 0102A8C0 00000000 0003 0 0  600 00000000 0 0 0',
    ].join('\n');
    assert.equal(defaultInterface(routes), null);
});
test('Rate units', () => {
    assert.equal(formatRate(2048), '2.0 KiB/s');
    assert.equal(formatRate(3 * 1024 * 1024), '3.0 MiB/s');
    assert.equal(formatRate(1.5 * 1024 * 1024 * 1024), '1.5 GiB/s');
    assert.equal(formatRate(-1), '—');
});
