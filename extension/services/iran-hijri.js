// Month starts from the University of Tehran's official 1405 calendar,
// Gregorian column, pages 1–12. No network access is needed.
// https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf/64228cbb-f4de-dc32-4d2b-57db3c8e322f
// Readable mirror: https://www.scribd.com/document/990789768/Calendar-1405
const DAY = 86400000;
const starts = [
    [2026,3,21,1447,10], [2026,4,19,1447,11], [2026,5,18,1447,12],
    [2026,6,16,1448,1], [2026,7,16,1448,2], [2026,8,14,1448,3],
    [2026,9,13,1448,4], [2026,10,12,1448,5], [2026,11,11,1448,6],
    [2026,12,11,1448,7], [2027,1,10,1448,8], [2027,2,8,1448,9],
    [2027,3,10,1448,10],
].map(([y,m,d,year,month]) => ({start: Date.UTC(y,m-1,d)/DAY, year, month}));
const lastPublishedDay = Date.UTC(2027,2,20)/DAY;
const tabular = new Intl.DateTimeFormat('en-US', {
    calendar: 'islamic-civil', timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
});
export const hasPublishedHijri = day => day >= starts[0].start && day <= lastPublishedDay;
export function iranHijriParts(day) {
    if (hasPublishedHijri(day)) {
        const entry = starts.findLast(item => item.start <= day);
        return {year: entry.year, month: entry.month, day: day - entry.start + 1};
    }
    // Align the earlier tabular fallback with published Shawwal 1 so browsing
    // cannot skip or repeat a day at the boundary. Outside 1405 is approximate.
    const offset = day < starts[0].start ? -1 : 0;
    return Object.fromEntries(tabular.formatToParts(new Date((day + offset)*DAY))
        .filter(p => ['year','month','day'].includes(p.type)).map(p => [p.type, Number(p.value)]));
}
