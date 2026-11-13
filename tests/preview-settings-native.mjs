import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {capturePreviewSettings, applyPreviewSettings} from './fixtures/preview-settings.js';

const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0], Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.ubuntu-island', false);
const settings = () => new Gio.Settings({settings_schema: schema, backend: Gio.memory_settings_backend_new()});
const desktop = () => new Gio.Settings({schema_id:'org.gnome.desktop.interface', backend: Gio.memory_settings_backend_new()});
const host = settings(), hostDesktop = desktop(), preview = settings(), previewDesktop = desktop();
const assert = (value, message) => { if (!value) throw Error(message); };
host.set_string('color-theme', 'ocean');
host.set_strv('pill-order', ['date', 'agents', 'media', 'network']);
host.set_boolean('pill-show-event', false);
host.set_int('expanded-width', 480);
host.set_value('pill-date-formats', new GLib.Variant('a{ss}', {jalali:'%d %MM %Y'}));
host.set_string('commute-routes', 'private routes');
host.set_string('weather-location', 'private location');
host.set_strv('calendar-event-sources', ['private account']);
host.set_string('agents-claude-config', '/private/config');
hostDesktop.set_double('text-scaling-factor', 1.5);
hostDesktop.set_boolean('enable-animations', false);
preview.set_boolean('pill-show-event', true);
const snapshot = JSON.parse(JSON.stringify(capturePreviewSettings(host, hostDesktop)));
applyPreviewSettings(preview, previewDesktop, snapshot);
for (const key of Object.keys(snapshot.extension))
    assert(preview.get_value(key).equal(host.get_value(key)), `UI setting lost: ${key}`);
assert(previewDesktop.get_double('text-scaling-factor') === 1.5 && !previewDesktop.get_boolean('enable-animations'), 'Desktop presentation lost');
for (const key of ['commute-routes', 'weather-location', 'calendar-event-sources', 'agents-claude-config', 'enable-weather'])
    assert(!(key in snapshot.extension), `Non-presentation setting exported: ${key}`);
assert(preview.get_string('commute-routes') === '[]' && preview.get_strv('calendar-event-sources').length === 0, 'Private settings were copied');
// Explicit overrides and later preview edits stay in the destination backend.
preview.set_int('expanded-width', 380);
preview.set_string('color-theme', 'forest');
previewDesktop.set_double('text-scaling-factor', 2);
assert(host.get_int('expanded-width') === 480 && host.get_string('color-theme') === 'ocean' && hostDesktop.get_double('text-scaling-factor') === 1.5,
    'Preview changed the host backend');
const defaults = settings();
applyPreviewSettings(defaults, desktop(), null);
assert(defaults.get_string('color-theme') === 'graphite', 'Default mode inherited UI settings');
print('PREVIEW SETTINGS PASS');
