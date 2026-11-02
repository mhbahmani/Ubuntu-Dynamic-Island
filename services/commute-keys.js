import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
// Credentials never enter GSettings, URLs shown in the UI, or the map WebView.
async function secret() { imports.gi.versions.Secret = '1'; return imports.gi.Secret; }
function schema(S) { return new S.Schema('org.gnome.shell.extensions.ubuntu-island.routing', S.SchemaFlags.NONE, {provider: S.SchemaAttributeType.STRING}); }
export async function routingKeys(cancellable = new Gio.Cancellable()) {
    let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => { timer = 0; cancellable.cancel(); return GLib.SOURCE_REMOVE; });
    try {
        const S = await secret();
        const result = {};
        await Promise.all(['neshan', 'mapbox', 'ors', 'graphhopper'].map(provider => new Promise(resolve => {
            S.password_lookup(schema(S), {provider}, cancellable, (_s, r) => {
                try { result[provider] = S.password_lookup_finish(r) || ''; } catch { /* Keyring unavailable. */ }
                resolve();
            });
        })));
        return result;
    } catch { return {}; }
    finally { if (timer) GLib.Source.remove(timer); }
}
export async function saveRoutingKey(provider, value) {
    const S = await secret();
    return new Promise((resolve, reject) => {
        const finish = (_s, r) => { try { resolve(value ? S.password_store_finish(r) : S.password_clear_finish(r)); } catch (e) { reject(e); } };
        if (value) S.password_store(schema(S), {provider}, S.COLLECTION_DEFAULT, `Ubuntu Island: ${provider}`, value, null, finish);
        else S.password_clear(schema(S), {provider}, null, finish);
    });
}
