import test from 'node:test';
import assert from 'node:assert/strict';
import {civilDay, dateParts, monthBounds, shiftMonths, monthGrid, todayDay, numericDate, dateTitle, fullDate, calendarTodayLabel, primaryCalendar, shownCalendars, migrateCalendarSettings, notchDate, notchDates, formatNotchDate, dateFormatError, dateOrder, migrateNotchDates} from '../services/calendar-model.js';

test('English date display keeps calendar conversion and overrides saved Persian numerals', () => {
    const day = civilDay(2026,11,10);
    assert.equal(formatNotchDate(day,'jalali','%Y/%M/%D','persian',false),'1405/08/19');
    assert.equal(formatNotchDate(day,'hijri','%Y/%M/%D','persian',false),'1448/05/29');
    for (const id of ['jalali','gregorian','hijri']) {
        assert.equal(calendarTodayLabel(id,false),'Today');
        const full = fullDate(day,primaryCalendar(id),'long',false);
        assert.match(full,/Tuesday/);
        assert.doesNotMatch(full,/[\u0600-\u06ff]/);
        const entries = notchDates(day,{calendars:[id],digits:{[id]:'persian'},calendarLanguage:false});
        assert.equal(entries[0].rtl,false);
        assert.doesNotMatch(entries[0].text + entries[0].description,/[\u0600-\u06ff]/);
    }
    assert.match(formatNotchDate(day,'jalali'),/[\u0600-\u06ff]/);
});

test('short English month names are opt-in per notch calendar and keep full descriptions', () => {
    const day = civilDay(2026,3,21);
    assert.equal(formatNotchDate(day,'jalali','%d %MM','auto',false,true),'1 Far');
    assert.equal(formatNotchDate(day,'jalali','%d %mm','auto',false,true),'1 Far');
    assert.equal(formatNotchDate(day,'jalali','%Y/%M/%D','auto',false,true),'1405/01/01');
    assert.equal(formatNotchDate(day,'jalali','%d %MM','auto',true,true),formatNotchDate(day,'jalali','%d %MM'));
    assert.equal(formatNotchDate(day,'gregorian','%MM','auto',false,true),'March');
    const months = new Set();
    for (let offset = 0; offset < 365; offset++) months.add(formatNotchDate(day+offset,'hijri','%MM','auto',false,true));
    assert.equal(months.size,12);
    for (const month of ['Rab I','Rab II','Jum I','Jum II','Dhu Q','Dhu H']) assert(months.has(month));
    const [entry] = notchDates(day,{calendars:['jalali'],shortMonths:['jalali'],calendarLanguage:false});
    assert.equal(entry.text,'1 Far');
    assert.match(entry.description,/Farvardin/);
    assert.match(notchDates(day,{calendars:['jalali'],calendarLanguage:false})[0].text,/Farvardin/);
});

test('date format tokens, literal text and numerals work for each calendar', () => {
    const day = civilDay(2026, 11, 10);
    assert.equal(formatNotchDate(day, 'jalali', '%Y/%M/%D'), '۱۴۰۵/۰۸/۱۹');
    assert.equal(formatNotchDate(day, 'jalali', '%y/%m/%d', 'latin'), '05/8/19');
    assert.equal(formatNotchDate(day, 'gregorian', '%Y/%M/%D'), '2026/11/10');
    assert.equal(formatNotchDate(day, 'hijri', '%Y/%M/%D'), '۱۴۴۸/۰۵/۲۹');
    assert.equal(formatNotchDate(day, 'gregorian', '%WW %d %MM %Y'), 'Tuesday 10 November 2026');
    assert.equal(formatNotchDate(day, 'gregorian', '%ww %w %mm'), 'Tue T Nov');
    assert.equal(formatNotchDate(day, 'gregorian', '%d %mm', 'persian'), '۱۰ Nov');
    assert.equal(formatNotchDate(day, 'jalali', 'شمسی: %D %MM %%', 'latin'), 'شمسی: 19 آبان %');
    assert.equal(formatNotchDate(day, 'gregorian', '<b>%d</b>'), '<b>10</b>');
    for (const pattern of ['', '%x', '%', '%H:%M', 'a\nb', '\u202e%d', '%MM'.repeat(20), 'x'.repeat(81)]) {
        assert.ok(dateFormatError(pattern), pattern);
        assert.equal(formatNotchDate(day, 'gregorian', pattern), '10 Nov');
    }
    assert.equal(dateFormatError('%WW، %d %MM %Y'), '');
    assert.equal(formatNotchDate(civilDay(2026, 3, 21), 'jalali', '%Y/%M/%D'), '۱۴۰۵/۰۱/۰۱');
});

test('multiple notch calendars retain explicit order and independent formats', () => {
    const entries = notchDates(civilDay(2026, 11, 10), {
        calendars: ['jalali', 'gregorian', 'hijri', 'invalid'],
        order: ['hijri', 'gregorian', 'hijri', 'invalid'],
        formats: {gregorian: '%D/%M', jalali: '%Y/%M/%D'}, digits: {jalali: 'latin'},
    });
    assert.deepEqual(entries.map(entry => entry.id), ['hijri', 'gregorian', 'jalali']);
    assert.deepEqual(entries.map(entry => entry.text), ['۲۹ جمادی‌الاول', '10/11', '1405/08/19']);
    assert.match(entries[0].description, /calculated/);
    assert.equal(notchDates(civilDay(2026, 11, 10), {calendars: []}).length, 0);
    assert.deepEqual(dateOrder(['constructor', 'gregorian', 'gregorian']), ['gregorian', 'jalali', 'hijri']);
    assert.deepEqual(notchDates(civilDay(2026, 11, 10), {main: 'hijri'}).map(entry => entry.id), ['hijri']);
});

test('single-notch calendar settings migrate without overwriting a new layout', () => {
    for (const choice of ['main', 'jalali', 'gregorian', 'hijri']) {
        const values = new Map([['pill-date-calendar', choice], ['calendar-primary', 'hijri']]);
        const settings = {get_user_value: key => values.get(key), get_string: key => values.get(key),
            get_strv: key => values.get(key),
            set_strv: (key, value) => values.set(key, value), reset: key => values.delete(key)};
        migrateNotchDates(settings);
        assert.deepEqual(values.get('pill-date-calendars'), [choice === 'main' ? 'hijri' : choice]);
        assert.ok(!values.has('pill-date-calendar'));
        values.set('pill-date-calendar', 'gregorian');
        values.set('pill-date-calendars', []);
        migrateNotchDates(settings);
        assert.deepEqual(values.get('pill-date-calendars'), []);
    }
});

test('notch calendar defaults and retired follow-main selections resolve once', () => {
    for (const main of ['jalali', 'gregorian', 'hijri']) {
        for (const selection of [undefined, ['main'], ['jalali', 'gregorian'], []]) {
            const values = new Map([['calendar-primary', main]]);
            if (selection) values.set('pill-date-calendars', selection);
            const settings = {get_user_value: key => values.get(key), get_string: key => values.get(key),
                get_strv: key => values.get(key), set_strv: (key, value) => values.set(key, value),
                reset: key => values.delete(key)};
            migrateNotchDates(settings);
            const expected = !selection || selection.includes('main') ? [main] : selection;
            assert.deepEqual(values.get('pill-date-calendars'), expected);
            values.set('calendar-primary', main === 'jalali' ? 'gregorian' : 'jalali');
            migrateNotchDates(settings);
            assert.deepEqual(values.get('pill-date-calendars'), expected, 'Changing the grid must preserve notch choices');
        }
    }
});

test('notch dates follow the chosen calendar independently of the grid', () => {
    const day = civilDay(2026, 11, 10);
    assert.equal(notchDate(day, 'jalali').text, '۱۹ آبان');
    assert.equal(notchDate(day, 'gregorian').text, '10 Nov');
    assert.match(notchDate(day, 'hijri').text, /۲۹/);
    for (const id of ['jalali', 'gregorian', 'hijri']) {
        assert.deepEqual(notchDate(day, 'main', id), notchDate(day, id, 'gregorian'));
        assert.equal(notchDate(day, id).rtl, id !== 'gregorian');
        assert.notEqual(notchDate(day + 1, id).text, notchDate(day, id).text);
    }
    assert.match(notchDate(day, 'gregorian').description, /2026/);
    assert.match(notchDate(day, 'hijri').description, /calculated/);
    assert.deepEqual(notchDate(day, 'invalid'), notchDate(day, 'jalali'));
    assert.equal(notchDate(civilDay(2026, 3, 21), 'jalali').text, '۱ فروردین');
    assert.equal(notchDate(civilDay(2027, 1, 1), 'gregorian').text, '1 Jan');
});

test('Nowruz and Esfand leap-day conversion', () => {
    for (const [g, j] of [
        [[2024, 3, 20], {year: 1403, month: 1, day: 1}],
        [[2025, 3, 20], {year: 1403, month: 12, day: 30}],
        [[2025, 3, 21], {year: 1404, month: 1, day: 1}],
        [[2026, 3, 20], {year: 1404, month: 12, day: 29}],
        [[2026, 3, 21], {year: 1405, month: 1, day: 1}],
    ]) assert.deepEqual(dateParts(civilDay(...g), 'persian'), j);
});
test('month navigation clamps selection across leap days and year boundaries', () => {
    const jan31 = civilDay(2024, 1, 31);
    assert.equal(shiftMonths(jan31, 'gregory', 1), civilDay(2024, 2, 29));
    assert.equal(shiftMonths(civilDay(2025, 1, 31), 'gregory', 1), civilDay(2025, 2, 28));
    assert.equal(shiftMonths(civilDay(2025, 3, 20), 'persian', 12), civilDay(2026, 3, 20));
    assert.equal(shiftMonths(civilDay(2025, 3, 21), 'persian', -1), civilDay(2025, 2, 19));
    assert.equal(shiftMonths(civilDay(2026, 1, 15), 'gregory', -1), civilDay(2025, 12, 15));
});
test('compact grids cover the entire month once without unused weeks', () => {
    for (const mode of ['jalali', 'gregorian', 'hijri']) {
        for (let month = 1; month <= 12; month++) {
            const selected = civilDay(2026, month, 18), calendar = primaryCalendar(mode);
            const grid = monthGrid(selected, mode), bounds = monthBounds(selected, calendar);
            assert.ok([28, 35, 42].includes(grid.length));
            assert.equal(new Set(grid.map(c => c.day)).size, grid.length);
            assert.ok(grid.slice(-7).some(c => c.inMonth), 'Extra empty week');
            assert.equal(grid.filter(c => c.inMonth).length, bounds.end - bounds.start + 1);
            assert.equal(grid.filter(c => c.day === selected).length, 1);
            assert.equal(new Date(grid[0].day * 86400000).getUTCDay(), mode === 'gregorian' ? 1 : 6);
        }
    }
});
test('local today uses civil fields and dates use the selected calendar', () => {
    const now = new Date(2026, 10, 10, 23, 59);
    assert.equal(todayDay(now), civilDay(2026, 11, 10));
    assert.equal(numericDate(todayDay(now), 'persian'), '1405/08/19');
    assert.equal(numericDate(todayDay(now), 'gregory'), '2026/11/10');
    assert.equal(dateTitle(todayDay(now), 'gregory'), '10 November 2026');
});

test('tabular Hijri year boundaries and 29/30-day months stay continuous', () => {
    assert.deepEqual(dateParts(civilDay(2024, 7, 8), 'islamic-civil'), {year:1446, month:1, day:1});
    assert.deepEqual(dateParts(civilDay(2024, 7, 7), 'islamic-civil'), {year:1445, month:12, day:30});
    for (let day = civilDay(2024, 7, 8); day < civilDay(2028, 1, 1);) {
        const {start, end} = monthBounds(day, 'islamic-civil');
        assert.ok([29, 30].includes(end - start + 1));
        assert.equal(dateParts(end + 1, 'islamic-civil').day, 1);
        assert.equal(shiftMonths(start, 'islamic-civil', 1), end + 1);
        const next = shiftMonths(end, 'islamic-civil', 1);
        assert.ok(dateParts(next, 'islamic-civil').day <= dateParts(end, 'islamic-civil').day);
        day = end + 1;
    }
    assert.equal(numericDate(civilDay(2026, 11, 10), 'islamic-civil'), '1448/05/29');
    assert.deepEqual(shownCalendars('hijri', ['jalali', 'hijri', 'gregorian', 'invalid', 'constructor']), ['hijri', 'jalali', 'gregorian']);
});

test('prototype preferences migrate once without overwriting newer choices', () => {
    const values = new Map([['calendar-mode', 'gregorian']]);
    const settings = {get_user_value: key => values.get(key), get_string: key => values.get(key),
        set_string: (key, value) => values.set(key, value), set_strv: (key, value) => values.set(key, value), reset: key => values.delete(key)};
    migrateCalendarSettings(settings);
    assert.equal(values.get('calendar-primary'), 'gregorian');
    assert.deepEqual(values.get('calendar-additional'), []);
    values.set('calendar-primary', 'hijri'); values.set('calendar-additional', ['jalali']); values.set('calendar-mode', 'both');
    migrateCalendarSettings(settings);
    assert.equal(values.get('calendar-primary'), 'hijri');
    assert.deepEqual(values.get('calendar-additional'), ['jalali']);
    assert.ok(!values.has('calendar-mode'));
});


test('prominent day headings use full weekdays and main-calendar date order', () => {
    const day = civilDay(2026, 11, 9);
    assert.equal(fullDate(day, primaryCalendar('gregorian'), 'long'), 'Monday, 9 November 2026');
    assert.equal(fullDate(day, primaryCalendar('jalali'), 'long'), 'دوشنبه، ۱۸ آبان ۱۴۰۵');
    const hijri = fullDate(day, primaryCalendar('hijri'), 'long');
    assert.match(hijri, /^دوشنبه، /u);
    assert.ok(hijri.includes(persianYear(dateParts(day, primaryCalendar('hijri')).year)));
    function persianYear(year) { return String(year).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit]); }
});


test('Today follows the main calendar language', () => {
    assert.equal(calendarTodayLabel('jalali'), 'امروز');
    assert.equal(calendarTodayLabel('gregorian'), 'Today');
    assert.equal(calendarTodayLabel('hijri'), 'اليوم');
});
