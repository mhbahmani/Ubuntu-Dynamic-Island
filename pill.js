import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {weatherSceneKind, temperature} from './services/weather-model.js';
import {icon, label, row, column} from './widgets.js';

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
        content.add_child(this._mediaIcon);
        content.add_child(this._title);
        content.add_child(new St.Widget({x_expand: true}));
        this._weather = icon('weather-few-clouds-symbolic', 14);
        this._weather.visible = false;
        content.add_child(this._weather);
        this._network = column('ubuntu-island-pill-network');
        this._network.y_align = Clutter.ActorAlign.CENTER;
        this._down = label('↓ —', 'ubuntu-island-pill-rate', false);
        this._up = label('↑ —', 'ubuntu-island-pill-rate', false);
        this._network.add_child(this._down);
        this._network.add_child(this._up);
        this._network.visible = false;
        content.add_child(this._network);
        content.add_child(this._cpuDot);
        content.add_child(this._bluetooth);
    }

    // Pango ellipsizes against the allocated width, including scaled fonts.
    render({media, system, bluetooth, expanded, showMetrics, showTitle = true, weather, showWeather = false, showNetwork = false, units = 'celsius'}) {
        const available = Boolean(media?.available);
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
        this._weather.visible = Boolean(showWeather && weather?.data?.current);
        const current = weather?.data?.current;
        const kind = weatherSceneKind(current);
        this._weather.icon_name = ({sun: 'weather-clear-symbolic', night: 'weather-clear-night-symbolic',
            clouds: 'weather-few-clouds-symbolic', 'clouds-night': 'weather-few-clouds-night-symbolic',
            rain: 'weather-showers-symbolic', 'rain-night': 'weather-showers-symbolic',
            snow: 'weather-snow-symbolic', 'snow-night': 'weather-snow-symbolic'})[kind];
        this._weather.opacity = weather?.stale ? 140 : 255;
        this._network.visible = Boolean(showNetwork && showMetrics && system);
        const compactRate = rate => String(rate ?? '—').replace(/ Ki?B\/s$/, 'K').replace(/ Mi?B\/s$/, 'M').replace(/ Gi?B\/s$/, 'G').replace(/ B\/s$/, 'B');
        this.actor.get_child().set_style(this._network.visible ? 'spacing: 3px;' : null);
        this._down.text = `↓ ${compactRate(system?.rx)}`;
        this._up.text = `↑ ${compactRate(system?.tx)}`;
        const description = [expanded ? 'Close Ubuntu Island' : 'Open Ubuntu Island'];
        if (this._weather.visible) description.push(`${weather.stale ? 'Stale weather: ' : ''}${current.condition}, ${temperature(current.temperature, units)}`);
        if (this._network.visible) description.push(`Download ${system.rx}, upload ${system.tx}`);
        this.actor.accessible_name = description.join('. ');
    }
}
