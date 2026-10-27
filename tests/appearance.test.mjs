import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceStyle, THEMES} from '../services/appearance.js';

test('appearance clamps background opacity without fading content', () => {
    for (const theme of Object.keys(THEMES)) {
        assert(surfaceStyle(theme, 70).includes(',0.7)'));
        assert(surfaceStyle(theme, 100).includes(',1)'));
        assert(!surfaceStyle(theme, 80).includes('opacity:'));
    }
    assert.equal(surfaceStyle('invalid', NaN), surfaceStyle('graphite', 98));
    assert(surfaceStyle('ocean', 0).includes(',0)'));
    assert(!surfaceStyle('ocean', 0).includes('NaN'));
    assert(surfaceStyle('ocean', 1).includes(',0.01)'));
    assert(surfaceStyle('ocean', 0, 50).includes(',0)'));
    assert.equal(surfaceStyle('forest', 500), surfaceStyle('forest', 100));
});

test('matte backing leaves the pure tint untouched at zero', () => {
    for (const theme of Object.keys(THEMES)) {
        for (const opacity of [70, 85, 98, 100]) {
            assert.equal(surfaceStyle(theme, opacity, 0), surfaceStyle(theme, opacity), theme);
            assert.equal(surfaceStyle(theme, opacity, -5), surfaceStyle(theme, opacity), theme);
        }
    }
});

test('full matte flattens color while preserving chosen opacity', () => {
    for (const theme of Object.keys(THEMES)) {
        for (const opacity of [70, 98, 100]) {
            const solid = surfaceStyle(theme, opacity, 100);
            assert(solid.includes(`,${opacity / 100})`), solid);
            const [start, end] = solid.match(/rgba\(([^)]+)\)/g);
            assert.equal(start, end, theme); // both stops are the flat mid tone
        }
    }
    // Graphite mid tone: mean of [48,50,56] and [29,31,36], rounded.
    assert(surfaceStyle('graphite', 98, 100).includes('rgba(39,41,46,0.98)'));
});

test('every matte setting preserves the full opacity range', () => {
    for (const theme of Object.keys(THEMES))
        for (const matte of [0, 25, 60, 100])
            for (const opacity of [0, 1, 20, 50, 69, 70, 98, 100]) {
                const colors = surfaceStyle(theme, opacity, matte).match(/rgba\([^)]+\)/g);
                assert.equal(colors.length, 2);
                for (const color of colors) assert(color.endsWith(`,${opacity / 100})`), color);
            }
});
