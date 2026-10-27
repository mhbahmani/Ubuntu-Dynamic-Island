import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UbuntuIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        const themes = ['graphite', 'ocean', 'forest', 'ember'];
        const theme = new Adw.ComboRow({title: 'Color theme',
            model: Gtk.StringList.new(['Graphite', 'Ocean', 'Forest', 'Ember']),
            selected: Math.max(0, themes.indexOf(settings.get_string('color-theme')))});
        theme.connect('notify::selected', () => settings.set_string('color-theme', themes[theme.selected]));
        const themeChanged = settings.connect('changed::color-theme', () => {
            theme.selected = Math.max(0, themes.indexOf(settings.get_string('color-theme')));
        });
        window.connect('close-request', () => { settings.disconnect(themeChanged); return false; });
        appearance.add(theme);
        appearance.add(spin(settings, 'surface-opacity', 'Background opacity',
            '% · Text and controls stay fully opaque', 0, 100, 1));
        appearance.add(spin(settings, 'surface-matte', 'Matte backing',
            '% · Frosted solid tone behind the tint; 0 is clear glass', 0, 100, 1));
        appearance.add(spin(settings, 'pill-width', 'Collapsed width', 'px', 150, 210, 2));
        appearance.add(spin(settings, 'expanded-width', 'Expanded width', 'px', 380, 480, 4));
        appearance.add(spin(settings, 'animation-duration', 'Animation duration', 'ms', 0, 500, 10));
        appearance.add(toggle(settings, 'disable-animations', 'Disable animations',
            'Instant open/close regardless of system animation settings'));
        appearance.add(toggle(settings, 'move-clock', 'Move clock to the right',
            'Frees the panel center for the island'));

        const hover = new Adw.PreferencesGroup({title: 'Hover'});
        hover.add(toggle(settings, 'hover-open', 'Open on hover',
            'Expand after hovering the pill; click always works too'));
        hover.add(spin(settings, 'hover-open-delay', 'Open delay', 'ms', 100, 1000, 10));
        hover.add(spin(settings, 'hover-close-delay', 'Close delay', 'ms', 0, 2000, 10));

        const modules = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Module toggles and the sampling interval apply after disabling and re-enabling the extension.',
        });
        modules.add(toggle(settings, 'enable-media', 'Media controls'));
        modules.add(toggle(settings, 'enable-metrics', 'System metrics'));
        modules.add(spin(settings, 'metrics-interval', 'Metrics interval', 's', 1, 10, 1));
        modules.add(toggle(settings, 'enable-audio', 'Audio controls'));
        modules.add(toggle(settings, 'enable-bluetooth', 'Bluetooth controls'));
        modules.add(toggle(settings, 'enable-remote-art', 'Fetch remote album art',
            'Downloads artwork over the network with a bounded, host-checked cache'));

        const page = new Adw.PreferencesPage();
        page.add(appearance);
        page.add(hover);
        page.add(modules);
        window.add(page);
    }
}

function spin(settings, key, title, unit, lower, upper, step) {
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 10,
        value: settings.get_int(key),
    });
    const row = new Adw.SpinRow({title, subtitle: unit, adjustment});
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function toggle(settings, key, title, subtitle = null) {
    const row = new Adw.SwitchRow(subtitle ? {title, subtitle} : {title});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}
