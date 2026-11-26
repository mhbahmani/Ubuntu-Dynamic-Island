import test from 'node:test';
import assert from 'node:assert/strict';
import {glideCurve, itemFrame, notchExtent, notchSlots, SHRUNK_SCALE} from '../extension/services/notch-motion.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

test('glide curve starts and ends gently and is symmetric', () => {
    assert.equal(glideCurve(0), 0);
    assert.equal(glideCurve(1), 1);
    close(glideCurve(0.5), 0.5, 'midpoint');
    assert.ok(glideCurve(0.05) < 0.001, 'no sudden start');
    assert.ok(1 - glideCurve(0.95) < 0.001, 'no sudden stop');
    for (const t of [0.1, 0.3, 0.45]) close(glideCurve(t) + glideCurve(1 - t), 1, `symmetry at ${t}`);
});

test('entering items fade in late while their space opens with the surface', () => {
    const hidden = {presence: 0, opacity: 0, scale: SHRUNK_SCALE};
    const start = itemFrame(hidden, 1, 0);
    assert.deepEqual(start, hidden);
    const early = itemFrame(hidden, 1, 0.3);
    close(early.presence, glideCurve(0.3), 'presence follows the surface curve');
    assert.equal(early.opacity, 0, 'still clear while its neighbours make room');
    const late = itemFrame(hidden, 1, 0.8);
    assert.ok(late.opacity > 0.5 && late.opacity < 1);
    assert.ok(late.scale > SHRUNK_SCALE && late.scale < 1);
    assert.deepEqual(itemFrame(hidden, 1, 1), {presence: 1, opacity: 1, scale: 1});
    assert.deepEqual(itemFrame(hidden, 1, 2), {presence: 1, opacity: 1, scale: 1}, 'clamped');
});

test('leaving items fade out before the gap closes', () => {
    const shown = {presence: 1, opacity: 1, scale: 1};
    const mid = itemFrame(shown, 0, 0.45);
    assert.equal(mid.opacity, 0, 'gone by 45%');
    assert.ok(mid.presence > 0.5, 'the gap is still mostly open');
    assert.deepEqual(itemFrame(shown, 0, 1), {presence: 0, opacity: 0, scale: SHRUNK_SCALE});
});

test('a reversal continues from the current frame without a jump', () => {
    const shown = {presence: 1, opacity: 1, scale: 1};
    const leaving = itemFrame(shown, 0, 0.3);
    const returning = itemFrame(leaving, 1, 0);
    assert.deepEqual(returning, leaving);
    assert.deepEqual(itemFrame(leaving, 1, 1), shown);
    assert.equal(itemFrame(shown, 1, 0.1).opacity, 1, 'an opaque item stays opaque');
});

test('presence scales an item and its spacing in the row width', () => {
    const row = presence => [{width: 20, presence: 1}, {width: 100, presence}, {width: 40, presence: 1}];
    assert.equal(notchExtent(row(1), 12), 184);
    assert.equal(notchExtent(row(0), 12), 60, 'a hidden middle item takes no space or gap');
    assert.equal(notchExtent(row(0.5), 12), 122, 'linear in presence');
    assert.equal(notchExtent([{width: 30, presence: 0.5}, {width: 40, presence: 1}], 12), 61, 'edge item gap');
    assert.equal(notchExtent([], 12), 0);
});

test('slots keep natural widths, share spare width by presence and centre overflow', () => {
    const row = [{width: 20, presence: 1}, {width: 40, presence: 1}];
    assert.deepEqual(notchSlots(row, 72, 12), [0, 32], 'packed when exact');
    assert.deepEqual(notchSlots(row, 92, 12), [5, 47], 'spare width shared evenly');
    assert.deepEqual(notchSlots(row, 52, 12), [-10, 22], 'overflow stays centred');
    assert.deepEqual(notchSlots(row, 72, 12, true), [52, 0], 'mirrored for right-to-left');
    const entering = [{width: 20, presence: 1}, {width: 100, presence: 0}, {width: 40, presence: 1}];
    const [left, middle, right] = notchSlots(entering, 60, 12);
    assert.deepEqual([left, right], [0, 20], 'an item at zero presence takes no space or spacing');
    assert.equal(middle, -30, 'it stays centred between its neighbours');
});
