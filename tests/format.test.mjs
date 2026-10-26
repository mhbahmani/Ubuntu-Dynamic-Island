import assert from 'node:assert/strict';
import test from 'node:test';
import {hashUri, formatTime, clampFraction, estimatePositionSec} from '../services/format.js';

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
