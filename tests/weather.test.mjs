import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherSceneKind, WeatherController, metCondition, normalize, parseLocation, temperature, localTime, weatherUrl, FRESH_MS} from '../services/weather-model.js';
const location = {latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran', name: 'Tehran'};
const now = Date.parse('2026-10-28T20:45:00Z');
const open = {current: {temperature_2m: 12, apparent_temperature: null, weather_code: 1234},
    hourly: {time: ['2026-10-28T23:00', '2026-10-29T01:00'], temperature_2m: [10, 9], precipitation_probability: [null, 0]}};
const wttr = {current_condition: [{temp_C: '10', FeelsLikeC: '8', weatherDesc: [{value: 'Cloudy'}]}],
    weather: [{date: '2026-10-29', hourly: [{time: '300', tempC: '7', chanceofrain: '30'}]}]};
const met = {properties: {timeseries: [
    {time: '2026-10-28T20:00:00Z', data: {instant: {details: {air_temperature: 11.5,
        apparent_air_temperature: 9.9, relative_humidity: 43, wind_speed: 3.4}},
        next_1_hours: {summary: {symbol_code: 'rain_day'}, details: {precipitation_amount: 0.6}}}},
    {time: '2026-10-28T21:00:00Z', data: {instant: {details: {air_temperature: 11, wind_speed: 2}},
        next_1_hours: {summary: {symbol_code: 'snow_night'}}}},
    {time: '2026-10-28T22:00:00Z', data: {instant: {details: {air_temperature: 10, wind_speed: 2}},
        next_1_hours: {summary: {symbol_code: 'clearsky_night'}}}},
]}};
function harness(fetch) {
    let time = now, cancelled = 0;
    const emissions = [], timers = new Map();
    let next = 0;
    const controller = new WeatherController({fetch, now: () => time, cancel: () => cancelled++,
        emit: state => emissions.push(state), schedule: (delay, callback) => { timers.set(++next, {delay, callback}); return next; },
        unschedule: id => timers.delete(id)});
    controller.configure(location);
    return {controller, emissions, timers, advance: ms => { time += ms; }, cancelled: () => cancelled};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('location validation accepts zero and rejects missing, infinite and invalid timezones', () => {
    assert.equal(parseLocation({...location, latitude: 0}).latitude, 0);
    for (const patch of [{latitude: null}, {latitude: ''}, {latitude: 91}, {longitude: Infinity}, {timezone: 'Mars/City'}])
        assert.equal(parseLocation({...location, ...patch}), null);
    assert.equal(parseLocation('broken'), null);
});
test('normalization respects location date boundary, missing fields and unknown codes', () => {
    assert.equal(localTime('Asia/Tehran', now), '2026-10-29T00:15');
    const data = normalize('open-meteo', open, location, now);
    assert.equal(data.hourly.length, 1);
    assert.equal(data.hourly[0].rain, 0);
    assert.equal(data.current.feelsLike, null);
    assert.equal(data.current.condition, 'Conditions unavailable');
    assert.equal(temperature(null), '—');
    assert.equal(temperature(0, 'fahrenheit'), '32°F');
    assert.throws(() => normalize('open-meteo', {current: {temperature_2m: null}}, location, now));
});
test('wttr forecast keeps its real three-hour intervals', () => {
    const data = normalize('wttr', wttr, location, now);
    assert.equal(data.current.temperature, 10);
    assert.equal(data.hourly[0].time, '2026-10-29T03:00');
    assert.match(weatherUrl('wttr', location), /35.6892,51.389\?format=j1/);
});
test('met.no normalization uses the covering entry, local times and km/h', () => {
    const data = normalize('met', met, location, now);
    assert.equal(data.current.temperature, 11.5);
    assert.equal(data.current.feelsLike, 9.9);
    assert.equal(data.current.wind, 12);
    assert.equal(data.current.isDay, true);
    assert.equal(data.current.condition, 'Rain');
    assert.equal(data.observedAt, '2026-10-28T20:00:00Z');
    // UTC entries become location-local strings; the 20:00Z entry is before local midnight and drops out.
    assert.deepEqual(data.hourly.map(h => h.time), ['2026-10-29T00:30', '2026-10-29T01:30']);
    assert.equal(data.hourly[0].rain, null);
    assert.throws(() => normalize('met', {properties: {timeseries: []}}, location, now));
    // met.no rejects over four decimals; the URL never carries them.
    assert.match(weatherUrl('met', {...location, latitude: 35.689199}), /lat=35\.6892&lon=51\.3890$/);
    assert.equal(metCondition('heavysleetshowersandthunder_day'), 'Heavy Sleet showers');
    assert.equal(weatherSceneKind({condition: metCondition('fair_day')}), 'sun');
    assert.equal(weatherSceneKind({condition: metCondition('lightsnow_night'), isDay: false}), 'snow-night');
});
test('no hidden requests; primary failure falls back and simultaneous refreshes coalesce', async () => {
    const urls = [];
    const h = harness(async url => { urls.push(url); if (url.includes('open-meteo')) throw Error('offline');
        return url.includes('met.no') ? met : wttr; });
    await h.controller.refresh(true);
    assert.equal(urls.length, 0);
    h.controller.setActive(true);
    h.controller.refresh(true);
    await settle();
    assert.equal(urls.length, 2);
    assert.equal(h.controller.state.data.provider, 'met');
    h.controller.setActive(false);
    assert.equal(h.timers.size, 0);
    h.controller.setActive(true);
    assert.equal(urls.length, 2, 'Fresh cached data should not fetch again');
});
test('reverse preference falls back on malformed JSON data and recovers', async () => {
    const urls = [];
    const h = harness(async url => { urls.push(url); return url.includes('wttr') ? {} : open; });
    h.controller.configure(location, 'wttr');
    h.controller.setActive(true);
    await settle();
    assert.match(urls[0], /wttr/);
    assert.equal(h.controller.state.data.provider, 'open-meteo');
});
test('failed refresh retains data explicitly marked stale and backs off', async () => {
    let fail = false, requests = 0;
    const h = harness(async () => { requests++; if (fail) throw Error(); return open; });
    h.controller.setActive(true); await settle();
    fail = true; h.advance(FRESH_MS + 1);
    await h.controller.refresh();
    assert.equal(h.controller.state.stale, true);
    assert.equal(h.controller.state.data.current.temperature, 12);
    const count = requests;
    await h.controller.refresh();
    assert.equal(requests, count);
});
test('location change and disable ignore late responses', async () => {
    const pending = [];
    const h = harness(() => new Promise(resolve => pending.push(resolve)));
    h.controller.setActive(true);
    h.controller.configure({...location, name: 'Other', latitude: 1});
    pending[0](open); await settle();
    assert.equal(h.controller.state.data, null);
    h.controller.stop();
    const count = h.emissions.length;
    pending[1](open); await settle();
    assert.equal(h.emissions.length, count);
    assert.equal(h.timers.size, 0);
});
test('authentication/quota errors stop automatic provider retries; manual retry restores them', async () => {
    let count = 0;
    const h = harness(async () => { count++; throw Object.assign(Error(), {status: 429}); });
    h.controller.setActive(true); await settle();
    assert.equal(count, 3);
    assert.equal(h.timers.size, 0);
    h.advance(FRESH_MS * 2);
    await h.controller.refresh();
    assert.equal(count, 3);
    await h.controller.refresh(true);
    assert.equal(count, 6);
});
test('offline state makes no network requests', async () => {
    let count = 0;
    const h = harness(async () => { count++; return open; });
    h.controller.online = () => false;
    h.controller.setActive(true); await settle();
    assert.equal(count, 0);
    assert.equal(h.controller.state.status, 'offline');
});

test('weather artwork follows day/night for each condition and preserves missing-data fallback', () => {
    for (const [condition, day, night] of [['Clear', 'sun', 'night'], ['Partly cloudy', 'clouds', 'clouds-night'],
        ['Rain', 'rain', 'rain-night'], ['Drizzle', 'rain', 'rain-night'], ['Snow', 'snow', 'snow-night']]) {
        assert.equal(weatherSceneKind({condition, isDay: true}), day);
        assert.equal(weatherSceneKind({condition, isDay: false}), night);
        assert.equal(weatherSceneKind({condition}), day);
    }
});
