import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {WeatherHttp} from './weather-http.js';
import {CommuteController, routesFrom, useSavedStart} from './commute-model.js';
import {CurrentLocation} from './commute-location.js';
import {routingKeys} from './commute-keys.js';

export class CommuteService {
    constructor(settings, emit) {
        this.settings = settings; this.emit = emit; this.reversed = false;
        this.http = new WeatherHttp('UbuntuIsland/11 (GNOME extension; github.com/mhbahmani/ubuntu-dynamic-island)');
        this.location = new CurrentLocation();
        this.controller = new CommuteController({fetch: (url, headers) => this.fetch(url, headers),
            cancel: () => { this.http.cancel(); this.location.cancel(); this.keyCancel?.cancel(); this.cancelWait?.(); },
            locate: () => this.location.get(), keys: () => { this.keyCancel = new Gio.Cancellable(); return routingKeys(this.keyCancel); }, emit: state => emit({...state, route: this.route}),
            schedule: (ms, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(ms), () => { callback(); return GLib.SOURCE_REMOVE; }),
            unschedule: id => GLib.Source.remove(id)});
        this.ids = ['commute-routes', 'commute-selected', 'commute-provider', 'commute-provider-order', 'commute-interval', 'commute-fallback', 'commute-keys-revision']
            .map(key => settings.connect(`changed::${key}`, () => {
                this.reversed = false;
                if (key === 'commute-keys-revision') { this.controller.signature = null; this.controller.cache.clear(); }
                this.configure();
            }));
        this.configure();
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
    setActive(active) { this.controller.setActive(active); }
    refresh() { this.controller.refresh(true); }
    stop() { this.controller.stop(); for (const id of this.ids) this.settings.disconnect(id); }
}
