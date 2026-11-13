// Read the host backend before preview.py creates its isolated environment.
import Gio from 'gi://Gio';
import {capturePreviewSettings} from '../tests/fixtures/preview-settings.js';

const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0], Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.ubuntu-island', false)});
const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
print(JSON.stringify(capturePreviewSettings(settings, desktop)));
