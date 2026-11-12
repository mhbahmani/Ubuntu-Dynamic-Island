import assert from 'node:assert/strict';
import test from 'node:test';
import {hashUri, formatTime, clampFraction, estimatePositionSec, compactRate} from '../services/format.js';

test('compact binary rates stay within four characters across rounding boundaries', () => {
    for (const [bytes, expected] of [
        [0, '0B'], [512, '512B'], [999.4, '999B'], [999.6, '1.0K'],
        [9.5 * 1024, '9.5K'], [12 * 1024, '12K'],
        [999.4 * 1024, '999K'], [999.6 * 1024, '1.0M'],
        [1000.3 * 1024, '1.0M'], [1023.9 * 1024, '1.0M'],
        [1024 ** 2, '1.0M'], [9.9 * 1024 ** 2, '9.9M'],
        [9.94 * 1024 ** 2, '9.9M'], [9.95 * 1024 ** 2, '10M'],
        [120 * 1024 ** 2, '120M'], [1024 ** 3, '1.0G'],
        [999.4 * 1024 ** 3, '999G'], [1000 * 1024 ** 3, '999G'],
        [Number.MAX_VALUE, '999G'],
    ]) {
        assert.equal(compactRate(bytes), expected, String(bytes));
        assert(compactRate(bytes).length <= 4);
    }
    for (const value of [-1, NaN, Infinity, -Infinity, null, undefined, '1024'])
        assert.equal(compactRate(value), '—');
});

test('compact rates respect the same boundaries for every binary unit', () => {
    for (let unit = 1; unit <= 3; unit++) {
        const suffix = 'BKMG'[unit];
        for (const [rate, expected] of [[9.94, '9.9'], [9.95, '10'], [10, '10'], [99.95, '100'], [999.4, '999']])
            assert.equal(compactRate(rate * 1024 ** unit), expected + suffix);
    }
});

test('hashUri is deterministic and filename-safe', () => {
    assert.match(hashUri('https://example.com/a.png'), /^[0-9a-f]{8}$/);
    assert.equal(hashUri('https://example.com/a.png'), hashUri('https://example.com/a.png'));
    assert.notEqual(hashUri('https://example.com/a.png'), hashUri('https://example.com/b.png'));
});
test('formatTime', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(65), '1:05');
    assert.equal(formatTime(600), '10:00');
    assert.equal(formatTime(null), '–:––');
    assert.equal(formatTime(-5), '–:––');
});
test('clampFraction', () => {
    assert.equal(clampFraction(0.5), 0.5);
    assert.equal(clampFraction(1.4), 1);
    assert.equal(clampFraction(-1), 0);
    assert.equal(clampFraction(NaN), 0);
});
test('position estimate advances only while playing', () => {
    const base = 30e6; // 30s in microseconds
    assert.equal(estimatePositionSec(base, 10, 13, true), 33);
    assert.equal(estimatePositionSec(base, 10, 13, false), 30);
    assert.equal(estimatePositionSec(base, 10, 5, true), 30); // clock went backwards
    assert.equal(estimatePositionSec(null, 10, 13, true), null);
});
