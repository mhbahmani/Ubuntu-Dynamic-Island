import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {WeatherCache} from './weather-cache.js';
import {WeatherHttp} from './weather-http.js';
import {WeatherController, parseLocation, FRESH_MS} from './weather-model.js';

export class WeatherService {
    constructor(settings, emit) {
        this.settings = settings;
        this.http = new WeatherHttp();
        this.cache = new WeatherCache();
        this.cacheGeneration = 0;
        this.network = Gio.NetworkMonitor.get_default();
        this.controller = new WeatherController({
            fetch: url => this.http.get(url), cancel: () => this.http.cancel(), emit: state => {
                emit(state);
                if (state.status === 'ready' && state.data !== this.savedData) {
                    this.savedData = state.data;
                    this.cache.save(this.controller.location, state.data);
                }
            },
            online: () => this.network.network_available,
            schedule: (ms, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(ms), () => {
                callback(); return GLib.SOURCE_REMOVE;
            }),
            unschedule: id => GLib.Source.remove(id),
        });
        const configure = () => {
            this.cache.cancel();
            const generation = ++this.cacheGeneration;
            const location = parseLocation(settings.get_string('weather-location'));
            this.controller.configure(location, settings.get_string('weather-provider'));
            if (!location) return;
            this.cache.load(location).then(data => {
                if (!data || generation !== this.cacheGeneration || this.controller.state.data) return;
                this.savedData = data;
                this.controller.state = {...this.controller.state, data,
                    stale: Date.now() - data.updatedAt >= FRESH_MS};
                if (this.controller.state.status === 'idle') this.controller.state.status = 'ready';
                emit(this.controller.state);
            });
        };
        this.ids = ['weather-location', 'weather-provider'].map(key => settings.connect(`changed::${key}`, configure));
        this.networkId = this.network.connect('network-changed', () => {
            if (this.network.network_available) {
                this.controller.nextAttempt = 0;
                this.controller.refresh();
            }
        });
        configure();
    }
    setActive(active) { this.controller.setActive(active); }
    refresh() { this.controller.refresh(true); }
    stop() {
        this.controller.stop();
        ++this.cacheGeneration;
        this.cache.cancel();
        for (const id of this.ids) this.settings.disconnect(id);
        this.network.disconnect(this.networkId);
    }
}
