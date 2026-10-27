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
    assert(surfaceStyle('ocean', 0, 50).includes(',0.5)'));
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

test('full matte becomes a flat solid panel at any opacity', () => {
    for (const theme of Object.keys(THEMES)) {
        for (const opacity of [70, 98, 100]) {
            const solid = surfaceStyle(theme, opacity, 100);
            assert(solid.includes(',1)'), solid);
            const [start, end] = solid.match(/rgba\(([^)]+)\)/g);
            assert.equal(start, end, theme); // both stops are the flat mid tone
        }
    }
    // Graphite mid tone: mean of [48,50,56] and [29,31,36], rounded.
    assert(surfaceStyle('graphite', 98, 100).includes('rgba(39,41,46,1)'));
});

test('partial matte composites tint and backing alphas exactly', () => {
    // Background visibility drops from (1-alpha) to (1-alpha)*(1-matte).
    assert(surfaceStyle('graphite', 70, 50).includes(',0.85)'));
    assert(surfaceStyle('ocean', 80, 75).includes(',0.95)'));
    assert(surfaceStyle('forest', 100, 60).includes(',1)'));
    // With matte 0 the alpha stays the plain tint alpha.
    assert(surfaceStyle('ember', 80, 0).includes(',0.8)'));
});
