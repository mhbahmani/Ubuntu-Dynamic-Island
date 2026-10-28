import {label, button, setEnabled} from './widgets.js';
import {temperature, parseLocation, localTime} from './services/weather-model.js';

export class WeatherView {
    constructor(section, settings, actions) {
        this.settings = settings;
        this.title = label('Choose a location', 'ubuntu-island-track');
        this.current = label('');
        this.details = label('');
        this.status = label('');
        this.source = label('', 'ubuntu-island-source');
        this.hours = Array.from({length: 4}, () => label(''));
        for (const item of [this.title, this.current, this.details, ...this.hours, this.status, this.source])
            section.content.add_child(item);
        this.refresh = button('view-refresh-symbolic', 'Refresh weather', () => actions.weatherRefresh?.());
        section.header.add_child(this.refresh);
        section.header.add_child(button('preferences-system-symbolic', 'Configure weather location', () => actions.preferences()));
        this.render({status: 'unconfigured'});
    }
    render(state) {
        const location = parseLocation(this.settings.get_string('weather-location'));
        const unit = this.settings.get_string('weather-units');
        const data = state.data;
        this.title.text = location?.name ?? 'Choose a location in preferences';
        this.current.text = data ? `${temperature(data.current.temperature, unit)} · ${data.current.condition}` : '';
        this.details.text = data ? `Feels like ${temperature(data.current.feelsLike, unit)} · Wind ${data.current.wind ?? '—'} km/h · Humidity ${data.current.humidity ?? '—'}%` : '';
        const hours = data?.hourly.filter(h => h.time >= localTime(location.timezone)) ?? [];
        this.hours.forEach((actor, i) => {
            const hour = hours[i];
            actor.visible = Boolean(hour);
            actor.text = hour ? `${hour.time.slice(5, 10)} ${hour.time.slice(11)}   ${temperature(hour.temperature, unit)}   Rain ${hour.rain ?? '—'}%` : '';
        });
        if (data && !hours.length) {
            this.hours[0].visible = true;
            this.hours[0].text = 'Forecast unavailable';
        }
        const age = data ? Math.max(0, Math.floor((Date.now() - data.updatedAt) / 60000)) : 0;
        this.status.text = state.status === 'loading' ? `Refreshing…${state.stale ? ' · Previous data' : ''}`
            : state.error ? `${state.stale ? 'Stale · ' : ''}${state.error}`
            : data ? `${state.stale ? 'Stale · ' : ''}Fetched ${age} min ago · ${location.timezone}`
            : 'Set a city or coordinates in Island preferences.';
        this.status.accessible_name = this.status.text;
        this.source.text = data ? `${data.provider === 'wttr' ? 'wttr.in / WorldWeatherOnline' : 'Open-Meteo (CC BY 4.0)'}${data.observedAt ? ` · ${data.observedAt}` : ''}` : '';
        setEnabled(this.refresh, Boolean(location) && state.status !== 'loading');
    }
}
