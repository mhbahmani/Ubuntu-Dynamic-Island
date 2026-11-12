// Civil days are UTC day numbers, independent of DST. Only todayDay reads the
// desktop's local time zone. ICU (already in GJS) supplies calendar conversions.
const DAY = 86400000;
export const CALENDARS = Object.freeze({
    jalali: {calendar: 'persian', name: 'Jalali', title: 'Jalali · شمسی'},
    gregorian: {calendar: 'gregory', name: 'Gregorian', title: 'Gregorian · میلادی'},
    hijri: {calendar: 'islamic-civil', name: 'Hijri', title: 'Hijri · قمری'},
});
const formatters = new Map();
function formatter(calendar, options, locale = calendar === 'gregory' ? 'en-GB' : 'fa-IR') {
    const key = JSON.stringify([calendar, options, locale]);
    if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale,
        {...options, calendar, timeZone: 'UTC'}));
    return formatters.get(key);
}
export const calendarTodayLabel = id => ({jalali:'امروز', gregorian:'Today', hijri:'اليوم'}[id] ?? 'امروز');
export const primaryCalendar = id => CALENDARS[id]?.calendar ?? 'persian';
export const shownCalendars = (primary, additional = []) => [...new Set([primary, ...additional])].filter(id => Object.hasOwn(CALENDARS, id));
export function migrateCalendarSettings(settings) {
    const legacy = settings.get_user_value('calendar-mode');
    if (!legacy) return;
    const mode = settings.get_string('calendar-mode');
    if (!settings.get_user_value('calendar-primary'))
        settings.set_string('calendar-primary', mode === 'gregorian' ? 'gregorian' : 'jalali');
    if (!settings.get_user_value('calendar-additional'))
        settings.set_strv('calendar-additional', mode === 'both' ? ['gregorian'] : []);
    settings.reset('calendar-mode');
}
export const todayDay = (now = new Date()) => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
export const civilDay = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / DAY);
export const weekday = day => new Date(day * DAY).getUTCDay();
export function dateParts(day, calendar) {
    const parts = formatter(calendar, {year: 'numeric', month: 'numeric', day: 'numeric'}, 'en-US')
        .formatToParts(new Date(day * DAY));
    return Object.fromEntries(parts.filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => [p.type, Number(p.value)]));
}
export function monthBounds(day, calendar) {
    const start = day - dateParts(day, calendar).day + 1;
    const probe = start + 32;
    const end = probe - dateParts(probe, calendar).day;
    return {start, end};
}
export function shiftMonths(day, calendar, amount) {
    const date = dateParts(day, calendar);
    let bounds = monthBounds(day, calendar);
    for (let i = 0; i < Math.abs(amount); i++)
        bounds = monthBounds(amount > 0 ? bounds.end + 1 : bounds.start - 1, calendar);
    return Math.min(bounds.start + date.day - 1, bounds.end);
}
export function monthGrid(day, primary) {
    const calendar = primaryCalendar(primary);
    const {start, end} = monthBounds(day, calendar);
    const weekStart = primary === 'gregorian' ? 1 : 6;
    const first = start - (weekday(start) - weekStart + 7) % 7;
    const length = Math.ceil((end - first + 1) / 7) * 7;
    return Array.from({length}, (_, i) => ({day: first + i,
        inMonth: first + i >= start && first + i <= end,
        primary: dateParts(first + i, calendar).day}));
}
export function dateTitle(day, calendar) {
    return formatter(calendar, {day: 'numeric', month: 'long', year: 'numeric'}).format(new Date(day * DAY));
}
export function monthTitle(day, calendar) {
    return formatter(calendar, {month: 'long', year: 'numeric'}).format(new Date(day * DAY));
}
export function fullDate(day, calendar, weekday = 'short') {
    const date = new Date(day * DAY);
    const format = formatter(calendar, {weekday, day: 'numeric', month: 'long', year: 'numeric'});
    if (weekday === 'long' && calendar !== 'gregory') {
        const parts = Object.fromEntries(format.formatToParts(date).map(part => [part.type, part.value]));
        return `${parts.weekday}، ${parts.day} ${parts.month} ${parts.year}`;
    }
    return format.format(date);
}
export function numericDate(day, calendar) {
    const p = dateParts(day, calendar);
    return `${p.year}/${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')}`;
}
export const persianDigits = number => String(number).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
export function displayDate(day, id) {
    if (id === 'hijri') return `${persianDigits(numericDate(day, primaryCalendar(id)))} ق`;
    return formatter(primaryCalendar(id), {day: 'numeric', month: 'short', year: 'numeric'}).format(new Date(day * DAY));
}

// A month name avoids ambiguous numeric month/day order in the narrow notch.
// Keep the complete date (including the year) in its accessible description.
export function notchDate(day, choice = 'main', main = 'jalali') {
    const requested = choice === 'main' ? main : choice;
    const id = Object.hasOwn(CALENDARS, requested) ? requested : 'jalali';
    const calendar = primaryCalendar(id);
    return {
        text: formatter(calendar, {day: 'numeric', month: 'short'}).format(new Date(day * DAY)),
        description: `${CALENDARS[id].name}: ${fullDate(day, calendar)}${id === 'hijri' ? ' (calculated)' : ''}`,
        rtl: id !== 'gregorian',
    };
}

// Compatible date tokens with the Persian Calendar extension; conversion and
// formatting use our existing ICU model, with no external code or dependency.
export const DATE_PRESETS = [
    {name: 'Day & month', pattern: '%d %mm'},
    {name: 'Day / month', pattern: '%D/%M'},
    {name: 'Year / month / day', pattern: '%Y/%M/%D'},
    {name: 'Full date', pattern: '%d %MM %Y'},
    {name: 'Weekday & date', pattern: '%ww %d %mm'},
];
export const DATE_TOKENS = [
    ['%Y', 'Four-digit year'], ['%y', 'Two-digit year'],
    ['%MM', 'Full month name'], ['%mm', 'Short month name'],
    ['%M', 'Padded month'], ['%m', 'Month number'],
    ['%D', 'Padded day'], ['%d', 'Day number'],
    ['%WW', 'Full weekday'], ['%ww', 'Short weekday'], ['%w', 'One-letter weekday'], ['%%', 'Percent sign'],
];
const dateToken = /%(?:MM|mm|WW|ww|[YyMmDdWw%]|.)|%$/gu;
export function dateFormatError(pattern) {
    if (typeof pattern !== 'string' || !pattern.trim()) return 'Enter a date format.';
    if (Array.from(pattern).length > 80) return 'Use at most 80 characters.';
    if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(pattern)) return 'Use a single line without direction-control characters.';
    const unknown = pattern.match(dateToken)?.find(token => !DATE_TOKENS.some(([known]) => known === token));
    if (unknown) return `Unknown code ${unknown}. See Format codes below.`;
    const longest = pattern.replace(dateToken, token => 'x'.repeat(
        ['%MM', '%mm', '%WW', '%ww'].includes(token) ? 20 : token === '%Y' ? 4 : token === '%%' || token === '%w' ? 1 : 2));
    if (Array.from(longest).length > 80) return 'Use fewer fields or shorter text (up to 80 displayed characters).';
    return '';
}
export const dateOrder = value => [...new Set([...(Array.isArray(value) ? value : []), ...Object.keys(CALENDARS)])]
    .filter(id => Object.hasOwn(CALENDARS, id));
export function formatNotchDate(day, id, pattern = '%d %mm', digits = 'auto') {
    if (dateFormatError(pattern)) pattern = '%d %mm';
    const calendar = primaryCalendar(id), p = dateParts(day, calendar), date = new Date(day * DAY);
    const named = (part, width) => formatter(calendar, {[part]: width}).formatToParts(date).find(item => item.type === part)?.value ?? '';
    const values = {
        '%Y': String(p.year).padStart(4, '0'), '%y': String(p.year % 100).padStart(2, '0'),
        '%M': String(p.month).padStart(2, '0'), '%m': String(p.month),
        '%D': String(p.day).padStart(2, '0'), '%d': String(p.day),
        '%MM': () => named('month', 'long'), '%mm': () => named('month', 'short'),
        '%WW': () => named('weekday', 'long'), '%ww': () => named('weekday', 'short'),
        '%w': () => Array.from(named('weekday', 'long'))[0], '%%': '%',
    };
    let text = pattern.replace(dateToken, token => typeof values[token] === 'function' ? values[token]() : values[token]);
    // Only numerals change; month/weekday names retain their calendar's language.
    text = text.replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) - (digit >= '۰' ? 0x6f0 : 0x660)));
    if (digits === 'persian' || (digits !== 'latin' && id !== 'gregorian')) text = persianDigits(text);
    return text;
}
export function notchDates(day, {main = 'jalali', calendars = [main], order = [], formats = {}, digits = {}} = {}) {
    return dateOrder(order).filter(id => calendars.includes(id)).map(id => ({id,
        ...notchDate(day, id), text: formatNotchDate(day, id, formats[id], digits[id]),
    }));
}
export function migrateNotchDates(settings) {
    const legacy = settings.get_user_value('pill-date-calendar');
    const saved = settings.get_user_value('pill-date-calendars');
    const primary = settings.get_string('calendar-primary');
    const main = Object.hasOwn(CALENDARS, primary) ? primary : 'jalali';
    if (!saved) {
        const choice = legacy ? settings.get_string('pill-date-calendar') : main;
        settings.set_strv('pill-date-calendars', [Object.hasOwn(CALENDARS, choice) ? choice : main]);
    } else if (settings.get_strv('pill-date-calendars').includes('main')) {
        // Resolve the retired follow-main option once. Explicit selections,
        // including an empty selection, remain independent of the month grid.
        settings.set_strv('pill-date-calendars', [main]);
    }
    if (legacy) settings.reset('pill-date-calendar');
}
