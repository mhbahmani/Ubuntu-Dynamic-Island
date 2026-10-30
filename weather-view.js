import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {WeatherScene} from './weather-scene.js';
import {label, row, column, button, setEnabled} from './widgets.js';
import {temperature, parseLocation, localTime} from './services/weather-model.js';

export class WeatherView {
    constructor(section, settings, actions) {
        this.settings = settings;
        section.header.hide();
        section.box.set_style_class_name('ubuntu-island-weather-section');
        section.content.set_style_class_name('ubuntu-island-weather-section');
        this.surface = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true,
            style_class: 'ubuntu-island-weather-surface', clip_to_allocation: true});
        this.scene = new WeatherScene(settings);
        this.surface.add_child(this.scene.actor);
        const content = column('ubuntu-island-weather-content');
        content.x_expand = true;
        content.y_expand = true;
        content.y_align = Clutter.ActorAlign.START;
        this.surface.add_child(content);
        section.content.add_child(this.surface);

        const heading = row('ubuntu-island-weather-heading');
        this.title = label('Choose a location', 'ubuntu-island-weather-location');
        this.title.x_expand = true;
        heading.add_child(this.title);
        this.refresh = button('view-refresh-symbolic', 'Refresh weather', () => actions.weatherRefresh?.(), 14, 'ubuntu-island-weather-action');
        heading.add_child(this.refresh);
        heading.add_child(button('preferences-system-symbolic', 'Configure weather location', () => actions.preferences(), 14, 'ubuntu-island-weather-action'));
        content.add_child(heading);
        this.current = label('—', 'ubuntu-island-weather-temperature');
        content.add_child(this.current);
        this.condition = label('', 'ubuntu-island-weather-condition');
        content.add_child(this.condition);
        this.feels = label('', 'ubuntu-island-weather-secondary');
        content.add_child(this.feels);
        const divider = new St.Widget({style_class: 'ubuntu-island-weather-divider'});
        content.add_child(divider);
        const forecastHeading = row();
        const next = label('NEXT HOURS', 'ubuntu-island-weather-eyebrow');
        next.x_expand = true;
        forecastHeading.add_child(next);
        this.timezone = label('', 'ubuntu-island-weather-secondary');
        forecastHeading.add_child(this.timezone);
        content.add_child(forecastHeading);
        const forecast = row('ubuntu-island-weather-forecast');
        this.hours = Array.from({length: 4}, () => {
            const cell = column('ubuntu-island-weather-hour');
            cell.x_expand = true;
            cell._time = label('', 'ubuntu-island-weather-secondary');
            cell._temperature = label('', 'ubuntu-island-weather-hour-temp');
            cell._rain = label('', 'ubuntu-island-weather-rain');
            for (const item of [cell._time, cell._temperature, cell._rain]) {
                item.x_align = Clutter.ActorAlign.CENTER;
                cell.add_child(item);
            }
            forecast.add_child(cell);
            return cell;
        });
        content.add_child(forecast);
        this.details = label('', 'ubuntu-island-weather-secondary');
        content.add_child(this.details);
        this.status = label('', 'ubuntu-island-weather-secondary');
        content.add_child(this.status);
        this.source = label('', 'ubuntu-island-weather-credit');
        content.add_child(this.source);
        this.render({status: 'unconfigured'});
    }
    setViewport(viewport) {
        this.scene.setViewport(viewport);
        const fit = () => { if (viewport.width > 0) this.surface.width = viewport.width; };
        viewport.connectObject('notify::width', fit, this.surface);
    }
    render(state) {
        const location = parseLocation(this.settings.get_string('weather-location'));
        const unit = this.settings.get_string('weather-units');
        const data = state.data;
        this.scene.sprite.visible = Boolean(data);
        this.scene.setCondition(data?.current);
        this.title.text = location?.name ?? 'Choose a location in preferences';
        this.current.text = data ? temperature(data.current.temperature, unit) : '—';
        this.condition.text = data?.current.condition ?? 'Your weather, at a glance';
        this.feels.text = data ? `Feels like ${temperature(data.current.feelsLike, unit)}` : 'Set a city or coordinates in preferences';
        this.details.text = data ? `Wind  ${data.current.wind ?? '—'} km/h     ·     Humidity  ${data.current.humidity ?? '—'}%` : '';
        this.timezone.text = location?.timezone.split('/').at(-1).replaceAll('_', ' ') ?? '';
        const hours = data?.hourly.filter(h => h.time >= localTime(location.timezone)) ?? [];
        this.hours.forEach((actor, i) => {
            const hour = hours[i];
            actor.visible = Boolean(hour);
            if (!hour) return;
            actor._time.text = hour.time.slice(11);
            actor._temperature.text = temperature(hour.temperature, unit);
            actor._rain.text = `${hour.rain ?? '—'}% rain`;
            actor.accessible_name = `${hour.time}: ${actor._temperature.text}, ${actor._rain.text}`;
        });
        const age = data ? Math.max(0, Math.floor((Date.now() - data.updatedAt) / 60000)) : 0;
        this.status.text = state.status === 'loading' ? `Refreshing…${state.stale ? ' · Previous data' : ''}`
            : state.error ? `${state.stale ? 'Stale · ' : ''}${state.error}`
            : data ? `${state.stale ? 'Stale · ' : ''}Fetched ${age} min ago${hours.length ? '' : ' · Forecast unavailable'}` : '';
        this.status.accessible_name = this.status.text;
        this.source.text = data ? `${data.provider === 'wttr' ? 'wttr.in / WorldWeatherOnline' : 'Open-Meteo · CC BY 4.0'} · Art: Meteocons` : 'Artwork: Meteocons / Bas Milius';
        setEnabled(this.refresh, Boolean(location) && state.status !== 'loading');
    }
}
