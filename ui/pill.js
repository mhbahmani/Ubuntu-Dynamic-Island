import {agentCounts, agentSummary} from '../services/agents-model.js';
import {notchDates, todayDay} from '../services/calendar-model.js';
import {NotchDates} from './notch-dates.js';
import {agentIcon} from './agent-icon.js';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {MediaTitle} from './media-title.js';
import GLib from 'gi://GLib';
import {notchOrder, arrowSvg, weatherSymbol, commuteIndicator, connectionIndicator} from '../services/notch-model.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {weatherSceneKind, temperature} from '../services/weather-model.js';
import {icon, label, row} from './widgets.js';

// Compact notch content shown while collapsed. The St.Button gives keyboard
// focus semantics and an accessibility name for the toggle action.
export class Pill {
    constructor(onToggle, onToggleTitle, onChanged, onEvent) {
        this.actor = new St.Button({
            style_class: 'ubuntu-island-pill',
            can_focus: true,
            reactive: true,
            accessible_name: 'Open Ubuntu Island',
        });
        this.actor.connect('clicked', onToggle);
        this.actor.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 2 || !onToggleTitle) return Clutter.EVENT_PROPAGATE;
            onToggleTitle();
            return Clutter.EVENT_STOP;
        });
        const content = row('ubuntu-island-pill-content');
        content.x_expand = true;
        this.actor.set_child(content);

        this._mediaIcon = icon('audio-x-generic-symbolic', 14);
        this._mediaTitle = new MediaTitle();
        this._title = this._mediaTitle.label;
        this._bluetooth = icon('bluetooth-symbolic', 12);
        this._bluetooth.visible = false;
        this._cpuDot = new St.Widget({style_class: 'ubuntu-island-cpu-dot', y_align: Clutter.ActorAlign.CENTER});
        this._media = row('ubuntu-island-pill-media');
        this._media.add_child(this._mediaIcon);
        this._media.add_child(this._mediaTitle.actor);
        content.add_child(this._media);
        this._weather = new St.Icon({icon_size: 20});
        this._weather.visible = false;
        this._mediaIcon.add_style_class_name('ubuntu-island-pill-music');
        content.add_child(this._weather);
        this._network = new St.Widget({style_class: 'ubuntu-island-pill-network',
            layout_manager: new Clutter.BinLayout()});
        const transfers = row('ubuntu-island-pill-transfers');
        transfers.x_expand = true;
        transfers.x_align = Clutter.ActorAlign.CENTER;
        transfers.y_align = Clutter.ActorAlign.CENTER;
        this._network.add_child(transfers);
        this._network.y_align = Clutter.ActorAlign.CENTER;
        this._down = label('↓ —', 'ubuntu-island-pill-rate', false);
        this._up = label('↑ —', 'ubuntu-island-pill-rate', false);
        for (const rate of [this._down, this._up])
            rate.connect('style-changed', () => { this._networkWidthKey = null; this._queueLayout(); });
        this._arrows = [];
        for (const [rate, color] of [[this._down, 'download'], [this._up, 'upload']]) {
            const item = row('ubuntu-island-pill-transfer');
            const direction = new St.Icon({icon_size: 14});
            direction.add_style_class_name(`ubuntu-island-pill-${color}`);
            this._arrows.push(direction);
            item.add_child(direction);
            item.add_child(rate);
            transfers.add_child(item);
        }
        this._network.visible = false;
        content.add_child(this._network);
        this._commute = row('ubuntu-island-pill-commute');
        this._commute.add_child(icon('find-location-symbolic', 13));
        this._commuteValue = label('—', 'ubuntu-island-pill-rate', false);
        this._commute.add_child(this._commuteValue);
        this._commute.visible = false;
        content.add_child(this._commute);
        this._agents = row('ubuntu-island-pill-agents');
        this._agents.add_child(icon(agentIcon, 13));
        this._agentsText = label('', 'ubuntu-island-pill-rate', false);
        this._agents.add_child(this._agentsText);
        this._agents.visible = false; content.add_child(this._agents);
        this._dates = new NotchDates(this.actor);
        this._date = this._dates.actor;
        this._date.visible = false;
        content.add_child(this._date);
        this._event = new St.Button({style_class:'ubuntu-island-pill-event',can_focus:true,reactive:true});
        const eventFace = row('ubuntu-island-pill-event-face');
        eventFace.add_child(icon('x-office-calendar-symbolic',13));
        this._eventText = label('','ubuntu-island-pill-date'); eventFace.add_child(this._eventText);
        this._event.set_child(eventFace); this._event.hide(); content.add_child(this._event);
        this._event.connect('clicked', () => onEvent?.());
        this._onChanged = onChanged;
        this.actor.connect('notify::mapped', () => { this._syncDateClock(); this._queueLayout(); });
        this._date.connect('style-changed', () => this._queueLayout());
        this.actor.connect('destroy', () => {
            this._stopDateClock();
            if (this._layoutIdle) GLib.Source.remove(this._layoutIdle);
            this._layoutIdle = 0;
        });
        this._connection = row('ubuntu-island-pill-connection');
        this._connection.y_align = Clutter.ActorAlign.CENTER;
        this._connectionIcon = icon('network-wireless-disabled-symbolic', 16);
        this._connection.add_child(this._connectionIcon);
        this._connection.visible = false;
        content.add_child(this._connection);
        content.add_child(this._cpuDot);
        content.add_child(this._bluetooth);
        this._items = {media: this._media, weather: this._weather, network: this._network,
            cpu: this._cpuDot, bluetooth: this._bluetooth, commute: this._commute, agents: this._agents, date: this._date, event:this._event};
        const groups = [...Object.values(this._items), this._connection];
        for (const group of groups) {
            group.x_expand = true;
            group.x_align = Clutter.ActorAlign.CENTER;
        }
        // The configured width is a minimum. Rate slots retain only their
        // measured peak width; other groups keep their content-based sizing.
        this.actor._islandMinimumWidth = () => {
            if (!this.actor.mapped) return 0;
            this._fitNetwork();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const monitor = Main.layoutManager.primaryMonitor;
            if (this._event.visible) {
                const fixed = groups.filter(g => g.visible && ![this._media,this._date,this._event].includes(g));
                const visibleCount = groups.filter(g => g.visible).length;
                const overhead = (26 + Math.max(0,visibleCount - 1) * 12 + 19 + (this._media.visible ? 20 : 0)) * scale;
                let room = Math.max(0,(monitor?.width ?? 1000 * scale) - 32 * scale - overhead -
                    fixed.reduce((sum,g) => sum + g.get_preferred_width(-1)[1],0));
                if (this._date.visible) {
                    this._dates.setBudget(Math.min(320 * scale,room * 0.55));
                    room = Math.max(0,room - this._date.get_preferred_width(-1)[1]);
                }
                const eventWidth = Math.min(160 * scale,room * (this._title.visible ? 0.65 : 1),
                    this._eventText.clutter_text.get_preferred_width(-1)[1]);
                this._eventText.width = Math.max(0,Math.floor(eventWidth));
                this._mediaTitle.setBudget(Math.max(0,Math.min(240 * scale,room - eventWidth)));
            } else {
                if (this._date.visible) {
                    const fixed = groups.filter(g => g.visible && ![this._media, this._date].includes(g));
                    const fixedWidth = fixed.reduce((sum, g) => sum + g.get_preferred_width(-1)[1], 0);
                    const room = (monitor?.width ?? 1000 * scale) * 0.85 - fixedWidth - (100 + fixed.length * 12) * scale;
                    this._dates.setBudget(Math.max(100 * scale, Math.min(320 * scale, room)));
                }
                const others = groups.filter(g => g !== this._media && g.visible);
                const otherWidth = others.reduce((sum, g) => sum + g.get_preferred_width(-1)[1], 0) + (52 + others.length * 12) * scale;
                const maximum = Math.min(600 * scale, (monitor?.width ?? 1000 * scale) * 0.6);
                this._mediaTitle.setBudget(Math.max(20 * scale, Math.min(240 * scale, maximum - otherWidth)));
            }
            const visible = groups.filter(g => g.visible);
            return visible.reduce((sum, g) => sum + (g === this._media
                ? 14 * scale + (this._title.visible ? 6 * scale + this._mediaTitle.desiredWidth : 0)
                : g.get_preferred_width(-1)[1]), 0)
                + (26 + Math.max(0, visible.length - 1) * 12) * scale;
        };
    }

    // Pango ellipsizes against the allocated width, including scaled fonts.
    render({agents, showAgents = false, event = null, media, system, connection, offlineMode = 'icon', bluetooth, expanded, showMetrics, showTitle = true, weather, showWeather = false, showNetwork = false, units = 'celsius', order = [], arrowStyle = 'chevron', arrowAngle = 80, weatherStyle = 'colorful', commute, showCommute = false, titleMode = 'fixed', titleCharacters = 12, animations = true, showDate = false, dateOptions = {}}) {
        this._expanded = expanded;
        this._event.visible = Boolean(event && !expanded);
        this._eventText.text = event?.text || '';
        this._event.accessible_name = event?.text || 'Upcoming event';
        this._dateDay = todayDay();
        const dateKey = `${this._dateDay}:${showDate}:${expanded}:${JSON.stringify(dateOptions)}`;
        if (dateKey !== this._dateKey) {
            this._dateKey = dateKey;
            this._dates.render(showDate ? notchDates(this._dateDay, dateOptions) : [], expanded);
        }
        this._syncDateClock();
        const connectionState = connectionIndicator(connection, {order, mode: offlineMode,
            network: Boolean(showNetwork && showMetrics), weather: Boolean(showWeather && weather),
            commute: Boolean(showCommute && commute?.route)});
        this._connection.visible = connectionState.visible;
        const connectionIcon = connectionState.icon ?? 'network-wireless-disabled-symbolic';
        if (connectionIcon !== this._connectionKind) {
            this._connectionKind = connectionIcon;
            if (connectionIcon === 'unplug-symbolic') {
                const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().resolve_relative_path('assets/notch/unplug-symbolic.svg');
                this._connectionIcon.gicon = new Gio.FileIcon({file});
            } else {
                this._connectionIcon.gicon = null;
                this._connectionIcon.icon_name = connectionIcon;
            }
        }
        this._connectionIcon.icon_size = connectionState.edge ? 14 : 16;
        const available = Boolean(media?.available);
        this._media.visible = available;
        this._mediaIcon.visible = available;
        this._mediaTitle.configure(available ? String(media.title ?? '') : '', titleMode, titleCharacters, available && showTitle, expanded, animations);
        this._mediaIcon.icon_name = available
            ? (media.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic')
            : 'audio-x-generic-symbolic';
        this._bluetooth.visible = Boolean(bluetooth?.available && bluetooth.devices.some(d => d.connected));
        this._cpuDot.visible = Boolean(showMetrics && system?.cpu != null);
        this._cpuDot.set_style_class_name(
            system?.cpu == null ? 'ubuntu-island-cpu-dot'
            : system.cpu < 50 ? 'ubuntu-island-cpu-dot ubuntu-island-dot-low'
            : system.cpu < 85 ? 'ubuntu-island-cpu-dot ubuntu-island-dot-mid'
            : 'ubuntu-island-cpu-dot ubuntu-island-dot-high');
        this._weather.visible = Boolean(!connectionState.visible && showWeather && weather?.data?.current &&
            !(connectionState.hideUnavailable && (weather.stale || weather.status === 'offline' || weather.status === 'unavailable')));
        const agentTotals = agentCounts(agents?.sessions);
        this._agents.visible = Boolean(showAgents && agents?.connected && (agentTotals.working || agentTotals.attention || agentTotals.finished));
        this._agentsText.text = `${agentTotals.working}${agentTotals.attention ? ` · !${agentTotals.attention}` : agentTotals.finished && !agentTotals.working ? ` · ✓${agentTotals.finished}` : ''}`;
        this._agents.accessible_name = agentSummary(agents?.sessions);
        const current = weather?.data?.current;
        const kind = weatherSceneKind(current);
        const weatherKey = `${weatherStyle}:${kind}`;
        if (weatherKey !== this._weatherKind) {
            this._weatherKind = weatherKey;
            if (weatherStyle === 'minimal') {
                this._weather.gicon = null;
                this._weather.icon_name = weatherSymbol(kind);
                this._weather.icon_size = 14;
                this._weather.add_style_class_name('ubuntu-island-pill-weather');
            } else {
                this._weather.remove_style_class_name('ubuntu-island-pill-weather');
                this._weather.icon_size = 20;
                const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().resolve_relative_path(`assets/weather/notch/${kind}.svg`);
                this._weather.gicon = new Gio.FileIcon({file});
            }
        }
        const arrowKey = `${arrowStyle}:${arrowAngle}`;
        if (this._arrowStyle !== arrowKey) {
            this._arrowStyle = arrowKey;
            this._arrows.forEach((arrow, i) => {
                arrow.gicon = new Gio.BytesIcon({bytes: GLib.Bytes.new(new TextEncoder().encode(arrowSvg(arrowStyle, i ? 'up' : 'down', arrowAngle)))});
            });
        }
        this._weather.opacity = weather?.stale ? 140 : 255;
        this._network.visible = Boolean(!connectionState.visible && showNetwork && showMetrics && system &&
            !(connectionState.hideUnavailable && (connection === 'offline' || system.rxBytes == null || system.txBytes == null)));
        const commuteState = commuteIndicator(commute);
        this._commute.visible = !connectionState.visible && showCommute && commuteState.visible &&
            !(connectionState.hideUnavailable && (!commute.data || commuteState.stale));
        this._commuteValue.text = commuteState.text;
        this._commute.opacity = commuteState.stale ? 160 : 255;
        const compactRate = rate => String(rate ?? '—').replace(/ Ki?B\/s$/, 'K').replace(/ Mi?B\/s$/, 'M').replace(/ Gi?B\/s$/, 'G').replace(/ B\/s$/, 'B');
        const arranged = notchOrder(order);
        const key = `${arranged.join(',')}:${connectionState.anchor ?? ''}`;
        if (key !== this._orderKey) {
            this._orderKey = key;
            const children = arranged.flatMap(id => id === connectionState.anchor
                ? [this._connection, this._items[id]] : [this._items[id]]);
            if (!connectionState.visible) children.push(this._connection);
            children.forEach((child, index) => this.actor.get_child().set_child_at_index(child, index));
        }
        this._down.text = compactRate(system?.rx);
        this._up.text = compactRate(system?.tx);
        const description = [expanded ? 'Close Ubuntu Island' : 'Open Ubuntu Island'];
        if (available && showTitle) description.push(String(media.title ?? ''));
        if (this._connection.visible) description.push(connectionState.description);
        if (this._weather.visible) description.push(`${weather.stale ? 'Stale weather: ' : ''}${current.condition}, ${temperature(current.temperature, units)}`);
        if (this._network.visible) description.push(`Download ${system.rx}, upload ${system.tx}`);
        if (this._commute.visible) description.push(commuteState.description);
        if (this._agents.visible) description.push(agentSummary(agents?.sessions));
        if (this._date.visible) description.push(this._date.accessible_name);
        if (this._event.visible) description.push(this._event.accessible_name);
        this.actor.accessible_name = description.join('. ');
        return {connectionEdge: connectionState.edge};
    }

    _queueLayout() {
        if (!this.actor.mapped || this._expanded || this._layoutIdle) return;
        // Font/scale changes settle after the first style notification. Dates
        // and bandwidth share one idle measurement, with no polling timer.
        this._layoutIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._layoutIdle = 0;
            if (this.actor.mapped && !this._expanded) this._onChanged?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    _fitNetwork() {
        if (!this._network.visible || this._expanded) return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const key = `${scale}:${this._down.text}:${this._up.text}`;
        if (key === this._networkWidthKey) return;
        this._networkWidthKey = key;
        [this._down, this._up].forEach(rate => {
            const layout = rate.clutter_text.get_layout().copy();
            layout.set_width(-1);
            layout.set_text('500KB', -1);
            const reference = layout.get_pixel_size()[0];
            layout.set_text(rate.text, -1);
            // Reserve three digits and a two-letter unit plus about 1 mm.
            // An unusually long current value can grow, but never leaves a
            // session-dependent high-water mark after traffic falls again.
            const width = Math.ceil(Math.max(reference, layout.get_pixel_size()[0])) + 4 * scale;
            if (rate.width !== width) rate.width = width;
        });
    }

    _syncDateClock() {
        if (!this.actor.mapped || !this._date.visible || this._expanded) {
            this._stopDateClock();
            return;
        }
        if (this._dateClock) return;
        // Reuse GNOME's clock notifications, which also handle resume and clock
        // changes. No additional polling timer, and no repaint within a day.
        this._dateClock = Main.panel.statusArea.dateMenu._clock;
        this._dateClockId = this._dateClock.connect('notify::clock', () => this._refreshDate());
        this._dateTimezoneId = this._dateClock.connect('notify::timezone', () => this._refreshDate());
        this._refreshDate();
    }

    _refreshDate() {
        if (this._dateDay !== todayDay()) this._onChanged?.();
    }

    _stopDateClock() {
        if (this._dateClock) {
            this._dateClock.disconnect(this._dateClockId);
            this._dateClock.disconnect(this._dateTimezoneId);
        }
        this._dateClock = null;
        this._dateClockId = 0;
        this._dateTimezoneId = 0;
    }
}
