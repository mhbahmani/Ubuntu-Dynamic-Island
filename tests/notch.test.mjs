import test from 'node:test';
import assert from 'node:assert/strict';
import {notchOrder, NOTCH_ITEMS, connectionIndicator, migrateOfflineMode} from '../services/notch-model.js';

test('connection icons keep disconnected, limited and captive portal descriptions accessible', () => {
    const enabled = {network: true};
    assert.match(connectionIndicator('offline', enabled).description, /Offline/);
    assert.match(connectionIndicator('limited', enabled).description, /without full internet/);
    assert.match(connectionIndicator('portal', enabled).description, /sign-in required/);
    assert.equal(connectionIndicator('offline', enabled).icon, 'network-wireless-disabled-symbolic');
    assert.equal(connectionIndicator('portal', enabled).icon, 'network-wireless-no-route-symbolic');
    for (const state of ['online', undefined, 'unknown'])
        assert.equal(connectionIndicator(state, enabled).visible, false);
});

test('connection icons respect enabled indicators, their order and hide preference', () => {
    assert.equal(connectionIndicator('offline').visible, false);
    assert.equal(connectionIndicator('offline', {weather: true}).anchor, 'weather');
    assert.equal(connectionIndicator('limited', {commute: true}).anchor, 'commute');
    const options = {order: ['commute', 'media', 'weather', 'network'], network: true, weather: true, commute: true};
    assert.equal(connectionIndicator('offline', options).anchor, 'commute');
    assert.equal(connectionIndicator('offline', {...options, commute: false}).anchor, 'weather');
    for (const state of ['offline', 'limited', 'portal']) {
        const hidden = connectionIndicator(state, {...options, mode: 'hide'});
        assert.equal(hidden.visible, false);
        assert.equal(hidden.hideUnavailable, true);
        assert.equal(hidden.anchor, null);
    }
    assert.equal(connectionIndicator('online', {...options, mode: 'hide'}).hideUnavailable, false);
});

test('broken edge accompanies the unplugged icon only for enabled offline groups', () => {
    for (const state of ['offline', 'limited', 'portal']) {
        const icon = connectionIndicator(state, {network: true, mode: 'icon'});
        const edge = connectionIndicator(state, {network: true, mode: 'edge'});
        assert.equal(icon.edge, false);
        assert.equal(edge.edge, true);
        assert.equal(edge.icon, 'unplug-symbolic');
        assert.equal(edge.anchor, icon.anchor);
        assert.equal(edge.description, icon.description);
        assert.equal(connectionIndicator(state, {mode: 'edge'}).edge, false);
    }
    assert.equal(connectionIndicator('online', {network: true, mode: 'edge'}).edge, false);
});

test('legacy badge preference migrates to icon while edge and hide choices are preserved', () => {
    for (const initial of ['badge', 'icon', 'edge', 'hide']) {
        let saved = initial;
        migrateOfflineMode({get_string: () => saved, set_string: (_key, value) => { saved = value; }});
        assert.equal(saved, initial === 'badge' ? 'icon' : initial);
    }
    assert.equal(connectionIndicator('offline', {network: true, mode: 'badge'}).icon,
        connectionIndicator('offline', {network: true, mode: 'icon'}).icon);
});

test('notch order preserves choices and repairs missing or duplicated items', () => {
    assert.deepEqual(notchOrder(['network', 'weather', 'network', 'unknown']),
        ['network', 'weather', 'media', 'cpu', 'bluetooth', 'commute', 'agents', 'date']);
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
    assert.equal(commuteIndicator({route, data}).text, '18m');
    assert.equal(commuteIndicator({route, data: {...data, traffic: true}}).text, '18m');
    assert.equal(commuteIndicator({route, data, status: 'error'}).text, '!18m');
    assert.equal(commuteIndicator({route, status: 'loading'}).text, '…');
    assert.equal(commuteIndicator({route, status: 'error', error: 'Location off'}).text, '—');
    assert.match(commuteIndicator({route, data}).description, /no live traffic/);
});

test('media title modes preserve Unicode and bound fixed character limits', async () => {
    const {titleText, titleLimit} = await import('../services/notch-model.js');
    assert.equal(titleLimit(1000), 40); assert.equal(titleLimit(1), 5);
    assert.equal(titleText('abcdefghij', 'fixed', 5), 'abcde…');
    assert.equal(titleText('abc', 'fixed', 5), 'abc');
    assert.equal(titleText('👨‍👩‍👦'.repeat(6), 'fixed', 5), '👨‍👩‍👦'.repeat(5) + '…');
    for (const mode of ['scroll', 'fit']) assert.equal(titleText('A long complete title', mode, 5), 'A long complete title');
});
