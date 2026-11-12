import test from 'node:test';
import assert from 'node:assert/strict';
import {civilDay, dateParts} from '../services/calendar-model.js';
import {calendarHolidays, holidayDescription, isCalendarWeekend} from '../services/calendar-holidays.js';

test('English observance descriptions preserve the holiday dates', () => {
    const info = calendarHolidays(civilDay(2026,11,13),'jalali');
    assert.equal(holidayDescription(info,'jalali',false),'Martyrdom of Fatimah');
    assert.equal(holidayDescription({...info,estimated:true},'jalali',false),'Martyrdom of Fatimah (calculated)');
    assert.match(holidayDescription(info,'jalali'),/شهادت/);
});

test('weekly holidays follow the main calendar', () => {
    for (let day = 0; day < 7; day++) {
        assert.equal(isCalendarWeekend(day, 'gregorian'), day === 0 || day === 6);
        for (const primary of ['jalali', 'hijri'])
            assert.equal(isCalendarWeekend(day, primary), day === 5);
    }
    assert.equal(calendarHolidays(civilDay(2026, 11, 6), 'jalali').weekend, true);
    assert.equal(calendarHolidays(civilDay(2026, 11, 6), 'gregorian').holiday, false);
    assert.equal(calendarHolidays(civilDay(2026, 11, 7), 'gregorian').weekend, true);
});

test('published Iranian 1405 dates override calculated lunar dates and keep overlapping occasions', () => {
    const newYear = calendarHolidays(civilDay(2026, 3, 21), 'jalali');
    assert.deepEqual(newYear.names, ['نوروز', 'عید فطر']);
    assert.equal(newYear.estimated, false);
    assert.deepEqual(calendarHolidays(civilDay(2026, 6, 4), 'jalali').names, ['رحلت امام خمینی', 'عید غدیر']);
    assert.deepEqual(calendarHolidays(civilDay(2026, 8, 13), 'jalali').names, ['شهادت امام رضا']);
    assert.deepEqual(calendarHolidays(civilDay(2026, 11, 13), 'jalali').names, ['شهادت حضرت فاطمه']);
    assert.equal(calendarHolidays(civilDay(2026, 11, 14), 'jalali').holiday, false);
    assert.deepEqual(calendarHolidays(civilDay(2027, 3, 10), 'jalali').names, ['عید فطر']);
    assert.deepEqual(calendarHolidays(civilDay(2027, 3, 11), 'jalali').names, ['تعطیلات عید فطر']);
    let namedDays = 0;
    for (let day = civilDay(2026, 3, 21); day <= civilDay(2027, 3, 20); day++) {
        const info = calendarHolidays(day, 'jalali');
        if (info.names.length) namedDays++;
        assert.equal(info.estimated, false);
    }
    assert.equal(namedDays, 26, 'Published 1405 calendar has 26 distinct named holiday dates');
});

test('Hijri holidays match the displayed calculation including the last day of a short Safar', () => {
    let safarEnd;
    for (let day = civilDay(2026, 7, 1); day < civilDay(2026, 9, 1); day++) {
        const parts = dateParts(day, 'islamic-civil');
        if (parts.month === 2 && parts.day === 29) safarEnd = day;
        const info = calendarHolidays(day, 'hijri');
        if (info.names.length) {
            assert.equal(info.estimated, true);
            assert.match(holidayDescription(info, 'hijri'), /محاسبه‌ای/);
        }
    }
    assert.ok(safarEnd);
    assert.deepEqual(calendarHolidays(safarEnd, 'hijri').names, ['شهادت امام رضا']);
    assert.deepEqual(calendarHolidays(civilDay(2026, 11, 14), 'hijri').names, ['شهادت حضرت فاطمه']);
});

test('Gregorian does not inherit Iranian holidays; unpublished lunar dates are explicitly estimates', () => {
    const independence = civilDay(2027, 2, 11);
    assert.deepEqual(calendarHolidays(independence, 'jalali').names, ['پیروزی انقلاب اسلامی']);
    assert.equal(calendarHolidays(independence, 'gregorian').holiday, false);
    assert.equal(holidayDescription(calendarHolidays(civilDay(2026, 11, 8), 'gregorian'), 'gregorian'), 'Weekend');
    const estimate = calendarHolidays(civilDay(2025, 7, 6), 'jalali');
    assert.ok(estimate.names.includes('عاشورا'));
    assert.equal(estimate.estimated, true);
    assert.match(holidayDescription(estimate, 'jalali'), /محاسبه‌ای/);
});
