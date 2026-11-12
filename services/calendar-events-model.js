// Pure policy for already-expanded EDS occurrences. No GI imports, RRULE parser,
// account access or clock/timer ownership. Timed values are instants in ms;
// date-only values are Gregorian civil dates, never midnight UTC appointments.
export const EVENT_LIMITS = Object.freeze({occurrences: 500, inputRecords: 2000,
    sources: 64, identity: 1024, title: 512, location: 1024, uri: 2048, rangeDays: 62});
const DAY = 86400000;
const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const instant = value => Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000;
const identity = value => typeof value === 'string' && value.length > 0 &&
    value.length <= EVENT_LIMITS.identity && !/[\u0000-\u001f\u007f]/u.test(value);
const plainText = (value, limit) => typeof value === 'string'
    ? Array.from(value.slice(0, limit * 2).replace(controls, ' ')).slice(0, limit).join('').trim() : '';

function dateDay(value) {
    if (typeof value !== 'string' || !/^(?!00)\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : null;
}
function dayDate(day) { return new Date(day * DAY).toISOString().slice(0, 10); }
function validDay(day) {
    return Number.isInteger(day) && day >= -683003 && day <= 2932896; // 0100–9999
}

// Only structured Google Meet room links are accepted for now. GJS has no URL
// global. This deliberately narrow grammar rejects credentials, ports, lookalike
// hosts, controls, backslashes and malformed escapes without URL normalization.
// Call again on activation; do not extract links from arbitrary event prose.
export function validateMeetUri(value) {
    if (typeof value !== 'string' || value.length > EVENT_LIMITS.uri || !/^[\x21-\x7e]+$/u.test(value)) return null;
    return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[a-f0-9]{2})*)?$/iu.test(value)
        ? value : null;
}

function normalizeOccurrence(value) {
    if (!value || !identity(value.sourceUid) || !identity(value.uid) ||
        (value.recurrenceId != null && value.recurrenceId !== '' && !identity(value.recurrenceId)) ||
        typeof value.allDay !== 'boolean') return null;
    const recurrenceId = value.recurrenceId ?? '';
    const event = {sourceUid: value.sourceUid, uid: value.uid, recurrenceId,
        id: JSON.stringify([value.sourceUid, value.uid, recurrenceId]),
        title: plainText(value.title, EVENT_LIMITS.title),
        location: plainText(value.location, EVENT_LIMITS.location), allDay: value.allDay,
        timezone: plainText(value.timezone, 128),
        status: ['confirmed', 'tentative', 'cancelled'].includes(value.status) ? value.status : 'unknown',
        selfResponse: ['accepted', 'tentative', 'declined', 'needs-action'].includes(value.selfResponse)
            ? value.selfResponse : 'unknown',
        joinUri: validateMeetUri(value.joinUri)};
    // Exact-event desktop identifiers remain adapter-owned until verified. Do
    // not pass an arbitrary provider URL/command through as an open target.
    if (event.allDay) {
        const start = dateDay(value.startDate);
        const end = value.endDateExclusive == null && start !== null
            ? start + 1 : dateDay(value.endDateExclusive);
        if (start === null || end === null || end <= start || !validDay(end)) return null;
        return {...event, startDate: dayDate(start), endDateExclusive: dayDate(end)};
    }
    const endMs = value.endMs ?? value.startMs;
    if (!instant(value.startMs) || !instant(endMs) || endMs < value.startMs) return null;
    return {...event, startMs: value.startMs, endMs};
}

function orderEvents(a, b) {
    return Number(b.allDay) - Number(a.allDay) ||
        (a.allDay ? compare(a.startDate, b.startDate) : a.startMs - b.startMs) || compare(a.id, b.id);
}

/**
 * Replace a batch of expanded occurrences, retaining only explicitly selected
 * sources. Empty selection means empty. Returns owned plain records and an
 * incomplete flag; upstream partial failures must be passed as incomplete=true.
 * Invalid records, conflicting duplicate identities and resource truncation
 * make coverage incomplete. Cancelled/declined events are intentional exclusions.
 * The EDS adapter supplies lowercase status/response names, not native enums.
 * Identity fields are rejected, never truncated. No provider markup is rendered
 * here: consumers must assign title/location as plain text, never set_markup().
 */
export function normalizeOccurrences(values, {sourceUids = [], incomplete = false} = {}) {
    if (!Array.isArray(sourceUids) || sourceUids.length > EVENT_LIMITS.sources || !sourceUids.every(identity))
        return {occurrences: [], incomplete: true};
    const selected = new Set(sourceUids);
    if (!selected.size) return {occurrences: [], incomplete: false};
    if (!Array.isArray(values)) return {occurrences: [], incomplete: true};
    incomplete = Boolean(incomplete) || values.length > EVENT_LIMITS.inputRecords;
    const events = new Map();
    for (let i = 0; i < Math.min(values.length, EVENT_LIMITS.inputRecords); i++) {
        const value = values[i];
        if (!value || !identity(value.sourceUid)) { incomplete = true; continue; }
        if (!selected.has(value.sourceUid)) continue;
        if (value.status === 'cancelled' || value.selfResponse === 'declined') continue;
        const event = normalizeOccurrence(value);
        if (!event) { incomplete = true; continue; }
        const previous = events.get(event.id);
        if (previous) {
            if (JSON.stringify(previous) !== JSON.stringify(event)) incomplete = true;
            continue;
        }
        if (events.size === EVENT_LIMITS.occurrences) { incomplete = true; continue; }
        events.set(event.id, event);
    }
    return {occurrences: [...events.values()].sort(orderEvents), incomplete};
}

/** Convert a civil day into desktop-local [startMs, endMs). Recompute after
 * timezone changes; adjacent local midnights may be 23/25 hours apart. */
export function localDayRange(day) {
    if (!validDay(day)) throw new RangeError('Invalid calendar day');
    const date = new Date(day * DAY);
    const start = new Date(0);
    start.setFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    // Set the next civil date explicitly: an entirely skipped local day must
    // have an empty range, not overlap the following day's appointments.
    const next = new Date((day + 1) * DAY);
    end.setFullYear(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
    end.setHours(0, 0, 0, 0);
    return {startMs: start.getTime(), endMs: end.getTime()};
}

/** At most two consumer ranges, with exclusive civil end days. Merge overlapping
 * or adjacent ranges; navigating years away never queries intervening months. */
export function eventQueryRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.length > 2) throw new RangeError('Invalid calendar ranges');
    const merged = [];
    for (const range of [...ranges].sort((a, b) => a?.startDay - b?.startDay)) {
        if (!range || !validDay(range.startDay) || !validDay(range.endDayExclusive) ||
            range.endDayExclusive <= range.startDay || range.endDayExclusive - range.startDay > EVENT_LIMITS.rangeDays)
            throw new RangeError('Invalid calendar range');
        const previous = merged.at(-1);
        if (previous && range.startDay <= previous.endDayExclusive)
            previous.endDayExclusive = Math.max(previous.endDayExclusive, range.endDayExclusive);
        else merged.push({startDay: range.startDay, endDayExclusive: range.endDayExclusive});
    }
    return merged.map(range => ({...range, startMs: localDayRange(range.startDay).startMs,
        endMs: localDayRange(range.endDayExclusive).startMs}));
}

/** Return a selected day's agenda. `covered` is true only when the reader has
 * completed that range for every selected source. Unknown is never empty:
 * count=null prevents callers announcing exact totals for partial data. */
export function eventsForDay(batch, day, {covered = false} = {}) {
    const {startMs, endMs} = localDayRange(day), date = dayDate(day);
    const occurrences = batch.occurrences.filter(event => event.allDay
        ? event.startDate <= date && date < event.endDateExclusive
        : startMs < endMs && (event.startMs === event.endMs
            ? event.startMs >= startMs && event.startMs < endMs
            : event.startMs < endMs && event.endMs > startMs));
    const complete = covered && !batch.incomplete;
    return {occurrences, complete, count: complete ? occurrences.length : null};
}

/** Choose ongoing events, otherwise the earliest simultaneous future starts.
 * `covered` must cover now through the lead window for every selected source.
 * Incomplete coverage cannot establish a definitive next event. A zero-length
 * event is eligible before its start only. The result carries no display text;
 * title privacy belongs to the renderer, including accessibility and tooltips. */
export function upcomingEvents(batch, {nowMs, leadMinutes = 15, covered = false} = {}) {
    if (!instant(nowMs) || ![5, 15, 30, 60].includes(leadMinutes)) throw new RangeError('Invalid upcoming window');
    if (!covered || batch.incomplete) return null;
    const timed = batch.occurrences.filter(event => !event.allDay);
    const ongoing = timed.filter(event => event.startMs <= nowMs && nowMs < event.endMs);
    if (ongoing.length) return {ongoing: true, occurrences: ongoing};
    const future = timed.filter(event => event.startMs > nowMs && event.startMs <= nowMs + leadMinutes * 60000);
    if (!future.length) return null;
    return {ongoing: false, occurrences: future.filter(event => event.startMs === future[0].startMs)};
}
