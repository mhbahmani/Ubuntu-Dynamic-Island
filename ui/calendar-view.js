import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import GLib from 'gi://GLib';
import {column, row, label, button} from './widgets.js';
import {primaryCalendar, todayDay, weekday, monthGrid, shiftMonths, dateTitle, monthTitle,
    fullDate, displayDate, persianDigits, shownCalendars, migrateCalendarSettings} from '../services/calendar-model.js';
import {calendarHolidays, holidayDescription, isCalendarWeekend} from '../services/calendar-holidays.js';
import {CalendarAgenda} from './calendar-agenda.js';
import {eventsForDay} from '../services/calendar-events-model.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERSIAN_WEEKDAYS = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];
function textButton(text, action) {
    const actor = new St.Button({label: text, style_class: 'ubuntu-island-calendar-control',
        can_focus: true, reactive: true, track_hover: true});
    actor.connect('clicked', () => { actor.grab_key_focus(); action(); });
    return actor;
}

// One date selection shared by all three calendars. The date heading and month
// controls stay outside the scrollable grid, including on small displays.
export class CalendarView {
    constructor(settings, actions) {
        this.settings = settings; this.actions = actions;
        this.displayed = this.selected = this.today = todayDay();
        migrateCalendarSettings(settings);
        this.primary = settings.get_string('calendar-primary');
        this.additional = settings.get_strv('calendar-additional');
        this.actor = column('ubuntu-island-calendar');
        this.actor.y_expand = true;
        this.actor.set_text_direction(Clutter.TextDirection.LTR);
        this.header = row('ubuntu-island-calendar-header'); this.actor.add_child(this.header);
        this.dates = column('ubuntu-island-calendar-dates');
        this.dates.x_expand = true; this.dates.y_align = Clutter.ActorAlign.CENTER;
        this.header.add_child(this.dates);
        this.title = label('', 'ubuntu-island-calendar-title', false);
        this.title.clutter_text.line_wrap = true;
        this.dates.add_child(this.title);
        // The combined date line replaces the heading when conversions are
        // shown. Larger text can wrap without clipping dates or controls.
        this.selectedDate = label('', 'ubuntu-island-calendar-selected', false);
        this.selectedDate.clutter_text.line_wrap = true;
        this.dates.add_child(this.selectedDate);
        this.holidayLabel = label('', 'ubuntu-island-calendar-holiday-label', false);
        this.holidayLabel.clutter_text.line_wrap = true;
        this.dates.add_child(this.holidayLabel);
        this.controls = row('ubuntu-island-calendar-controls');
        this.controls.y_align = Clutter.ActorAlign.START;
        this.header.add_child(this.controls);
        this.previous = button('go-previous-symbolic', 'Previous month', () => {
            this.previous.grab_key_focus(); this.moveMonth(-1);
        }, 14, 'ubuntu-island-calendar-control');
        this.next = button('go-next-symbolic', 'Next month', () => {
            this.next.grab_key_focus(); this.moveMonth(1);
        }, 14, 'ubuntu-island-calendar-control');
        this.controls.add_child(this.previous);
        this.todayButton = textButton('Today', () => this.select(todayDay()));
        this.controls.add_child(this.todayButton); this.controls.add_child(this.next);

        this.scroll = new St.ScrollView({style_class: 'ubuntu-island-calendar-scroll',
            x_expand: true, y_expand: true, overlay_scrollbars: true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.adjustment = this.scroll.get_vscroll_bar().get_adjustment();
        this.actor.add_child(this.scroll);
        this.grid = new St.Widget({style_class: 'ubuntu-island-calendar-grid',
            layout_manager: new Clutter.GridLayout({column_homogeneous: true}), x_expand: true});
        this.content = column(); this.content.add_child(this.grid); this.scroll.set_child(this.content);
        this.headings = Array.from({length: 7}, () => {
            const heading = label('', 'ubuntu-island-calendar-weekday', false);
            heading.x_align = Clutter.ActorAlign.CENTER; this.grid.add_child(heading); return heading;
        });
        this.cells = Array.from({length: 42}, () => {
            const control = new St.Button({style_class: 'ubuntu-island-calendar-day',
                reactive: true, track_hover: true, x_expand: true});
            const main = label('', 'ubuntu-island-calendar-number', false);
            const face = new St.Widget({style_class: 'ubuntu-island-calendar-date', layout_manager:new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            main.x_align = main.y_align = Clutter.ActorAlign.CENTER; face.add_child(main);
            const dot = new St.Widget({style_class:'ubuntu-island-calendar-event-dot',
                x_align:Clutter.ActorAlign.END,y_align:Clutter.ActorAlign.END,visible:false}); face.add_child(dot);
            control.set_child(face);
            const cell = {control, main, dot, day: null};
            control.connect('clicked', () => this.select(cell.day, true));
            control.connect('key-press-event', (_actor, event) => this._key(event, cell.day));
            this.grid.add_child(control); return cell;
        });
        this.eventSnapshot = {status:'disabled',occurrences:[],coverage:[],sources:[],incomplete:true};
        this.agenda = new CalendarAgenda({...actions,restoreFocus:() => this.todayButton.grab_key_focus()});
        this.content.add_child(this.agenda.actor); this.agenda.actor.hide();
        const changed = ['calendar-primary', 'calendar-additional', 'calendar-events-enabled', 'calendar-event-sources'].map(key => settings.connect(`changed::${key}`, () => {
            this.primary = settings.get_string('calendar-primary');
            this.additional = settings.get_strv('calendar-additional');
            this.render(); this.actions.relayout?.();
        }));
        const focus = global.stage.connect('notify::key-focus', () => this._revealFocus());
        this.actor.connect('style-changed', () => {
            if (!this.actor.mapped || this.layoutIdle) return;
            this.layoutIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.layoutIdle = 0; this.actions.relayout?.(); return GLib.SOURCE_REMOVE;
            });
        });
        this.actor.connect('notify::mapped', () => {
            this._stopClock();
            if (!this.actor.mapped) this.pendingEvent = null;
            if (this.actor.mapped) { this._refreshToday(); this._scheduleMidnight(); }
            this.actions.calendarRangeChanged?.();
        });
        this.actor.connect('destroy', () => {
            this._stopClock(); changed.forEach(id => settings.disconnect(id)); global.stage.disconnect(focus);
            if (this.layoutIdle) GLib.Source.remove(this.layoutIdle);
            if (this.focusIdle) GLib.Source.remove(this.focusIdle);
            this.layoutIdle = 0;
        });
        this.render();
    }

    preferredHeight(width) {
        const padding = this.actor.get_theme_node().get_vertical_padding();
        const inner = width - this.actor.get_theme_node().get_horizontal_padding();
        const spacing = this.actor.get_theme_node().get_length('spacing');
        return padding + spacing + [this.header, this.content]
            .reduce((sum, actor) => sum + actor.get_preferred_height(inner)[1], 0);
    }
    select(day, focus = false) {
        this.displayed = this.selected = day; this.render();
        this.actions.relayout?.();
        if (focus) this.cells.find(cell => cell.day === day)?.control.grab_key_focus();
    }
    moveMonth(amount) {
        // Browsing a month must not manufacture a selection on the same day
        // number. Keep the selected civil date until the user chooses another.
        this.displayed = shiftMonths(this.displayed, primaryCalendar(this.primary), amount);
        this.render(); this.actions.relayout?.();
    }
    _key(event, day) {
        const key = event.get_key_symbol(), rtl = this.primary !== 'gregorian';
        const delta = new Map([[Clutter.KEY_Left, rtl ? 1 : -1], [Clutter.KEY_Right, rtl ? -1 : 1],
            [Clutter.KEY_Up, -7], [Clutter.KEY_Down, 7]]).get(key);
        if (delta !== undefined) this.select(day + delta, true);
        else if ([Clutter.KEY_Page_Up, Clutter.KEY_Page_Down].includes(key))
            this.select(shiftMonths(day, primaryCalendar(this.primary),
                (key === Clutter.KEY_Page_Up ? -1 : 1) * (event.get_state() & Clutter.ModifierType.SHIFT_MASK ? 12 : 1)), true);
        else if (key === Clutter.KEY_Home || key === Clutter.KEY_End) {
            const offset = (weekday(day) - (rtl ? 6 : 1) + 7) % 7;
            this.select(day - offset + (key === Clutter.KEY_End ? 6 : 0), true);
        } else return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }
    render() {
        const rtl = this.primary !== 'gregorian';
        const calendar = primaryCalendar(this.primary);
        this.gridData = monthGrid(this.displayed, this.primary);
        const selectedInMonth = this.gridData.some(data => data.inMonth && data.day === this.selected);
        const focusDay = selectedInMonth ? this.selected : this.gridData.find(data => data.inMonth).day;
        const shown = shownCalendars(this.primary, this.additional).filter(id => id !== this.primary);
        this.title.text = selectedInMonth && !shown.length ? dateTitle(this.selected, calendar) : monthTitle(this.displayed, calendar);
        this.title.visible = !selectedInMonth || !shown.length;
        this.title.accessible_name = selectedInMonth ? fullDate(this.selected, calendar) : this.title.text;
        // Directional isolates keep mixed Persian/Latin dates in their own order.
        const dates = [this.primary, ...shown];
        this.selectedDate.text = dates.map(id => `\u2068${displayDate(this.selected, id).replace(/ /g, '\u00a0')}\u2069`).join(' · ');
        this.selectedDate.accessible_name = dates.map(id => fullDate(this.selected, primaryCalendar(id))).join('; ');
        this.selectedDate.visible = selectedInMonth && shown.length > 0;
        const selectedHoliday = calendarHolidays(this.selected, this.primary);
        this.holidayLabel.text = holidayDescription(selectedHoliday, this.primary);
        // Ordinary dates and weekly weekends do not add another header line.
        this.holidayLabel.visible = selectedInMonth && selectedHoliday.names.length > 0;
        const layout = this.grid.layout_manager;
        for (let i = 0; i < 7; i++) {
            const day = (i + (rtl ? 6 : 1)) % 7;
            this.headings[i].text = rtl ? PERSIAN_WEEKDAYS[day] : WEEKDAYS[day].slice(0, 2);
            this.headings[i].accessible_name = WEEKDAYS[day];
            this.headings[i].set_style_class_name(`ubuntu-island-calendar-weekday${isCalendarWeekend(day, this.primary) ? ' ubuntu-island-calendar-weekend-heading' : ''}`);
            const meta = layout.get_child_meta(this.grid, this.headings[i]);
            meta.left_attach = rtl ? 6 - i : i; meta.top_attach = 0;
        }
        this.cells.forEach((cell, i) => {
            const data = this.gridData[i];
            cell.control.visible = Boolean(data);
            cell.control.reactive = Boolean(data?.inMonth);
            cell.control.accessible_role = data?.inMonth ? Atk.Role.PUSH_BUTTON : Atk.Role.REDUNDANT_OBJECT;
            if (!data) { cell.day = null; cell.control.can_focus = false; return; }
            const meta = layout.get_child_meta(this.grid, cell.control);
            meta.left_attach = rtl ? 6 - i % 7 : i % 7; meta.top_attach = 1 + Math.floor(i / 7);
            // Keep an empty actor in each calendar slot. Hiding individual grid
            // children makes GNOME 46 redistribute homogeneous column widths.
            if (!data.inMonth) {
                cell.day = null; cell.main.text = ''; cell.control.can_focus = false;
                cell.control.accessible_name = '';
                cell.control.set_style_class_name('ubuntu-island-calendar-day ubuntu-island-calendar-blank');
                cell.control.remove_style_pseudo_class('checked');
                cell.control.remove_accessible_state(Atk.StateType.SELECTED);
                return;
            }
            cell.day = data.day;
            const selected = data.day === this.selected, today = data.day === this.today;
            const holiday = calendarHolidays(data.day, this.primary);
            const number = rtl ? persianDigits(data.primary) : String(data.primary);
            cell.main.text = number;
            cell.control.set_style_class_name(`ubuntu-island-calendar-day${selected ? ' ubuntu-island-calendar-selected-day' : ''}${today ? ' ubuntu-island-calendar-today' : ''}${holiday.holiday ? ' ubuntu-island-calendar-holiday' : ''}`);
            cell.control.can_focus = data.day === focusDay;
            if (selected) { cell.control.add_style_pseudo_class('checked'); cell.control.add_accessible_state(Atk.StateType.SELECTED); }
            else { cell.control.remove_style_pseudo_class('checked'); cell.control.remove_accessible_state(Atk.StateType.SELECTED); }
            cell.control.accessible_name = `${fullDate(data.day, calendar)}${today ? '; Today' : ''}${holiday.holiday ? `; ${holidayDescription(holiday, this.primary)}` : ''}`;
            cell.dateAccessible = cell.control.accessible_name;
        });
        this._renderEvents(); this.actions.calendarRangeChanged?.();
    }
    eventRange() {
        const days = this.gridData.filter(cell => cell.inMonth);
        return {startDay:days[0].day,endDayExclusive:days.at(-1).day + 1};
    }
    setEvents(snapshot) { this.eventSnapshot = snapshot; this._renderEvents(); }
    _renderEvents() {
        if (!this.agenda) return;
        const enabled = this.settings.get_boolean('calendar-events-enabled'), snapshot = this.eventSnapshot;
        const covered = day => snapshot.coverage?.some(r => r.startDay <= day && day < r.endDayExclusive);
        for (const cell of this.cells) {
            const agenda = enabled && cell.day != null ? eventsForDay(snapshot,cell.day,{covered:covered(cell.day)}) : null;
            cell.dot.visible = Boolean(agenda?.occurrences.length);
            if (cell.day != null) cell.control.accessible_name = `${cell.dateAccessible || ''}${agenda?.count != null
                ? `; ${agenda.count} events` : agenda?.occurrences.length ? '; Events available, incomplete coverage' : ''}`;
        }
        this.agenda.actor.visible = enabled && this.settings.get_strv('calendar-event-sources').length > 0;
        if (!this.agenda.actor.visible) this.pendingEvent = null;
        this.agenda.update(snapshot,this.selected,this.primary);
        if (this.pendingEvent && this.actions.calendarFocusReady?.() && !this.focusIdle) {
            this.focusIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.focusIdle = 0; this.focusRequestedEvent(); return GLib.SOURCE_REMOVE;
            });
        }
    }
    showEvents(day = this.selected, occurrenceId = null) {
        this.pendingEvent = occurrenceId || '*';
        this.select(day);
    }
    focusRequestedEvent() {
        if (!this.pendingEvent || !this.actor.mapped || !this.actions.calendarFocusReady?.()) return false;
        const target = this.agenda.rows.get(this.pendingEvent)?.control || this.agenda.rows.values().next().value?.control;
        if (!target?.mapped || !target.has_allocation()) return false;
        target.grab_key_focus(); this._revealFocus(); this.pendingEvent = null;
        return true;
    }
    _revealFocus() {
        const target = global.stage.get_key_focus();
        const scroll = this.scroll, content = this.content;
        if (!this.actor.mapped || !target?.mapped || !content.contains(target)) return;
        const adjustment = scroll.get_vscroll_bar().get_adjustment();
        const top = scroll.get_transformed_position()[1], y = target.get_transformed_position()[1];
        const bottom = top + scroll.get_transformed_size()[1];
        const offset = y < top ? y - top : Math.max(0, y + target.height - bottom);
        if (!Number.isFinite(offset)) return; // Focus can arrive before a newly shown page is allocated.
        adjustment.value = Math.max(adjustment.lower,
            Math.min(adjustment.upper - adjustment.page_size, adjustment.value + offset));
    }
    _refreshToday() {
        const current = todayDay();
        if (this.selected === this.today) this.selected = current;
        if (this.displayed === this.today) this.displayed = current;
        this.today = current; this.render();
    }
    _scheduleMidnight() {
        const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        this.midnightTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1000, next - now + 100), () => {
            this.midnightTimer = 0; this._refreshToday(); this.actions.relayout?.();
            this._scheduleMidnight(); return GLib.SOURCE_REMOVE;
        });
    }
    _stopClock() {
        if (this.midnightTimer) GLib.Source.remove(this.midnightTimer);
        this.midnightTimer = 0;
    }
}
