import assert from 'node:assert/strict';
import test from 'node:test';
import {plainText, notificationAge, orderNotifications, notificationCount, shouldPeek, startOfDay,
    notificationSections, filterNotifications, groupNotifications, groupPreview, unseenCount} from '../services/notifications-model.js';

test('plain text strips body markup and collapses whitespace', () => {
    assert.equal(plainText('<b>Build</b> &amp; deploy\n\n<i>done</i>', true), 'Build & deploy done');
    assert.equal(plainText('&lt;tag&gt; &#65;&#x42; &bogus;', true), '<tag> AB &bogus;');
    assert.equal(plainText('<b>kept</b>  as   text'), '<b>kept</b> as text');
    assert.equal(plainText(null), '');
    assert.equal(plainText('&#0; &#x110000;', true), '&#0; &#x110000;');
});

test('notification age uses compact relative labels', () => {
    const now = 1_000_000;
    for (const [seconds, expected] of [[0, 'Now'], [59, 'Now'], [60, '1 min'], [3599, '59 min'],
        [3600, '1 h'], [86399, '23 h'], [86400, 'Yesterday'], [3 * 86400, '3 d']])
        assert.equal(notificationAge(now - seconds, now), expected, String(seconds));
    assert.equal(notificationAge(now + 120, now), 'Now');
});

test('critical notifications come first, then newest with a stable tie-break', () => {
    const items = [{id: 1, time: 10}, {id: 2, time: 30}, {id: 3, time: 30}, {id: 4, time: 20}, {id: 5, time: 1, critical: true}];
    assert.deepEqual(orderNotifications(items).map(item => item.id), [5, 3, 2, 4, 1]);
    assert.deepEqual(items.map(item => item.id), [1, 2, 3, 4, 5]);
});

test('notification count wording', () => {
    assert.equal(notificationCount(0), 'No notifications');
    assert.equal(notificationCount(1), '1 notification');
    assert.equal(notificationCount(4), '4 notifications');
});

test('sections pin critical items and label Today only beside Earlier', () => {
    const today = startOfDay(new Date(2026, 10, 14, 15, 30));
    assert.equal(today, Math.floor(new Date(2026, 10, 14).getTime() / 1000));
    const recent = [{id: 2, time: today + 60}, {id: 1, time: today + 10}];
    assert.deepEqual(notificationSections(recent, today).map(s => [s.id, s.title, s.items.length]), [['today', '', 2]]);
    const mixed = orderNotifications([...recent, {id: 3, time: today - 10}, {id: 4, time: today - 99, critical: true}]);
    assert.deepEqual(notificationSections(mixed, today).map(s => [s.id, s.title, s.items.map(i => i.id)]),
        [['pinned', '', [4]], ['today', 'Today', [2, 1]], ['earlier', 'Earlier', [3]]]);
    assert.deepEqual(notificationSections([], today), []);
});

test('Today filter keeps critical items', () => {
    const items = [{id: 1, time: 50}, {id: 2, time: 150}, {id: 3, time: 10, critical: true}];
    assert.deepEqual(filterNotifications(items, 'today', 100).map(i => i.id), [2, 3]);
    assert.equal(filterNotifications(items, 'all', 100), items);
});

test('groups follow each app’s first item and summarise their contents', () => {
    const items = orderNotifications([
        {id: 1, time: 10, appKey: 'chat', app: 'Chat', title: 'Ali', body: 'pushed fix'},
        {id: 2, time: 40, appKey: 'chat', app: 'Chat', title: 'Sara', body: 'lunch?'},
        {id: 3, time: 30, appKey: 'mail', app: 'Mail', title: '', body: 'Invoice'},
        {id: 4, time: 5, app: 'Battery', title: 'Low', critical: true},
        {id: 5, time: 20, appKey: 'chat', app: 'Chat', title: 'Mina'},
    ]);
    const groups = groupNotifications(items);
    assert.deepEqual(groups.map(g => [g.key, g.items.map(i => i.id), g.time, g.critical]),
        [['Battery', [4], 5, true], ['chat', [2, 5, 1], 40, false], ['mail', [3], 30, false]]);
    assert.equal(groupPreview(groups[1]), 'Sara · Mina');
    assert.equal(groupPreview(groups[2]), 'Invoice');
});

test('unseen counts items newer than the last opened view', () => {
    const items = [{id: 3}, {id: 5}, {id: 8}];
    assert.equal(unseenCount(items, 0), 3);
    assert.equal(unseenCount(items, 5), 1);
    assert.equal(unseenCount(items, 8), 0);
});

test('peek follows banner policy, lock state and visibility', () => {
    const base = {enabled: true, visible: true, locked: false, critical: false, showBanners: true};
    assert.equal(shouldPeek(base), true);
    assert.equal(shouldPeek({...base, showBanners: false}), false);
    assert.equal(shouldPeek({...base, showBanners: false, critical: true}), true);
    assert.equal(shouldPeek({...base, locked: true, critical: true}), false);
    assert.equal(shouldPeek({...base, visible: false}), false);
    assert.equal(shouldPeek({...base, enabled: false}), false);
});
