import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {calendarEventPreferences} from './calendar-events-prefs.js';
import {CALENDARS, migrateCalendarSettings, migrateNotchDates, DATE_PRESETS, DATE_TOKENS, dateFormatError, dateOrder, formatNotchDate, notchDates, todayDay} from '../services/calendar-model.js';

export function notchDatePreferences(settings, window) {
    migrateCalendarSettings(settings);
    migrateNotchDates(settings);
    const group = new Adw.PreferencesGroup({title: 'Dates in the notch',
        description: 'Show one or several calendars, in left-to-right order. Expand a calendar to change its format.'});
    const enabled = new Adw.SwitchRow({title: 'Show date in notch'});
    settings.bind('pill-show-date', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
    const preview = new Adw.ActionRow({title: 'Date preview', use_markup: false,
        subtitle_lines: 0});
    group.add(enabled); group.add(preview);
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
    list.add_css_class('boxed-list'); group.add(list);
    const ids = Object.keys(CALENDARS), rows = new Map();
    const numeralIds = ['auto', 'persian', 'latin'];
    const readMap = key => settings.get_value(key).deepUnpack();
    const writeMap = (key, id, value) => settings.set_value(key,
        new GLib.Variant('a{ss}', {...readMap(key), [id]: value}));
    let syncing = false, arranged = '';
    const move = (id, step) => {
        const order = dateOrder(settings.get_strv('pill-date-order'));
        const index = order.indexOf(id), target = index + step;
        if (target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        settings.set_strv('pill-date-order', order);
        // Keep keyboard focus in the moved row, including when its arrow now disables.
        const item = rows.get(id), arrow = step < 0 ? item.up : item.down;
        (arrow.sensitive ? arrow : item.row).grab_focus();
    };
    for (const id of ids) {
        const name = CALENDARS[id].name;
        const row = new Adw.ExpanderRow({title: CALENDARS[id].title, use_markup: false});
        const shown = new Gtk.Switch({valign: Gtk.Align.CENTER,
            tooltip_text: `Show ${name} in notch`});
        shown.update_property([Gtk.AccessibleProperty.LABEL], [`Show ${name} in notch`]);
        row.add_prefix(shown);
        const arrows = new Gtk.Box({spacing: 0, valign: Gtk.Align.CENTER});
        arrows.add_css_class('linked');
        const up = new Gtk.Button({icon_name: 'go-up-symbolic', tooltip_text: `Move ${name} earlier`});
        const down = new Gtk.Button({icon_name: 'go-down-symbolic', tooltip_text: `Move ${name} later`});
        up.connect('clicked', () => move(id, -1)); down.connect('clicked', () => move(id, 1));
        arrows.append(up); arrows.append(down); row.add_suffix(arrows);
        const preset = new Adw.ComboRow({title: 'Format',
            model: Gtk.StringList.new([...DATE_PRESETS.map(item => item.name), 'Custom'])});
        const custom = new Adw.EntryRow({title: 'Custom format', show_apply_button: true});
        const error = new Adw.ActionRow({title: 'Format needs attention', use_markup: false,
            subtitle_lines: 0, visible: false});
        error.add_css_class('error');
        const numerals = new Adw.ComboRow({title: 'Numerals',
            model: Gtk.StringList.new(['Calendar default', 'Persian · ۰۱۲۳', 'Latin · 0123'])});
        row.add_row(preset); row.add_row(custom); row.add_row(error); row.add_row(numerals);
        const shortMonth = id !== 'gregorian' ? new Adw.SwitchRow({title: 'Short English month names'}) : null;
        if (shortMonth) {
            row.add_row(shortMonth);
            shortMonth.connect('notify::active', () => {
                if (syncing) return;
                const selected = new Set(settings.get_strv('pill-date-short-months'));
                if (shortMonth.active) selected.add(id); else selected.delete(id);
                settings.set_strv('pill-date-short-months', [...selected]);
            });
        }
        if (id === 'hijri') row.add_row(new Adw.ActionRow({title: 'Calculated Hijri dates',
            subtitle: 'Local moon-sighting dates may differ.'}));
        list.append(row);
        const item = {row, shown, up, down, preset, custom, error, numerals, shortMonth, editing: false};
        rows.set(id, item);
        shown.connect('notify::active', () => {
            if (syncing) return;
            const selected = new Set(settings.get_strv('pill-date-calendars'));
            if (shown.active) selected.add(id); else selected.delete(id);
            settings.set_strv('pill-date-calendars', ids.filter(key => selected.has(key)));
        });
        preset.connect('notify::selected', () => {
            if (syncing) return;
            item.editing = preset.selected === DATE_PRESETS.length;
            custom.visible = item.editing;
            if (!item.editing) {
                error.visible = false;
                writeMap('pill-date-formats', id, DATE_PRESETS[preset.selected].pattern);
            }
        });
        custom.connect('changed', () => {
            if (syncing) return;
            const message = dateFormatError(custom.text);
            error.visible = Boolean(message); error.subtitle = message;
            if (message) custom.add_css_class('error'); else custom.remove_css_class('error');
            // Preview drafts immediately; save only on Apply, keeping invalid
            // or unfinished edits out of the running Shell's date display.
            row.subtitle = message ? 'The saved format is still in use.' :
                formatNotchDate(todayDay(), id, custom.text, readMap('pill-date-digits')[id], settings.get_boolean('calendar-use-calendar-language'), settings.get_strv('pill-date-short-months').includes(id));
        });
        custom.connect('apply', () => {
            if (dateFormatError(custom.text)) return;
            writeMap('pill-date-formats', id, custom.text);
        });
        numerals.connect('notify::selected', () => {
            if (!syncing) writeMap('pill-date-digits', id, numeralIds[numerals.selected]);
        });
    }
    const help = new Adw.ExpanderRow({title: 'Format codes',
        subtitle: 'Same date codes as Persian Calendar. Add your own separators or text.'});
    for (const [code, title] of DATE_TOKENS) help.add_row(new Adw.ActionRow({title, subtitle: code}));
    list.append(help);
    list.append(new Adw.ActionRow({title: 'Long dates', subtitle:
        'Long formats shorten to fit the notch. Hover over the dates, or focus the notch, to read them in full.'}));
    const sync = () => {
        syncing = true;
        const calendars = settings.get_strv('pill-date-calendars');
        const order = dateOrder(settings.get_strv('pill-date-order'));
        const formats = readMap('pill-date-formats'), digits = readMap('pill-date-digits');
        const calendarLanguage = settings.get_boolean('calendar-use-calendar-language');
        const shortMonths = settings.get_strv('pill-date-short-months');
        const entries = notchDates(todayDay(), {calendars, order, formats, digits, calendarLanguage, shortMonths});
        preview.subtitle = enabled.active ? entries.length ? `\u200e${entries.map(entry => `\u2068${entry.text}\u2069`).join('  ·  ')}` : 'Choose at least one calendar below.' : 'Date display is off.';
        if (arranged !== order.join(',')) {
            const focus = window.get_focus();
            for (const [index, id] of order.entries()) {
                const row = rows.get(id).row;
                if (row.get_parent()) list.remove(row);
                list.insert(row, index);
            }
            arranged = order.join(',');
            if (focus?.get_root()) focus.grab_focus();
        }
        for (const [id, item] of rows) {
            const pattern = formats[id] ?? '%d %mm';
            item.row.sensitive = enabled.active;
            item.shown.active = calendars.includes(id);
            item.up.sensitive = order.indexOf(id) > 0;
            item.down.sensitive = order.indexOf(id) < order.length - 1;
            const index = DATE_PRESETS.findIndex(preset => preset.pattern === pattern);
            item.preset.selected = item.editing || index < 0 ? DATE_PRESETS.length : index;
            item.custom.visible = item.preset.selected === DATE_PRESETS.length;
            // Unrelated changes (order, enabled calendars, numerals) preserve an
            // unfinished custom draft and the cursor in its editor.
            if (item.savedPattern !== pattern) {
                item.savedPattern = pattern;
                item.custom.text = pattern;
                item.error.visible = false; item.custom.remove_css_class('error');
            }
            item.numerals.selected = Math.max(0, numeralIds.indexOf(digits[id] ?? 'auto'));
            item.numerals.sensitive = calendarLanguage;
            item.numerals.subtitle = calendarLanguage ? '' : 'English date display uses Latin digits.';
            if (item.shortMonth) {
                item.shortMonth.active = shortMonths.includes(id);
                item.shortMonth.sensitive = !calendarLanguage;
                item.shortMonth.subtitle = calendarLanguage ? 'Turn off “Use calendar language” in Calendar settings to use English abbreviations.'
                    : id === 'jalali' ? 'Farvardin → Far · Esfand → Esf' : 'Muharram → Muh · Rabi I → Rab I';
            }
            item.row.subtitle = formatNotchDate(todayDay(), id, pattern, digits[id], calendarLanguage, shortMonths.includes(id));
        }
        syncing = false;
    };
    enabled.connect('notify::active', sync);
    const signals = ['pill-date-calendars', 'pill-date-order', 'pill-date-formats', 'pill-date-digits', 'pill-date-short-months', 'calendar-use-calendar-language']
        .map(key => settings.connect(`changed::${key}`, sync));
    window.connect('close-request', () => { signals.forEach(id => settings.disconnect(id)); return false; });
    sync();
    return group;
}

export function calendarPreferences(settings, window) {
    migrateCalendarSettings(settings);
    const ids = Object.keys(CALENDARS);
    const group = new Adw.PreferencesGroup({title: 'Calendar display',
        description: 'Changes apply immediately. The month grid always shows one calendar.'});
    const primary = new Adw.ComboRow({title: 'Main calendar',
        model: Gtk.StringList.new(ids.map(id => CALENDARS[id].title))});
    group.add(primary);
    const language = new Adw.SwitchRow({title: 'Use calendar language',
        subtitle: 'Turn off for English date text and Latin digits in the Calendar tab and notch.'});
    settings.bind('calendar-use-calendar-language', language, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(language);
    const holidays = new Adw.SwitchRow({title: 'Show holidays and observances',
        subtitle: 'Show holiday notes and Google holiday-calendar events. Personal events stay visible.'});
    settings.bind('calendar-show-holidays', holidays, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(holidays);
    const titleSize = new Gtk.Adjustment({lower: 8, upper: 14, step_increment: 1, page_increment: 1});
    settings.bind('calendar-event-title-size', titleSize, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(new Adw.SpinRow({title: 'Event title font size',
        subtitle: 'pt · Smaller text shows more of each event title', adjustment: titleSize}));
    const extra = new Adw.PreferencesGroup({title: 'Additional dates',
        description: 'Show these calendars alongside the selected date in the header.'});
    let syncing = false;
    const switches = new Map(ids.map(id => {
        const control = new Adw.SwitchRow({title: CALENDARS[id].title});
        control.connect('notify::active', () => {
            if (syncing) return;
            const selected = new Set(settings.get_strv('calendar-additional'));
            if (control.active) selected.add(id); else selected.delete(id);
            settings.set_strv('calendar-additional', ids.filter(item => selected.has(item)));
        });
        extra.add(control); return [id, control];
    }));
    const sync = () => {
        syncing = true;
        const main = settings.get_string('calendar-primary');
        primary.selected = Math.max(0, ids.indexOf(main));
        const additional = settings.get_strv('calendar-additional');
        for (const [id, control] of switches) {
            control.visible = id !== main;
            control.active = additional.includes(id);
        }
        syncing = false;
    };
    primary.connect('notify::selected', () => {
        if (!syncing) settings.set_string('calendar-primary', ids[primary.selected]);
    });
    const signals = ['calendar-primary', 'calendar-additional'].map(key => settings.connect(`changed::${key}`, sync));
    window.connect('close-request', () => { signals.forEach(id => settings.disconnect(id)); return false; });
    sync();
    return [group, extra, calendarEventPreferences(settings,window)];
}
