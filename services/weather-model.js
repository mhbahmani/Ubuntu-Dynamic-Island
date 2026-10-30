// Provider-independent weather data; temperatures in Celsius, wind in km/h.
export const FRESH_MS = 20 * 60 * 1000;
export const PROVIDERS = ['open-meteo', 'wttr'];
export function number(value) {
    return value === null || value === undefined || value === '' || typeof value === 'boolean'
        ? null : Number.isFinite(Number(value)) ? Number(value) : null;
}
export function parseLocation(value) {
    try {
        const p = typeof value === 'string' ? JSON.parse(value) : value;
        if (!p || number(p.latitude) === null || number(p.longitude) === null ||
            Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || !p.timezone) return null;
        new Intl.DateTimeFormat('en', {timeZone: p.timezone}).format();
        return {latitude: Number(p.latitude), longitude: Number(p.longitude),
            timezone: String(p.timezone), name: String(p.name || `${p.latitude}, ${p.longitude}`).slice(0, 100)};
    } catch { return null; }
}
export function localTime(timezone, now = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
        .formatToParts(new Date(now));
    const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function condition(code) {
    if (code === 0) return 'Clear sky';
    if ([1, 2].includes(code)) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if ([45, 48].includes(code)) return 'Fog';
    if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
    if ([95, 96, 99].includes(code)) return 'Thunderstorm';
    return 'Conditions unavailable';
}
export function weatherUrl(provider, location) {
    const {latitude: lat, longitude: lon} = location;
    if (provider === 'wttr') return `https://wttr.in/${lat},${lon}?format=j1`;
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
        '&hourly=temperature_2m,precipitation_probability&forecast_days=2' +
        `&timezone=${encodeURIComponent(location.timezone)}`;
}
export function normalize(provider, body, location, now = Date.now()) {
    let current, hourly, observedAt;
    if (provider === 'open-meteo') {
        const c = body.current ?? {};
        current = {temperature: number(c.temperature_2m), feelsLike: number(c.apparent_temperature),
            humidity: number(c.relative_humidity_2m), wind: number(c.wind_speed_10m), isDay: c.is_day === 0 ? false : c.is_day === 1 ? true : null, condition: condition(c.weather_code)};
        observedAt = typeof c.time === 'string' ? c.time : null;
        hourly = (body.hourly?.time ?? []).map((time, i) => ({time,
            temperature: number(body.hourly.temperature_2m?.[i]),
            rain: number(body.hourly.precipitation_probability?.[i])}));
    } else {
        const c = body.current_condition?.[0] ?? {};
        current = {temperature: number(c.temp_C), feelsLike: number(c.FeelsLikeC),
            humidity: number(c.humidity), wind: number(c.windspeedKmph),
            condition: String(c.weatherDesc?.[0]?.value || 'Conditions unavailable').trim().slice(0, 100)};
        // wttr's observation_time is UTC; do not pretend it is the user's local time.
        observedAt = c.observation_time ? `${String(c.observation_time).slice(0, 30)} UTC` : null;
        hourly = (body.weather ?? []).flatMap(day => (day.hourly ?? []).map(h => ({
            time: `${day.date}T${String(Math.floor(Number(h.time) / 100)).padStart(2, '0')}:00`,
            temperature: number(h.tempC), rain: number(h.chanceofrain),
        })));
    }
    if (current.temperature === null || Math.abs(current.temperature) > 100)
        throw new Error('Invalid weather response');
    const local = localTime(location.timezone, now);
    hourly = hourly.filter(h => typeof h.time === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(h.time) &&
        h.time >= local && h.temperature !== null).slice(0, 24);
    return {provider, updatedAt: now, observedAt, current, hourly};
}
export function temperature(value, unit = 'celsius') {
    return value === null || value === undefined ? '—' : `${Math.round(unit === 'fahrenheit' ? value * 9 / 5 + 32 : value)}°${unit === 'fahrenheit' ? 'F' : 'C'}`;
}

// Inject I/O and scheduling so cancellation, fallback and lifecycle are testable.
export class WeatherController {
    constructor({fetch, cancel, schedule, unschedule, emit, now = Date.now, online = () => true}) {
        Object.assign(this, {fetch, cancel, schedule, unschedule, emit, now, online});
        this.active = false;
        this.generation = 0;
        this.state = {status: 'unconfigured', data: null, stale: false};
        this.failures = 0;
        this.blocked = new Set();
    }
    configure(location, preferred = 'open-meteo') {
        this.invalidate();
        this.location = location;
        this.preferred = preferred;
        this.failures = 0;
        this.nextAttempt = 0;
        this.blocked.clear();
        this.state = {status: location ? 'idle' : 'unconfigured', data: null, stale: false};
        this.emit(this.state);
        if (this.active) this.refresh();
    }
    invalidate() {
        this.generation++;
        this.cancel();
        if (this.timer) this.unschedule(this.timer);
        this.timer = null;
        this.pending = false;
    }
    setActive(active) {
        if (this.active === active) return;
        this.active = active;
        if (active) this.refresh();
        else {
            this.invalidate();
            if (this.state.status === 'loading') this.state = {...this.state, status: this.state.data ? 'ready' : 'idle'};
        }
    }
    arm(delay) {
        if (!this.active || this.timer) return;
        this.timer = this.schedule(Math.max(1000, delay), () => { this.timer = null; this.refresh(); });
    }
    async refresh(force = false) {
        if (!this.active || !this.location || this.pending) return;
        const age = this.now() - (this.state.data?.updatedAt ?? 0);
        if (!force && this.state.data && age < FRESH_MS) {
            this.state = {...this.state, stale: false};
            this.emit(this.state);
            this.arm(FRESH_MS - age);
            return;
        }
        if (!force && this.now() < this.nextAttempt) { this.arm(this.nextAttempt - this.now()); return; }
        if (force) this.blocked.clear();
        if (this.timer) this.unschedule(this.timer);
        this.timer = null;
        const generation = ++this.generation;
        this.pending = true;
        this.state = {...this.state, status: 'loading', stale: Boolean(this.state.data && age >= FRESH_MS), error: null};
        this.emit(this.state);
        let data = null;
        const providers = [this.preferred, ...PROVIDERS.filter(p => p !== this.preferred)];
        if (this.online()) for (const provider of providers) {
            if (this.blocked.has(provider)) continue;
            try {
                const body = await this.fetch(weatherUrl(provider, this.location));
                if (generation !== this.generation) return;
                data = normalize(provider, body, this.location, this.now());
                break;
            } catch (error) {
                if (generation !== this.generation) return;
                if ([401, 403, 429].includes(error.status)) this.blocked.add(provider);
            }
        }
        if (generation !== this.generation) return;
        this.pending = false;
        if (data) {
            this.failures = 0;
            this.nextAttempt = 0;
            this.state = {status: 'ready', stale: false, data, error: null};
            this.arm(FRESH_MS);
        } else {
            this.state = {...this.state, status: this.online() ? 'unavailable' : 'offline',
                stale: Boolean(this.state.data), error: 'Weather unavailable. Check your connection and retry.'};
            this.nextAttempt = this.now() + Math.min(FRESH_MS, 60000 * 2 ** Math.min(this.failures++, 4)) * (0.9 + Math.random() * 0.2);
            if (this.blocked.size < PROVIDERS.length) this.arm(this.nextAttempt - this.now());
        }
        this.emit(this.state);
    }
    stop() { this.active = false; this.invalidate(); }
}

// Missing day/night data preserves the existing daytime fallback.
export function weatherSceneKind(current) {
    const text = String(current?.condition ?? '').toLowerCase();
    const base = /snow|sleet|ice/.test(text) ? 'snow' : /rain|drizzle|thunder/.test(text) ? 'rain'
        : /clear|sunny/.test(text) ? 'sun' : 'clouds';
    return current?.isDay === false ? (base === 'sun' ? 'night' : `${base}-night`) : base;
}
