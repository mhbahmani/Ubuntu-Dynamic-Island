import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function locationServicesEnabled() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup('org.gnome.system.location', true);
    return !schema || new Gio.Settings({settings_schema: schema}).get_boolean('enabled');
}
export function openLocationSettings() {
    Gio.AppInfo.create_from_commandline('gnome-control-center privacy', 'Location settings', Gio.AppInfoCreateFlags.NONE).launch([], null);
}
export class CurrentLocation {
    cancel() { this.cancellable?.cancel(); }
    async get() {
        this.cancel();
        if (!locationServicesEnabled()) throw Object.assign(new Error('Location Services are off. Enable them or use a saved start.'), {code: 'location-disabled'});
        const cancellable = new Gio.Cancellable();
        this.cancellable = cancellable;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => { timer = 0; cancellable.cancel(); return GLib.SOURCE_REMOVE; });
        let simple;
        try {
            imports.gi.versions.Geoclue = '2.0';
            const Geoclue = imports.gi.Geoclue;
            simple = await new Promise((resolve, reject) => Geoclue.Simple.new('ubuntu-island',
                Geoclue.AccuracyLevel.EXACT, cancellable, (_s, r) => {
                    try { resolve(Geoclue.Simple.new_finish(r)); } catch (e) { reject(e); }
                }));
            const loc = simple.get_location();
            if (!loc || !Number.isFinite(loc.accuracy) || loc.accuracy < 0 || loc.accuracy > 1000)
                throw Object.assign(new Error('Location is too approximate. Choose a start on the map.'), {code: 'location-approximate'});
            return {latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy};
        } catch (e) {
            if (e.code === 'location-approximate') throw e;
            throw Object.assign(new Error('Current location unavailable. Choose a start on the map.'), {code: 'location-unavailable'});
        } finally {
            if (timer) GLib.Source.remove(timer);
            // One fix per request; never leave a GPS/Wi-Fi watch running.
            const client = simple?.get_client();
            client?.call_stop(null, (s, r) => { try { s.call_stop_finish(r); } catch { /* Best effort. */ } });
            if (this.cancellable === cancellable) this.cancellable = null;
        }
    }
}
