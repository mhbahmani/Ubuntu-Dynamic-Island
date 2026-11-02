import test from 'node:test';
import assert from 'node:assert/strict';
import {notchOrder, NOTCH_ITEMS} from '../services/notch-model.js';

test('notch order preserves choices and repairs missing or duplicated items', () => {
    assert.deepEqual(notchOrder(['network', 'weather', 'network', 'unknown']),
        ['network', 'weather', 'media', 'cpu', 'bluetooth', 'commute']);
    assert.deepEqual(notchOrder([]), NOTCH_ITEMS);
});

test('configurable chevrons retain the requested angle within safe bounds', async () => {
    const {arrowSvg, arrowAngle} = await import('../services/notch-model.js');
    assert.equal(arrowAngle(0), 40); assert.equal(arrowAngle(180), 120); assert.equal(arrowAngle(undefined), 80);
    for (const angle of [40, 60, 80, 95, 120]) {
        const svg = arrowSvg('chevron', 'down', angle);
        const points = svg.match(/d="M([\d.]+) ([\d.]+) L8 ([\d.]+) L([\d.]+) ([\d.]+)"/).slice(1).map(Number);
        const actual = 2 * Math.atan((8 - points[0]) / (points[2] - points[1])) * 180 / Math.PI;
        assert.ok(Math.abs(actual - angle) < .01);
        assert.ok(points.every(p => p >= 1 && p <= 15));
    }
});
test('old compact arrows migrate without overwriting an explicit angle', async () => {
    const {migrateArrowStyle} = await import('../services/notch-model.js');
    for (const explicit of [null, 92]) {
        const state = {style: 'compact', angle: explicit ?? 80};
        migrateArrowStyle({get_string: () => state.style, get_user_value: () => explicit,
            set_string: (_k, value) => { state.style = value; }, set_int: (_k, value) => { state.angle = value; }});
        assert.equal(state.style, 'chevron'); assert.equal(state.angle, explicit ?? 60);
    }
});

test('Commute notch distinguishes baseline, traffic, stale and missing estimates', async () => {
    const {commuteIndicator} = await import('../services/notch-model.js');
    const route = {name: 'Home'}, data = {seconds: 1080, traffic: false};
    assert.equal(commuteIndicator({}).visible, false);
    assert.equal(commuteIndicator({route, data}).text, '~18m');
    assert.equal(commuteIndicator({route, data: {...data, traffic: true}}).text, '18m');
    assert.equal(commuteIndicator({route, data, status: 'error'}).text, '!18m');
    assert.equal(commuteIndicator({route, status: 'loading'}).text, '…');
    assert.equal(commuteIndicator({route, status: 'error', error: 'Location off'}).text, '—');
    assert.match(commuteIndicator({route, data}).description, /no live traffic/);
});
