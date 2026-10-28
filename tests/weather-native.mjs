// GJS cache integration check. Run with a temporary XDG_CACHE_HOME.
import GLib from 'gi://GLib';
import {WeatherCache} from '../services/weather-cache.js';
import {normalize} from '../services/weather-model.js';
const loop = new GLib.MainLoop(null, false);
let failed = false;
(async () => {
    const cache = new WeatherCache();
    const location = {latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran', name: 'Tehran'};
    const data = normalize('open-meteo', {current: {temperature_2m: 18}}, location);
    await cache.save(location, data);
    const loaded = await cache.load(location);
    if (loaded?.current.temperature !== 18) throw Error('Cache did not round trip');
    if (await cache.load({...location, latitude: 1}) !== null) throw Error('Cache crossed locations');
    await cache.save(location, {...data, updatedAt: Date.now() + 3600000});
    if (await cache.load(location) !== null) throw Error('Future cache accepted');
    cache.cancel();
    print('Weather cache round trip, location isolation and validation passed');
})().catch(error => { failed = true; logError(error); }).finally(() => loop.quit());
loop.run();
if (failed) throw Error('Weather cache tests failed');
