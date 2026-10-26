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
    assert.equal(surfaceStyle('ocean', 0), surfaceStyle('ocean', 70));
    assert.equal(surfaceStyle('forest', 500), surfaceStyle('forest', 100));
});
