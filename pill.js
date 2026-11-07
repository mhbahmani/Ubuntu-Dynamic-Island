import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {notchOrder, arrowSvg, weatherSymbol, commuteIndicator, connectionIndicator} from './services/notch-model.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {weatherSceneKind, temperature} from './services/weather-model.js';
import {icon, label, row} from './widgets.js';

// Compact notch content shown while collapsed. The St.Button gives keyboard
// focus semantics and an accessibility name for the toggle action.
export class Pill {
    constructor(onToggle, onToggleTitle) {
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
        this._title = label('', 'ubuntu-island-pill-title');
        this._title.x_expand = true;
        this._bluetooth = icon('bluetooth-symbolic', 12);
        this._bluetooth.visible = false;
        this._cpuDot = new St.Widget({style_class: 'ubuntu-island-cpu-dot', y_align: Clutter.ActorAlign.CENTER});
        this._media = row('ubuntu-island-pill-media');
        this._media.add_child(this._mediaIcon);
        this._media.add_child(this._title);
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
        this._connection = row('ubuntu-island-pill-connection');
        this._connection.y_align = Clutter.ActorAlign.CENTER;
        this._connectionIcon = icon('network-wireless-disabled-symbolic', 16);
        this._connection.add_child(this._connectionIcon);
        this._connection.visible = false;
        content.add_child(this._connection);
        content.add_child(this._cpuDot);
        content.add_child(this._bluetooth);
        this._items = {media: this._media, weather: this._weather, network: this._network,
            cpu: this._cpuDot, bluetooth: this._bluetooth, commute: this._commute};
        const groups = [...Object.values(this._items), this._connection];
        for (const group of groups) {
            group.x_expand = true;
            group.x_align = Clutter.ActorAlign.CENTER;
        }
        // The configured width is a minimum. Reserve readable space for all
        // enabled groups, independent of fluctuating rates and track titles.
        this.actor._islandMinimumWidth = () => {
            if (!this.actor.mapped) return 0;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const visible = groups.filter(g => g.visible);
            return visible.reduce((sum, g) => sum + g.get_preferred_width(-1)[1], 0)
                + (26 + Math.max(0, visible.length - 1) * 12) * scale;
        };
    }

    // Pango ellipsizes against the allocated width, including scaled fonts.
    render({media, system, connection, offlineMode = 'icon', bluetooth, expanded, showMetrics, showTitle = true, weather, showWeather = false, showNetwork = false, units = 'celsius', order = [], arrowStyle = 'chevron', arrowAngle = 80, weatherStyle = 'colorful', commute, showCommute = false}) {
        const connectionState = connectionIndicator(connection, {order, mode: offlineMode,
            network: Boolean(showNetwork && showMetrics), weather: Boolean(showWeather && weather),
            commute: Boolean(showCommute && commute?.route)});
        this._connection.visible = connectionState.visible;
        const connectionIcon = connectionState.icon ?? 'network-wireless-disabled-symbolic';
        if (connectionIcon !== this._connectionKind) {
            this._connectionKind = connectionIcon;
            if (connectionIcon === 'unplug-symbolic') {
                const file = Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path('assets/notch/unplug-symbolic.svg');
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
        this._title.visible = available && showTitle;
        this._title.text = available ? String(media.title ?? '') : '';
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
                const file = Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path(`assets/weather/notch/${kind}.svg`);
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
        if (this._connection.visible) description.push(connectionState.description);
        if (this._weather.visible) description.push(`${weather.stale ? 'Stale weather: ' : ''}${current.condition}, ${temperature(current.temperature, units)}`);
        if (this._network.visible) description.push(`Download ${system.rx}, upload ${system.tx}`);
        if (this._commute.visible) description.push(commuteState.description);
        this.actor.accessible_name = description.join('. ');
        return {connectionEdge: connectionState.edge};
    }
}
