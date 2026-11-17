// Run through Node's calendar-events.test.mjs with a separate TZ per process.
// Fixtures only: does not import EDS or contact the session bus.
import GLib from 'gi://GLib';
import {civilDay} from '../extension/services/calendar-model.js';
import {localDayRange, eventQueryRanges, normalizeOccurrences, eventsForDay,
    upcomingEvents, validateMeetUri} from '../extension/services/calendar-events-model.js';

function check(condition, message) { if (!condition) throw new Error(message); }
const timezone = GLib.getenv('TZ');
const day = civilDay(2026, 11, 11);
const {startMs, endMs} = localDayRange(day);
check(endMs > startMs, 'Local interval');
if (timezone === 'America/New_York') {
    for (const [date, hours] of [[[2026, 3, 8], 23], [[2026, 11, 1], 25]]) {
        const civil = civilDay(...date), range = localDayRange(civil);
        check(range.endMs - range.startMs === hours * 3600000, 'DST day duration');
        const batch = normalizeOccurrences([{sourceUid: 'fixture', uid: 'crossing', allDay: false,
            startMs: range.startMs, endMs: range.endMs}], {sourceUids: ['fixture']});
        check(eventsForDay(batch, civil, {covered: true}).count === 1, 'DST agenda');
        check(eventsForDay(batch, civil + 1, {covered: true}).count === 0, 'DST exclusive end');
        const query = eventQueryRanges([{startDay: civil, endDayExclusive: civil + 1}])[0];
        check(query.startMs === range.startMs && query.endMs === range.endMs, 'DST query bounds');
    }
} else if (timezone === 'Asia/Tehran') {
    check(startMs === Date.parse('2026-11-10T20:30:00Z'), 'Tehran midnight is not UTC midnight');
} else if (timezone === 'Pacific/Apia') {
    const skipped = localDayRange(civilDay(2011, 12, 30));
    check(skipped.startMs === skipped.endMs, 'Skipped local date is empty');
}
const batch = normalizeOccurrences([{sourceUid: 'fixture', uid: 'example', allDay: false,
    title: 'جلسه · Review', startMs, endMs}], {sourceUids: ['fixture']});
check(eventsForDay(batch, day, {covered: true}).count === 1, 'GJS normalization/grouping');
check(upcomingEvents(batch, {nowMs: startMs, covered: true}).ongoing, 'GJS upcoming selection');
check(validateMeetUri('https://meet.google.com/abc-defg-hij') !== null, 'GJS URI validation');
print('Calendar event native checks passed');
