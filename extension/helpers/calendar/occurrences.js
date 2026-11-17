import ICal from 'gi://ICalGLib?version=3.0';
import ECal from 'gi://ECal?version=2.0';
import {validateMeetUri} from '../../services/calendar-events-model.js';

const PK = ICal.PropertyKind, PT = ICal.ParameterKind;
const date = time => `${String(time.get_year()).padStart(4,'0')}-${String(time.get_month()).padStart(2,'0')}-${String(time.get_day()).padStart(2,'0')}`;
export const builtinZone = id => ICal.Timezone.get_builtin_timezone(id) || ICal.Timezone.get_builtin_timezone_from_tzid(id);
const props = function* (component, kind) {
    for (let p = component.get_first_property(kind); p; p = component.get_next_property(kind)) yield p;
};
export function timezoneIds(component) {
    const ids = new Set();
    for (const property of props(component, PK.ANY_PROPERTY)) {
        const parameter = property.get_first_parameter(PT.TZID_PARAMETER);
        if (parameter) ids.add(parameter.get_tzid());
    }
    return [...ids];
}

// Expansion is pure libical CPU work in the helper, using already-resolved
// zones. ECal's asynchronous instance API has no GJS completion callback in
// 3.52; it cannot prove an empty range is complete. No sync EDS/network API is
// used here. Parent deadlines bound a pathological recurrence that never yields.
export function expandSeries(components, range, {sourceUid, zone, zones, email = '', cancel = null, limit = 500}) {
    const records = new Map(), overrides = new Map();
    let incomplete = false, callbacks = 0;
    const resolveZone = id => zones.get(id) || builtinZone(id);
    const seconds = time => time.as_timet_with_zone(time.get_timezone() || zone);
    const rid = time => time.is_date() ? date(time) : String(seconds(time));
    const utc = ICal.Timezone.get_utc_timezone();
    const time = ms => ICal.Time.new_from_timet_with_zone(Math.floor(ms / 1000), false, utc);
    const read = (component, start, end, recurrenceId) => {
        const status = component.get_first_property(PK.STATUS_PROPERTY)?.get_status() === ICal.PropertyStatus.CANCELLED ? 'cancelled' : 'confirmed';
        let selfResponse = 'unknown';
        for (const p of props(component, PK.ATTENDEE_PROPERTY)) {
            if (email && p.get_attendee()?.replace(/^mailto:/i,'').toLowerCase() === email.toLowerCase()) {
                const response = p.get_first_parameter(PT.PARTSTAT_PARAMETER)?.get_partstat();
                if (response === ICal.ParameterPartstat.DECLINED) selfResponse = 'declined';
            }
        }
        let joinUri = validateMeetUri(component.get_first_property(PK.URL_PROPERTY)?.get_url());
        for (const p of props(component, PK.X_PROPERTY))
            if (p.get_x_name()?.toUpperCase() === 'X-GOOGLE-CONFERENCE') joinUri ||= validateMeetUri(p.get_x());
        const allDay = Boolean(component.get_dtstart().is_date());
        const item = {sourceUid, uid:component.get_uid(), recurrenceId,
            title:component.get_summary() || '', location:component.get_location() || '',
            allDay, status, selfResponse, joinUri, timezone:zone.get_tzid() || ''};
        return allDay ? {...item, startDate:date(start), endDateExclusive:date(end)}
            : {...item, startMs:seconds(start) * 1000, endMs:seconds(end) * 1000};
    };
    for (const component of components) {
        const recurrence = component.get_first_property(PK.RECURRENCEID_PROPERTY);
        if (recurrence) {
            const parameter = recurrence.get_first_parameter(PT.RANGE_PARAMETER);
            // Don't display obsolete original slots for an unsupported range override.
            if (parameter) return {occurrences:[],incomplete:true};
            const original = recurrence.get_recurrenceid();
            const tzid = recurrence.get_first_parameter(PT.TZID_PARAMETER)?.get_tzid();
            if (tzid) original.set_timezone(resolveZone(tzid));
            overrides.set(rid(original), component);
        }
    }
    for (const component of components) {
        if (component.get_first_property(PK.RECURRENCEID_PROPERTY)) continue;
        const recurring = Boolean(component.get_first_property(PK.RRULE_PROPERTY) || component.get_first_property(PK.RDATE_PROPERTY));
        ECal.recur_generate_instances_sync(component, time(range.startMs), time(range.endMs), (_comp, start, end) => {
            if (++callbacks > limit || cancel?.is_cancelled()) { incomplete = true; return false; }
            const key = recurring ? rid(start) : '';
            if (!overrides.has(key)) records.set(key, read(component, start, end, key));
            return true;
        }, resolveZone, zone, cancel);
    }
    for (const [key, component] of overrides) {
        if (component.get_first_property(PK.STATUS_PROPERTY)?.get_status() === ICal.PropertyStatus.CANCELLED) continue;
        if (++callbacks > limit) { incomplete = true; break; }
        ECal.recur_generate_instances_sync(component, time(range.startMs), time(range.endMs), (_comp, start, end) => {
            records.set(key, read(component, start, end, key)); return false;
        }, resolveZone, zone, cancel);
    }
    return {occurrences:[...records.values()], incomplete};
}
