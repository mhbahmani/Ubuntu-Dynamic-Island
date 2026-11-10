import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {CALENDARS} from './services/calendar-model.js';
import {label, row} from './widgets.js';

// Separate labels isolate RTL dates from their LTR neighbours. Long custom
// formats share a measured budget; their full text stays available on hover
// and keyboard focus, as well as in the notch's accessible description.
export class NotchDates {
    constructor(pill) {
        this.pill = pill;
        this.actor = row('ubuntu-island-notch-dates');
        this.actor.set_text_direction(Clutter.TextDirection.LTR);
        this.actor.reactive = true;
        this.actor.track_hover = true;
        this.items = new Map(Object.keys(CALENDARS).map(id => {
            const date = label('', 'ubuntu-island-pill-date');
            const separator = label('·', 'ubuntu-island-date-separator', false);
            this.actor.add_child(date); this.actor.add_child(separator);
            date.hide(); separator.hide();
            return [id, {date, separator}];
        }));
        this.tip = label('', 'ubuntu-island-date-tooltip', false);
        this.tip.clutter_text.line_wrap = true;
        this.tip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.tip.set_text_direction(Clutter.TextDirection.LTR);
        this.tip.hide();
        // The date actor's mapped state already tracks fullscreen. Asking the
        // layout manager to track the tooltip separately would force it visible
        // whenever a normal window appears, even without hover or focus.
        Main.layoutManager.addTopChrome(this.tip, {affectsInputRegion: false});
        this.actor.connect('notify::hover', () => this.syncTip());
        this.actor.connect('notify::mapped', () => this.syncTip());
        this.actor.connect('notify::allocation', () => this.syncTip());
        pill.connect('key-focus-in', () => this.syncTip());
        pill.connect('key-focus-out', () => this.syncTip());
        this.actor.connect('destroy', () => {
            Main.layoutManager.removeChrome(this.tip);
            this.tip.destroy();
        });
        this.entries = [];
    }

    render(entries, expanded) {
        this.entries = entries;
        this.expanded = expanded;
        for (const [id, item] of this.items) {
            const index = entries.findIndex(entry => entry.id === id);
            item.date.visible = index >= 0;
            item.separator.visible = index >= 0 && index < entries.length - 1;
            if (index < 0) continue;
            const entry = entries[index];
            item.date.text = entry.text;
            item.date.accessible_name = entry.description;
            item.date.set_text_direction(entry.rtl ? Clutter.TextDirection.RTL : Clutter.TextDirection.LTR);
        }
        entries.flatMap(entry => {
            const item = this.items.get(entry.id);
            return [item.date, item.separator];
        }).forEach((actor, index) => this.actor.set_child_at_index(actor, index));
        this.actor.visible = entries.length > 0;
        this.actor.accessible_name = entries.map(entry => `${entry.text}. ${entry.description}`).join('. ');
        this.tip.text = entries.map(entry => `${CALENDARS[entry.id].name}: \u2068${entry.text}\u2069`).join('\n');
        this.syncTip();
    }

    setBudget(budget) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const items = this.entries.map(entry => this.items.get(entry.id));
        const widths = items.map(item => item.date.clutter_text.get_preferred_width(-1)[1]);
        const separators = Math.max(0, items.length - 1) * (16 * scale +
            (items[0]?.separator.get_preferred_width(-1)[1] ?? 0));
        const available = Math.max(items.length * 24 * scale, budget - separators);
        const natural = widths.reduce((sum, width) => sum + width, 0);
        this.truncated = natural > available + 1;
        items.forEach((item, index) => {
            const width = this.truncated ? Math.floor(available * widths[index] / natural) : Math.ceil(widths[index]);
            if (item.date.width !== width) item.date.width = width;
        });
        this.syncTip();
    }

    syncTip() {
        if (!this.truncated || this.expanded || !this.actor.mapped ||
            !(this.actor.hover || this.pill.has_key_focus())) {
            this.tip.hide(); return;
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const width = Math.min(420 * scale, monitor.width - 32 * scale);
        this.tip.width = width;
        const [x, y] = this.pill.get_transformed_position();
        this.tip.set_position(Math.max(monitor.x + 8 * scale,
            Math.min(x + (this.pill.width - width) / 2, monitor.x + monitor.width - width - 8 * scale)),
        y + this.pill.height + 6 * scale);
        this.tip.show();
    }
}
