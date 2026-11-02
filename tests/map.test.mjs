import test from 'node:test';
import assert from 'node:assert/strict';
import {project, unproject, visibleTiles} from '../services/map-model.js';

test('map clicks round-trip coordinates at all supported zooms', () => {
    for (const zoom of [2, 12, 19]) for (const p of [
        {latitude: 35.72, longitude: 51.33}, {latitude: -33.86, longitude: 151.21},
        {latitude: 0, longitude: -179.99}, {latitude: 84.9, longitude: 179.99},
    ]) {
        const pixel = project(p, zoom), actual = unproject(pixel.x, pixel.y, zoom);
        assert.ok(Math.abs(actual.latitude - p.latitude) < 1e-8);
        assert.ok(Math.abs(actual.longitude - p.longitude) < 1e-8);
    }
});
test('visible tiles wrap at the dateline and stay within the world vertically', () => {
    const tiles = visibleTiles({latitude: 84, longitude: 179.99}, 2, 860, 400);
    assert.ok(tiles.length < 30);
    assert.ok(tiles.some(t => t.key.split('/')[1] === '0'));
    for (const t of tiles) {
        const [z, x, y] = t.key.split('/').map(Number);
        assert.ok(x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z);
    }
});
