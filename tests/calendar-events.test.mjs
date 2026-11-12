import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {civilDay, numericDate} from '../services/calendar-model.js';
import {EVENT_LIMITS, normalizeOccurrences, validateMeetUri, localDayRange,
    eventQueryRanges, eventsForDay, upcomingEvents, calendarColor, isGoogleHolidayCalendar, visibleCalendarEvents} from '../services/calendar-events-model.js';

test('holiday sources use Google identifiers rather than names or event titles', () => {
    const path = id => `events::https://apidata.googleusercontent.com/caldav/v2/${encodeURIComponent(id)}/events/`;
    assert.equal(isGoogleHolidayCalendar(path('en.ir#holiday@group.v.calendar.google.com')), true);
    assert.equal(isGoogleHolidayCalendar(path('cln2sqbi4dk6ur39chgnig37e9nnas1eeon66obccln68obi5pjmurr7dhiisorfdk@virtual')), true);
    for (const value of [null, 'Holidays in Iran', path('personal@example.com'), path('invalid@virtual'),
        path('en.ir#holiday@group.v.calendar.google.com.evil'), path('%zz')])
        assert.equal(isGoogleHolidayCalendar(value), false);
    const snapshot = {status:'partial',incomplete:true,coverage:[],sources:[{uid:'holidays',holiday:true},{uid:'personal'}],
        occurrences:[{sourceUid:'holidays',title:'Holiday'},{sourceUid:'personal',title:'Holiday',allDay:true}]};
    assert.equal(visibleCalendarEvents(snapshot,true), snapshot);
    const hidden = visibleCalendarEvents(snapshot,false);
    assert.deepEqual(hidden.occurrences, [snapshot.occurrences[1]]);
    assert.equal(hidden.incomplete,true);
    assert.equal(snapshot.occurrences.length,2);
});

const day = civilDay(2026, 11, 11);
const now = localDayRange(day).startMs + 12 * 3600000;
const event = (changes = {}) => ({sourceUid: 'work', uid: 'meeting', recurrenceId: '',
    allDay: false, title: 'Design review', startMs: now, endMs: now + 3600000, ...changes});
const batch = (events, options = {}) => normalizeOccurrences(events, {sourceUids: ['work', 'home'], ...options});
const agenda = (events, selectedDay = day) => eventsForDay(events, selectedDay, {covered: true});
const upcoming = (events, changes = {}) => upcomingEvents(events, {nowMs: now, covered: true, ...changes});

test('events require explicit source selection; removed sources disappear on replacement', () => {
    assert.deepEqual(normalizeOccurrences([event()]), {occurrences: [], incomplete: false});
    assert.equal(batch([event(), event({sourceUid: 'home'})]).occurrences.length, 2);
    assert.equal(batch([event(), event({sourceUid: 'home'})], {sourceUids: ['home']}).occurrences[0].sourceUid, 'home');
    assert.deepEqual(batch([event({sourceUid: 'other'})]).occurrences, []);
    assert.equal(batch([], {sourceUids: 'work'}).incomplete, true);
    assert.equal(batch([], {sourceUids: Array(65).fill('work')}).incomplete, true);
});

test('composite identities separate sources and recurrence instances, deduplicate overlapping ranges', () => {
    const values = [event({uid: 'a|b', recurrenceId: 'c'}), event({uid: 'a', recurrenceId: 'b|c'}),
        event(), event({sourceUid: 'home'}), event({recurrenceId: '20261112T120000Z'}), event()];
    const result = batch(values);
    assert.equal(result.incomplete, false);
    assert.equal(new Set(result.occurrences.map(item => item.id)).size, 5);
    assert.deepEqual(batch([...values].reverse()), result, 'Input ordering must not reorder the agenda');
    assert.equal(batch([event(), event({title: 'Conflicting duplicate'})]).incomplete, true);
    const moved = batch([event({recurrenceId: 'original-start', startMs: now + 1000})]);
    assert.equal(moved.occurrences[0].id, batch([event({recurrenceId: 'original-start'})]).occurrences[0].id);
});

test('only explicit cancellation or current-user decline excludes an occurrence', () => {
    const result = batch([event({uid: 'cancelled', status: 'cancelled'}),
        event({uid: 'declined', selfResponse: 'declined'}), event({uid: 'unknown'}),
        event({uid: 'pending', selfResponse: 'needs-action'}), event({uid: 'accepted', selfResponse: 'accepted'})]);
    assert.deepEqual(result.occurrences.map(item => item.uid), ['accepted', 'pending', 'unknown']);
    assert.equal(result.incomplete, false);
    assert.equal(result.occurrences[2].selfResponse, 'unknown');
});

test('normalization bounds display fields, retains plain text and rejects corrupt identities/times', () => {
    const input = event({title: '<b>جلسه</b>\n\u202eTest', location: 'x'.repeat(5000),
        attendees: ['private'], openTarget: 'arbitrary-command', joinUri: 'https://evil.example/'});
    const result = batch([input]);
    assert.equal(result.occurrences[0].title, '<b>جلسه</b>  Test');
    assert.equal(result.occurrences[0].location.length, EVENT_LIMITS.location);
    assert.equal(result.occurrences[0].joinUri, null);
    assert.equal('attendees' in result.occurrences[0], false);
    assert.equal('openTarget' in result.occurrences[0], false);
    assert.equal(input.title.includes('\n'), true, 'Input is not mutated');
    assert.equal(batch([event({title: '😀'.repeat(600)})]).occurrences[0].title.length, 1024);
    for (const change of [{uid: ''}, {uid: 'x'.repeat(1025)}, {recurrenceId: 42}, {allDay: 'false'},
        {startMs: NaN}, {startMs: '2026-11-11T12:00:00'}, {startMs: Infinity},
        {startMs: now + 0.5}, {endMs: now - 1}]) {
        assert.deepEqual(batch([event(change)]), {occurrences: [], incomplete: true});
    }
    assert.equal(batch([null]).incomplete, true);
    assert.equal(batch(null).incomplete, true);
});

test('caps and upstream partial results never become confirmed empty or a definitive next event', () => {
    const full = batch(Array.from({length: 501}, (_, i) => event({uid: String(i)})));
    assert.equal(full.occurrences.length, 500);
    assert.equal(full.incomplete, true);
    assert.equal(agenda(full).count, null);
    assert.equal(upcoming(full), null);
    assert.equal(batch(Array(2001).fill(event())).incomplete, true);
    for (const partial of [batch([], {incomplete: true}), batch([event()], {incomplete: true})]) {
        assert.equal(agenda(partial).complete, false);
        assert.equal(agenda(partial).count, null);
        assert.equal(upcoming(partial), null);
    }
    assert.equal(eventsForDay(batch([]), day).count, null, 'Unqueried day is unknown');
    assert.equal(agenda(batch([])).count, 0, 'Covered empty day is confirmed');
    assert.equal(upcomingEvents(batch([event()]), {nowMs: now}), null);
});

test('all-day entries use exclusive Gregorian dates, default to one day and precede timed entries', () => {
    const allDay = event({allDay: true, startDate: '2026-11-11', endDateExclusive: '2026-11-13'});
    const result = batch([event(), allDay]);
    // Identical UIDs denote conflicting records, so use distinct identities.
    assert.equal(result.incomplete, true);
    const distinct = batch([event(), {...allDay, uid: 'holiday'}]);
    assert.equal(agenda(distinct).occurrences[0].uid, 'holiday');
    assert.equal(agenda(distinct, day + 1).count, 1);
    assert.equal(agenda(distinct, day + 2).count, 0);
    const single = batch([{...allDay, endDateExclusive: undefined}]);
    assert.equal(single.occurrences[0].endDateExclusive, '2026-11-12');
    assert.equal('startMs' in single.occurrences[0], false);
    assert.equal(upcoming(single), null);
    for (const change of [{startDate: '2026-02-30'}, {startDate: '2026-1-01'},
        {endDateExclusive: '2026-11-10'}, {endDateExclusive: '2026-11-11'}, {endDateExclusive: ''}])
        assert.equal(batch([{...allDay, ...change}]).incomplete, true);
    const leap = batch([{...allDay, startDate: '2024-02-29', endDateExclusive: undefined}]);
    assert.equal(leap.occurrences[0].endDateExclusive, '2024-03-01');
});

test('timed events overlap local days with half-open boundaries and zero duration belongs to its start day', () => {
    const midnight = localDayRange(day).startMs;
    const next = localDayRange(day).endMs;
    const values = batch([event({uid: 'ends-at-midnight', startMs: midnight - 1000, endMs: midnight}),
        event({uid: 'overnight', startMs: midnight - 1000, endMs: midnight + 1000}),
        event({uid: 'next-day', startMs: next, endMs: next + 1000}),
        event({uid: 'no-end', startMs: midnight, endMs: undefined})]);
    assert.deepEqual(agenda(values).occurrences.map(item => item.uid), ['overnight', 'no-end']);
    assert.equal(agenda(values, day - 1).count, 2);
    assert.equal(agenda(values, day + 1).count, 1);
    assert.equal(values.occurrences.find(item => item.uid === 'no-end').endMs, midnight);
    // The existing calendar conversion operates only on the grouped civil day.
    assert.equal(numericDate(day, 'persian'), '1405/08/20');
    assert.equal(numericDate(day, 'gregory'), '2026/11/11');
});

test('notch prefers all ongoing events then earliest simultaneous starts within the lead window', () => {
    const values = batch([event({uid: 'ended', startMs: now - 2000, endMs: now}),
        event({uid: 'ongoing-b', startMs: now - 1000}), event({uid: 'ongoing-a', startMs: now - 1000}),
        event({uid: 'future', startMs: now + 60000})]);
    assert.deepEqual(upcoming(values).occurrences.map(item => item.uid), ['ongoing-a', 'ongoing-b']);
    assert.equal(upcoming(values).ongoing, true);
    const future = batch([event({uid: 'later', startMs: now + 900001}),
        event({uid: 'b', startMs: now + 900000}), event({uid: 'a', startMs: now + 900000})]);
    assert.deepEqual(upcoming(future).occurrences.map(item => item.uid), ['a', 'b']);
    assert.equal(upcoming(future).ongoing, false);
    assert.equal(upcoming(future, {leadMinutes: 5}), null);
    assert.equal(upcoming(batch([event({endMs: now})])), null);
    assert.equal(upcoming(batch([event({startMs: now + 1000, endMs: now + 1000})])).ongoing, false);
    assert.throws(() => upcoming(values, {leadMinutes: 0}), RangeError);
});

test('Meet validation permits only structured HTTPS room URLs on the exact host', () => {
    for (const uri of ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij?authuser=1&x=%20'])
        assert.equal(validateMeetUri(uri), uri);
    for (const uri of [null, '', 'http://meet.google.com/abc-defg-hij',
        'https://meet.google.com.evil.example/abc-defg-hij', 'https://evil.example/meet.google.com/abc-defg-hij',
        'https://user:pass@meet.google.com/abc-defg-hij', 'https://meet.google.com@evil.example/abc-defg-hij',
        'https://meet.google.com:443/abc-defg-hij', 'https://meet.google.com./abc-defg-hij',
        'https://meet.google.com\\@evil.example/abc-defg-hij', 'https://meet.google.com/abc-defg-hij\n',
        'https://meet.google.com/abc-defg-hij?x=%0', 'https://meet.google.com/abc-defg-hij?x=\u202e',
        'httpſ://meet.google.com/abc-defg-hij', 'https://meet.google.com/abK-defg-hij',
        'https://meet.google.com/abc-defg-hij?x=' + 'x'.repeat(2048), 'file:///tmp/meeting'])
        assert.equal(validateMeetUri(uri), null, String(uri));
});

test('month and upcoming query ranges overlap only when appropriate and never span intervening years', () => {
    const month = {startDay: day - 10, endDayExclusive: day + 20};
    assert.equal(eventQueryRanges([month, {startDay: day, endDayExclusive: day + 7}]).length, 1);
    const distant = {startDay: day + 3650, endDayExclusive: day + 3680};
    const result = eventQueryRanges([distant, month]);
    assert.equal(result.length, 2);
    assert.equal(result[0].endDayExclusive, month.endDayExclusive);
    assert.equal(result[1].startDay, distant.startDay);
    assert.deepEqual(eventQueryRanges([]), []);
    for (const ranges of [[month, month, month], [{startDay: day, endDayExclusive: day}],
        [{startDay: day, endDayExclusive: day + 63}], [null]]) assert.throws(() => eventQueryRanges(ranges), RangeError);
    assert.throws(() => localDayRange(NaN), RangeError);
});

test('native GJS model handles DST, Tehran time and skipped dates without optional EDS packages', () => {
    for (const timezone of ['America/New_York', 'Asia/Tehran', 'Pacific/Apia']) {
        const output = execFileSync('gjs', ['-m', 'tests/calendar-events-native.mjs'], {
            cwd: new URL('..', import.meta.url), env: {...process.env, TZ: timezone}, timeout: 10000, encoding: 'utf8'});
        assert.match(output, /Calendar event native checks passed/);
    }
});


test('calendar source colors normalize RGB hex and reject unsafe or missing specifications', () => {
    assert.equal(calendarColor('#12aBcD'), '#12abcd');
    assert.equal(calendarColor('#aB9'), '#aabb99');
    for (const value of [null, undefined, 123, '', 'red', '#12345', '#12345678', '#000; padding: 99px', '#123456\n'])
        assert.equal(calendarColor(value), null);
});
