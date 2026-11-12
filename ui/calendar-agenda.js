import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {column, label} from './widgets.js';
import {fullDate, primaryCalendar, todayDay} from '../services/calendar-model.js';
import {eventsForDay} from '../services/calendar-events-model.js';
import {CALENDAR_MESSAGES} from '../services/calendar-events.js';

const wrapped = (text, css = 'ubuntu-island-calendar-event-title') => {
    const actor = label(text,css,false); actor.x_expand = true;
    actor.clutter_text.line_wrap = true; actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return actor;
};
export const eventTime = event => event.allDay ? 'All day' : `${new Date(event.startMs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–${new Date(event.endMs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
function eventDateTime(event, primary) {
    const first = event.allDay ? Date.parse(event.startDate)/86400000 : todayDay(new Date(event.startMs));
    const last = event.allDay ? Date.parse(event.endDateExclusive)/86400000-1 : todayDay(new Date(event.endMs));
    const dates = first === last ? fullDate(first,primary) : `${fullDate(first,primary)} – ${fullDate(last,primary)}`;
    return `${dates}\n${eventTime(event)}`;
}
// A plain selected-day list inside the month view's scroll area. Stable rows
// preserve keyboard focus while events change; no separate agenda/detail page.
export class CalendarAgenda {
    constructor(actions) {
        this.actions = actions; this.rows = new Map();
        this.actor = column('ubuntu-island-calendar-agenda');
        this.heading = wrapped('', 'ubuntu-island-calendar-event-date');
        this.actor.add_child(this.heading);
        this.list = column('ubuntu-island-calendar-event-list'); this.actor.add_child(this.list);
        this.message = wrapped('', 'ubuntu-island-calendar-event-meta'); this.actor.add_child(this.message);
    }
    update(snapshot, day, primary) {
        this.day = day;
        this.heading.text = `Events · ${fullDate(day,primaryCalendar(primary))}`;
        const covered = snapshot.coverage?.some(r => r.startDay <= day && day < r.endDayExclusive);
        const agenda = eventsForDay(snapshot,day,{covered});
        this.message.text = !agenda.complete ? CALENDAR_MESSAGES[snapshot.status] || 'Calendar data is incomplete' :
            agenda.count ? '' : 'No events';
        this.message.visible = Boolean(this.message.text);
        for (const [id,item] of this.rows) if (!agenda.occurrences.some(event => event.id === id)) {
            if (item.control.contains(global.stage.get_key_focus())) this.actions.restoreFocus();
            item.control.destroy(); this.rows.delete(id);
        }
        for (const event of agenda.occurrences) {
            let item = this.rows.get(event.id);
            if (!item) {
                const control = new St.Button({style_class:'ubuntu-island-calendar-event',reactive:true,can_focus:true,x_expand:true});
                const face = column(); face.x_expand = true; face.x_align = Clutter.ActorAlign.FILL; control.set_child(face);
                const title = wrapped(''), time = wrapped('','ubuntu-island-calendar-event-meta');
                const detail = wrapped('','ubuntu-island-calendar-event-meta');
                face.add_child(title); face.add_child(time); face.add_child(detail);
                item = {control,title,time,detail,event}; this.rows.set(event.id,item); this.list.add_child(control);
                control.connect('clicked', () => this._openCalendar());
            }
            item.event = event; item.title.text = event.title || 'Untitled event';
            item.time.text = eventTime(event);
            const source = snapshot.sources?.find(source => source.uid === event.sourceUid)?.name;
            item.detail.text = [source,event.location].filter(Boolean).join(' · ');
            item.detail.visible = Boolean(item.detail.text);
            item.control.accessible_name = `${item.title.text}, ${eventDateTime(event,primaryCalendar(primary))}, ${item.detail.text}. Open in Calendar`;
        }
        if (![...this.rows.values()].some(item => item.control.contains(global.stage.get_key_focus())))
            agenda.occurrences.forEach((event,index) => this.list.set_child_at_index(this.rows.get(event.id).control,index));
    }
    async _openCalendar() {
        try { await this.actions.calendarOpen(this.day); }
        catch { this.message.text = 'Could not open the desktop calendar'; this.message.show(); }
    }
}
