// Development-only wrapper; never packaged or installed.
import UbuntuIsland from './implementation.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {localTime} from './services/weather-model.js';

export default class Preview extends UbuntuIsland {
    enable() {
        const settings = this.getSettings();
        settings.set_boolean('enable-weather', true);
        // Focus this preview on Weather and System; no device/player services.
        for (const key of ['enable-media', 'enable-audio', 'enable-bluetooth']) settings.set_boolean(key, false);
        settings.set_string('weather-location', JSON.stringify({name: GLib.getenv('ISLAND_PREVIEW_LIVE') === '1' ? 'Tehran, Iran' : 'Tehran, Iran (sample)',
            latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran'}));
        super.enable();
        if (GLib.getenv('ISLAND_PREVIEW_LIVE') !== '1') {
            this._weather.http.get = async () => ({
                current: {temperature_2m: 18, apparent_temperature: 16, relative_humidity_2m: 42,
                    wind_speed_10m: 12, weather_code: 2},
                hourly: {time: [1, 2, 3, 4].map(i => localTime('Asia/Tehran', Date.now() + i * 3600000)),
                    temperature_2m: [17, 16, 15, 14], precipitation_probability: [0, 20, 40, 60]},
                // wttr fields allow changing preferred source in sample mode too.
                current_condition: [{temp_C: '18', FeelsLikeC: '16', humidity: '42', windspeedKmph: '12',
                    weatherDesc: [{value: 'Partly cloudy (sample)'}]}],
            });
        }
        this._previewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._previewTimer = 0;
            Main.overview.hide();
            this._card.selectPage('weather');
            this._island.expand();
            console.log('[Island Preview] READY: Weather open; preferences and refresh are interactive');
            this._captureTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                this._captureTimer = 0;
                this._capture().catch(error => console.warn(`[Island Preview] Screenshot: ${error.message}`));
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    openPreferences() {
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.set_environ(GLib.get_environ());
        for (const [key, value] of Object.entries({WAYLAND_DISPLAY: 'island-preview', GDK_BACKEND: 'wayland',
            GI_TYPELIB_PATH: '/usr/lib/gnome-shell/girepository-1.0', LD_LIBRARY_PATH: '/usr/lib/gnome-shell',
            GTK_USE_PORTAL: '0', ADW_DISABLE_PORTAL: '1', GTK_A11Y: 'none'})) launcher.setenv(key, value, true);
        launcher.spawnv(['gjs', '-m', `${this.path}/local-preferences.mjs`]);
    }

    async _capture() {
        const file = Gio.File.new_for_path(`${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/weather.png`);
        const stream = await new Promise((resolve, reject) => file.replace_async(null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT_IDLE, null, (f, result) => {
                try { resolve(f.replace_finish(result)); } catch (e) { reject(e); }
            }));
        try { await new Shell.Screenshot().screenshot(false, stream); }
        finally { stream.close(null); }
    }

    disable() {
        if (this._previewTimer) GLib.Source.remove(this._previewTimer);
        if (this._captureTimer) GLib.Source.remove(this._captureTimer);
        this._previewTimer = this._captureTimer = 0;
        super.disable();
    }
}
