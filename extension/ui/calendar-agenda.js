import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {column, row, label} from './widgets.js';
import {fullDate, primaryCalendar, todayDay} from '../services/calendar-model.js';
import {eventsForDay, calendarColor} from '../services/calendar-events-model.js';
import {themeAccent} from '../services/appearance.js';
import {CALENDAR_MESSAGES} from '../services/calendar-events.js';
import {HoverTip} from './hover-tip.js';

const wrapped = (text, css = 'ubuntu-island-calendar-event-title') => {
    const actor = label(text,css,false); actor.x_expand = true;
    actor.clutter_text.line_wrap = true; actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return actor;
};
export const eventTime = event => event.allDay ? 'All day' : `${new Date(event.startMs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–${new Date(event.endMs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
function eventDateTime(event, primary, calendarLanguage) {
    const first = event.allDay ? Date.parse(event.startDate)/86400000 : todayDay(new Date(event.startMs));
    const last = event.allDay ? Date.parse(event.endDateExclusive)/86400000-1 : todayDay(new Date(event.endMs));
    const format = day => fullDate(day,primary,'short',calendarLanguage);
    const dates = first === last ? format(first) : `${format(first)} – ${format(last)}`;
    return `${dates}\n${eventTime(event)}`;
}
// The selected-day panel scrolls independently of the month. Stable rows retain
// keyboard focus during service updates; event activation opens the desktop app.
export class CalendarAgenda {
    constructor(actions, settings) {
        this.actions = actions; this.rows = new Map();
        this.actor = column('ubuntu-island-calendar-agenda');
        this.actor.x_expand = this.actor.y_expand = true;
        this.actor.set_text_direction(Clutter.TextDirection.LTR);
        this.header = row('ubuntu-island-calendar-day-header');
        this.heading = wrapped('', 'ubuntu-island-calendar-event-date');
        this.header.add_child(this.heading); this.actor.add_child(this.header);
        this.scroll = new St.ScrollView({x_expand:true, y_expand:true, overlay_scrollbars:true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.adjustment = this.scroll.vadjustment;
        this.titleTip = new HoverTip(this.actor, {delay: 450, motionSettings: settings, viewport: this.scroll});
        this.actor.add_child(this.scroll);
        this.content = column('ubuntu-island-calendar-event-list'); this.scroll.set_child(this.content);
        this.holiday = wrapped('', 'ubuntu-island-calendar-holiday-label'); this.content.add_child(this.holiday);
        this.list = column('ubuntu-island-calendar-event-list');
        this.list.y_expand = false; this.list.y_align = Clutter.ActorAlign.START;
        this.content.add_child(this.list);
        this.message = wrapped('', 'ubuntu-island-calendar-event-meta'); this.content.add_child(this.message);
    }
    update(snapshot, day, primary, theme = 'graphite', titleSize = 9, calendarLanguage = true) {
        this.titleTip.setTheme(theme);
        this.day = day;
        this.heading.text = fullDate(day,primaryCalendar(primary),'long',calendarLanguage);
        const direction = primary === 'gregorian' || !calendarLanguage ? Clutter.TextDirection.LTR : Clutter.TextDirection.RTL;
        this.heading.set_text_direction(direction); this.holiday.set_text_direction(direction);
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
                const control = new St.Button({style_class:'ubuntu-island-calendar-event',reactive:true,can_focus:true,
                    track_hover:true,x_expand:true,y_expand:false,y_align:Clutter.ActorAlign.START});
                const card = row('ubuntu-island-calendar-event-card');
                card.x_expand = true; card.x_align = Clutter.ActorAlign.FILL;
                card.set_text_direction(Clutter.TextDirection.LTR);
                control.set_child(card);
                const accent = new St.Widget({style_class:'ubuntu-island-calendar-event-accent', y_expand:true});
                card.add_child(accent);
                const face = column(); face.x_expand = true; card.add_child(face);
                const title = label('','ubuntu-island-calendar-event-title');
                const time = label('','ubuntu-island-calendar-event-meta');
                title.x_expand = time.x_expand = true;
                title.clutter_text.single_line_mode = time.clutter_text.single_line_mode = true;
                face.add_child(title); face.add_child(time);
                item = {control,title,time,accent,event}; this.rows.set(event.id,item); this.list.add_child(control);
                this.titleTip.addTarget(control, () => title.clutter_text.get_layout().is_ellipsized() ? title.text : '');
                control.connect('clicked', () => this._openCalendar());
            }
            item.event = event; item.title.text = event.title || 'Untitled event';
            if (item.titleSize !== titleSize) {
                item.title.set_style(`font-size: ${titleSize}pt;`); item.titleSize = titleSize;
            }
            item.time.text = eventTime(event);
            const source = snapshot.sources?.find(source => source.uid === event.sourceUid);
            const color = calendarColor(source?.color) || themeAccent(theme);
            if (item.color !== color) {
                item.accent.set_style(`background-color: ${color};`); item.color = color;
            }
            const detail = [source?.name,event.location].filter(Boolean).join(' · ');
            item.control.accessible_name = `${item.title.text}, ${eventDateTime(event,primaryCalendar(primary),calendarLanguage)}, ${detail}. Open in Calendar`;
        }
        agenda.occurrences.forEach((event,index) => this.list.set_child_at_index(this.rows.get(event.id).control,index));
        this.titleTip.refresh();
    }
    async _openCalendar() {
        try { await this.actions.calendarOpen(this.day); }
        catch { this.message.text = 'Could not open the desktop calendar'; this.message.show(); }
    }
}
