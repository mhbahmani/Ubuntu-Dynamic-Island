import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import {column, row, label, button} from './widgets.js';
import {primaryCalendar, todayDay, weekday, monthGrid, shiftMonths, monthTitle,
    fullDate, calendarTodayLabel, formatNotchDate, persianDigits, migrateCalendarSettings} from '../services/calendar-model.js';
import {calendarHolidays, holidayDescription, isCalendarWeekend} from '../services/calendar-holidays.js';
import {CalendarAgenda} from './calendar-agenda.js';
import {eventsForDay, visibleCalendarEvents} from '../services/calendar-events-model.js';

function textButton(text, action) {
    const actor = new St.Button({label: text, style_class: 'ubuntu-island-calendar-control',
        can_focus: true, reactive: true, track_hover: true});
    actor.connect('clicked', () => { actor.grab_key_focus(); action(); });
    return actor;
}

// One civil-date selection shared by the independent day and month panels.
export class CalendarView {
    constructor(settings, actions) {
        this.settings = settings; this.actions = actions;
        this.displayed = this.selected = this.today = todayDay();
        migrateCalendarSettings(settings);
        this.primary = settings.get_string('calendar-primary');
        this.actor = row('ubuntu-island-calendar');
        this.actor.layout_manager.homogeneous = true;
        this.actor.y_expand = true;
        this.actor.set_text_direction(Clutter.TextDirection.LTR);
        this.agenda = new CalendarAgenda({...actions,restoreFocus:() => this.todayButton.grab_key_focus()});
        this.actor.add_child(this.agenda.actor);
        this.month = column('ubuntu-island-calendar-month');
        this.month.x_expand = this.month.y_expand = true;
        this.actor.add_child(this.month);
        this.header = row('ubuntu-island-calendar-header');
        this.month.add_child(this.header);
        this.title = label('', 'ubuntu-island-calendar-title', false);
        this.title.x_expand = true;
        this.title.clutter_text.line_wrap = true;
        this.title.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.previous = button('go-previous-symbolic', 'Previous month', () => {
            this.previous.grab_key_focus(); this.moveMonth(-1);
        }, 14, 'ubuntu-island-calendar-control');
        this.next = button('go-next-symbolic', 'Next month', () => {
            this.next.grab_key_focus(); this.moveMonth(1);
        }, 14, 'ubuntu-island-calendar-control');
        this.header.add_child(this.previous);
        this.header.add_child(this.title);
        this.header.add_child(this.next);
        this.todayButton = textButton('', () => this.select(todayDay()));
        this.todayButton.y_align = Clutter.ActorAlign.START;
        this.agenda.header.add_child(this.todayButton);

        this.scroll = new St.ScrollView({style_class: 'ubuntu-island-calendar-scroll',
            x_expand: true, y_expand: true, overlay_scrollbars: true});
        this.scroll.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.AUTOMATIC);
        this.adjustment = this.scroll.get_vscroll_bar().get_adjustment();
        this.month.add_child(this.scroll);
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
            const face = column('ubuntu-island-calendar-date');
            face.x_expand = true;
            main.x_align = main.y_align = Clutter.ActorAlign.CENTER; face.add_child(main);
            const indicator = new St.Widget({style_class:'ubuntu-island-calendar-event-indicator',
                x_align:Clutter.ActorAlign.CENTER, opacity:0}); face.add_child(indicator);
            control.set_child(face);
            const cell = {control, main, indicator, day: null};
            control.connect('clicked', () => this.select(cell.day, true));
            control.connect('key-press-event', (_actor, event) => this._key(event, cell.day));
            this.grid.add_child(control); return cell;
        });
        this.eventSnapshot = {status:'disabled',occurrences:[],coverage:[],sources:[],incomplete:true};
        const changed = ['calendar-primary', 'calendar-use-calendar-language', 'calendar-events-enabled', 'calendar-event-sources', 'calendar-show-holidays', 'calendar-event-title-size', 'color-theme'].map(key => settings.connect(`changed::${key}`, () => {
            this.primary = settings.get_string('calendar-primary');
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

    resetToToday() {
        this.pendingEvent = null;
        this.today = todayDay();
        this.adjustment.value = this.agenda.adjustment.value = 0;
        this.select(this.today);
    }
    select(day, focus = false) {
        if (day == null) return;
        if (day !== this.selected) this.agenda.adjustment.value = 0;
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
        const calendarLanguage = this.settings.get_boolean('calendar-use-calendar-language');
        const nativeText = rtl && calendarLanguage;
        const calendar = primaryCalendar(this.primary);
        this.gridData = monthGrid(this.displayed, this.primary);
        const selectedInMonth = this.gridData.some(data => data.inMonth && data.day === this.selected);
        const focusDay = selectedInMonth ? this.selected : this.gridData.find(data => data.inMonth).day;
        this.todayButton.label = calendarTodayLabel(this.primary, calendarLanguage);
        this.todayButton.accessible_name = this.todayButton.label;
        this.todayButton.set_text_direction(nativeText ? Clutter.TextDirection.RTL : Clutter.TextDirection.LTR);
        this.title.text = monthTitle(this.displayed, calendar, calendarLanguage);
        this.title.accessible_name = this.title.text;
        this.title.set_text_direction(nativeText ? Clutter.TextDirection.RTL : Clutter.TextDirection.LTR);
        const selectedHoliday = calendarHolidays(this.selected, this.primary);
        const showHolidays = this.settings.get_boolean('calendar-show-holidays');
        this.agenda.holiday.text = showHolidays ? holidayDescription(selectedHoliday, this.primary, calendarLanguage) : '';
        this.agenda.holiday.visible = showHolidays && selectedHoliday.names.length > 0;
        const layout = this.grid.layout_manager;
        for (let i = 0; i < 7; i++) {
            const day = (i + (rtl ? 6 : 1)) % 7;
            const date = this.displayed + day - weekday(this.displayed);
            this.headings[i].text = formatNotchDate(date, this.primary, nativeText ? '%w' : '%ww', 'auto', calendarLanguage).slice(0, nativeText ? 1 : 2);
            this.headings[i].accessible_name = formatNotchDate(date, this.primary, '%WW', 'auto', calendarLanguage);
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
            const number = nativeText ? persianDigits(data.primary) : String(data.primary);
            cell.main.text = number;
            cell.control.set_style_class_name(`ubuntu-island-calendar-day${selected ? ' ubuntu-island-calendar-selected-day' : ''}${today ? ' ubuntu-island-calendar-today' : ''}${holiday.holiday ? ' ubuntu-island-calendar-holiday' : ''}`);
            cell.control.can_focus = data.day === focusDay;
            if (selected) { cell.control.add_style_pseudo_class('checked'); cell.control.add_accessible_state(Atk.StateType.SELECTED); }
            else { cell.control.remove_style_pseudo_class('checked'); cell.control.remove_accessible_state(Atk.StateType.SELECTED); }
            cell.control.accessible_name = `${fullDate(data.day, calendar, 'short', calendarLanguage)}${today ? `; ${calendarTodayLabel(this.primary, calendarLanguage)}` : ''}${holiday.holiday && showHolidays ? `; ${holidayDescription(holiday, this.primary, calendarLanguage)}` : ''}`;
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
        const enabled = this.settings.get_boolean('calendar-events-enabled');
        const snapshot = visibleCalendarEvents(this.eventSnapshot, this.settings.get_boolean('calendar-show-holidays'));
        const configured = enabled && this.settings.get_strv('calendar-event-sources').length > 0;
        const covered = day => snapshot.coverage?.some(r => r.startDay <= day && day < r.endDayExclusive);
        for (const cell of this.cells) {
            const agenda = configured && cell.day != null ? eventsForDay(snapshot,cell.day,{covered:covered(cell.day)}) : null;
            cell.indicator.opacity = agenda?.occurrences.length ? 255 : 0;
            if (cell.day != null) cell.control.accessible_name = `${cell.dateAccessible || ''}${agenda?.count != null
                ? `; ${agenda.count} events` : agenda?.occurrences.length ? '; Events available, incomplete coverage' : ''}`;
        }
        if (!configured) this.pendingEvent = null;
        this.agenda.update(configured ? snapshot : {status:'ready', occurrences:[],
            coverage:[{startDay:this.selected,endDayExclusive:this.selected + 1}], incomplete:false},
        this.selected,this.primary,this.settings.get_string('color-theme'),this.settings.get_int('calendar-event-title-size'),
        this.settings.get_boolean('calendar-use-calendar-language'));
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
        if (!this.actor.mapped || !target?.mapped) return;
        const scroll = this.agenda.actor.contains(target) ? this.agenda.scroll : this.scroll;
        if (!scroll.contains(target)) return;
        // Reveal keyboard focus in its own viewport, including horizontal overflow
        // at enlarged text sizes. The other panel keeps its scroll position.
        const position = scroll.get_transformed_position(), size = scroll.get_transformed_size();
        const targetPosition = target.get_transformed_position(), targetSize = target.get_transformed_size();
        [scroll.get_hscroll_bar(), scroll.get_vscroll_bar()].forEach((bar, axis) => {
            const adjustment = bar.get_adjustment();
            const offset = targetPosition[axis] < position[axis] ? targetPosition[axis] - position[axis] :
                Math.max(0, targetPosition[axis] + targetSize[axis] - position[axis] - size[axis]);
            if (Number.isFinite(offset)) adjustment.value = Math.max(adjustment.lower,
                Math.min(adjustment.upper - adjustment.page_size, adjustment.value + offset));
        });
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
