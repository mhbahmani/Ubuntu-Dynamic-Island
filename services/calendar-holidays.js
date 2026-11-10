import {dateParts, monthBounds, weekday} from './calendar-model.js';

// Holiday rules follow the main calendar, independently of additional dates.
// Iranian dates and short event names checked against the official 1405 calendar:
// https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf/64228cbb-f4de-dc32-4d2b-57db3c8e322f
// The installed Persian Calendar extension informed the solar/lunar separation.
// No extension implementation or event file is bundled here.
const SOLAR = new Map([
    ['1/1', 'نوروز'], ['1/2', 'نوروز'], ['1/3', 'نوروز'], ['1/4', 'نوروز'],
    ['1/12', 'روز جمهوری اسلامی'], ['1/13', 'روز طبیعت'],
    ['3/14', 'رحلت امام خمینی'], ['3/15', 'قیام ۱۵ خرداد'],
    ['11/22', 'پیروزی انقلاب اسلامی'], ['12/29', 'ملی شدن صنعت نفت'],
]);
const LUNAR = new Map([
    ['1/9', 'تاسوعا'], ['1/10', 'عاشورا'], ['2/20', 'اربعین'],
    ['2/28', 'رحلت پیامبر و شهادت امام حسن'], ['2/last', 'شهادت امام رضا'],
    ['3/8', 'شهادت امام حسن عسکری'], ['3/17', 'میلاد پیامبر و امام جعفر صادق'],
    ['6/3', 'شهادت حضرت فاطمه'], ['7/13', 'ولادت امام علی'], ['7/27', 'مبعث پیامبر'],
    ['8/15', 'نیمه شعبان'], ['9/21', 'شهادت امام علی'],
    ['10/1', 'عید فطر'], ['10/2', 'تعطیلات عید فطر'], ['10/25', 'شهادت امام جعفر صادق'],
    ['12/10', 'عید قربان'], ['12/18', 'عید غدیر'],
]);
// Published lunar-holiday dates in Jalali year 1405. Do not apply a calculated
// Hijri offset to this table: Safar has 29 days and there are two Eids al-Fitr.
const IRAN_1405_LUNAR = new Map([
    ['1/1', '10/1'], ['1/2', '10/2'], ['1/25', '10/25'],
    ['3/6', '12/10'], ['3/14', '12/18'], ['4/3', '1/9'], ['4/4', '1/10'],
    ['5/13', '2/20'], ['5/21', '2/28'], ['5/22', '2/last'], ['5/30', '3/8'],
    ['6/8', '3/17'], ['8/22', '6/3'], ['10/2', '7/13'], ['10/16', '7/27'],
    ['11/4', '8/15'], ['12/9', '9/21'], ['12/19', '10/1'], ['12/20', '10/2'],
]);

export function isCalendarWeekend(dayOfWeek, primary) {
    if (primary === 'gregorian') return dayOfWeek === 0 || dayOfWeek === 6;
    return (primary === 'jalali' || primary === 'hijri') && dayOfWeek === 5;
}

function calculatedLunarHoliday(day) {
    const parts = dateParts(day, 'islamic-civil');
    const key = parts.month === 2 && day === monthBounds(day, 'islamic-civil').end
        ? '2/last' : `${parts.month}/${parts.day}`;
    return LUNAR.get(key);
}

export function calendarHolidays(day, primary) {
    const weekend = isCalendarWeekend(weekday(day), primary);
    const names = [];
    let estimated = false;
    if (primary === 'jalali') {
        const solar = dateParts(day, 'persian'), key = `${solar.month}/${solar.day}`;
        if (SOLAR.has(key)) names.push(SOLAR.get(key));
        const lunar = solar.year === 1405
            ? LUNAR.get(IRAN_1405_LUNAR.get(key)) : calculatedLunarHoliday(day);
        if (lunar) {
            names.push(lunar);
            estimated = solar.year !== 1405;
        }
    } else if (primary === 'hijri') {
        const lunar = calculatedLunarHoliday(day);
        if (lunar) { names.push(lunar); estimated = true; }
    }
    return {weekend, names, estimated, holiday: weekend || names.length > 0};
}

export function holidayDescription(info, primary) {
    if (info.names.length)
        return `${info.names.join(' · ')}${info.estimated ? ' (محاسبه‌ای)' : ''}`;
    return info.weekend ? primary === 'gregorian' ? 'Weekend' : 'جمعه · تعطیل هفتگی' : '';
}
