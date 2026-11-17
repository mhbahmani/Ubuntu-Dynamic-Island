import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {WeatherHttp} from './weather-http.js';
import {CommuteController, routesFrom, useSavedStart, PROVIDERS, KEYLESS_PROVIDERS} from './commute-model.js';
import {CurrentLocation} from './commute-location.js';
import {routingKeys} from './commute-keys.js';

export class CommuteService {
    constructor(settings, emit) {
        this.settings = settings; this.emit = emit; this.reversed = false;
        this.availableProviders = [...KEYLESS_PROVIDERS];
        this.http = new WeatherHttp('UbuntuIsland/11 (GNOME extension; github.com/mhbahmani/ubuntu-dynamic-island)');
        this.location = new CurrentLocation();
        this.controller = new CommuteController({fetch: (url, headers) => this.fetch(url, headers),
            cancel: () => { this.http.cancel(); this.location.cancel(); this.keyCancel?.cancel(); this.cancelWait?.(); },
            locate: () => this.location.get(), keys: async () => {
                const cancel = this.keyCancel = new Gio.Cancellable();
                const keys = await routingKeys(cancel);
                if (!cancel.is_cancelled()) this.availableProviders = PROVIDERS.filter(id => KEYLESS_PROVIDERS.includes(id) || keys[id]);
                return keys;
            }, emit: state => this.publish(state),
            schedule: (ms, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(ms), () => { callback(); return GLib.SOURCE_REMOVE; }),
            unschedule: id => GLib.Source.remove(id)});
        this.ids = ['commute-routes', 'commute-selected', 'commute-provider', 'commute-provider-order', 'commute-interval', 'commute-fallback', 'commute-keys-revision']
            .map(key => settings.connect(`changed::${key}`, () => {
                // Changing source or refresh settings must preserve the journey
                // currently on screen, including its reversed direction.
                if (key === 'commute-routes' || key === 'commute-selected') this.reversed = false;
                if (key === 'commute-keys-revision') { this.controller.signature = null; this.controller.cache.clear(); }
                this.configure();
            }));
        this.ids.push(settings.connect('changed::commute-open-with', () => this.publish(this.controller.state)));
        this.configure();
    }
    publish(state) {
        this.emit({...state, route: this.route,
            preferred: this.settings.get_string('commute-provider'),
            allowFallback: this.settings.get_boolean('commute-fallback'),
            openWith: this.settings.get_string('commute-open-with'),
            availableProviders: this.availableProviders});
    }
    async fetch(url, headers) {
        const delay = Math.max(0, 1100 - (GLib.get_monotonic_time() / 1000 - (this.lastRequest ?? -Infinity)));
        if (delay) await new Promise((resolve, reject) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(delay), () => { this.cancelWait = null; resolve(); return GLib.SOURCE_REMOVE; });
            this.cancelWait = () => { GLib.Source.remove(id); this.cancelWait = null; reject(new Error('Cancelled')); };
        });
        this.lastRequest = GLib.get_monotonic_time() / 1000;
        return this.http.get(url, headers);
    }
    configure() {
        this.routes = routesFrom(this.settings.get_string('commute-routes'));
        this.route = this.routes.find(r => r.id === this.settings.get_string('commute-selected')) ?? this.routes[0];
        if (this.reversed && this.route?.originMode === 'fixed') this.route = {...this.route,
            origin: this.route.destination, destination: this.route.origin,
            originName: this.route.destinationName, destinationName: this.route.originName};
        this.controller.configure(this.route, this.settings.get_string('commute-provider'),
            this.settings.get_int('commute-interval'), this.settings.get_boolean('commute-fallback'), this.settings.get_strv('commute-provider-order'));
    }
    next() {
        const i = this.routes.findIndex(r => r.id === this.route?.id);
        if (this.routes.length) this.settings.set_string('commute-selected', this.routes[(i + 1) % this.routes.length].id);
    }
    useSavedStart() {
        const replacement = useSavedStart(this.route);
        if (!replacement) return;
        const routes = this.routes.map(r => r.id === replacement.id ? replacement : r);
        this.settings.set_string('commute-routes', JSON.stringify(routes));
    }
    swap() { if (this.route?.originMode === 'fixed') { this.reversed = !this.reversed; this.configure(); } }
    selectProvider(id) {
        if (id === 'auto' || this.availableProviders.includes(id)) this.settings.set_string('commute-provider', id);
    }
    setActive(active) { this.controller.setActive(active); }
    refresh() { this.controller.refresh(true); }
    stop() { this.controller.stop(); for (const id of this.ids) this.settings.disconnect(id); }
}
