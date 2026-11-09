import {agentsPreferences} from './agents-prefs.js';
import {commutePreferences} from './commute-prefs.js';
import {migrateArrowStyle, migrateOfflineMode, OFFLINE_MODES} from './services/notch-model.js';
import {notchPreview, notchStyles} from './notch-prefs.js';
import {weatherPreferences} from './weather-prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UbuntuIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        migrateArrowStyle(settings);
        migrateOfflineMode(settings);

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        const tabs = ['last', 'media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents'];
        const opening = new Adw.ComboRow({title: 'Open on expand',
            subtitle: 'Applies on the next opening. Unavailable tabs keep the last available tab.',
            model: Gtk.StringList.new(['Last used tab', 'Media', 'System', 'Sound', 'Bluetooth', 'Weather', 'Commute', 'Agents'])});
        const syncOpening = () => { opening.selected = Math.max(0, tabs.indexOf(settings.get_string('expand-tab'))); };
        syncOpening();
        opening.connect('notify::selected', () => settings.set_string('expand-tab', tabs[opening.selected]));
        const openingId = settings.connect('changed::expand-tab', syncOpening);
        window.connect('close-request', () => { settings.disconnect(openingId); return false; });
        appearance.add(opening);
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
        appearance.add(spin(settings, 'surface-matte', 'Matte tone',
            '% · Flattens the color gradient without changing opacity', 0, 100, 1));
        appearance.add(spin(settings, 'pill-width', 'Minimum collapsed width', 'px · Grows to fit enabled indicators', 150, 210, 2));
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

        const notch = new Adw.PreferencesGroup({title: 'Collapsed notch',
            description: 'Indicators require their modules to be enabled. Changes apply immediately.'});
        notch.add(toggle(settings, 'pill-show-title', 'Show music name'));
        notch.add(toggle(settings, 'pill-show-weather', 'Show weather icon',
            'Refreshes weather while the collapsed notch is visible'));
        notch.add(toggle(settings, 'pill-show-commute', 'Show Commute ETA',
            'Selected route · Refreshes while visible · ~ means no live traffic; ! means stale'));
        notch.add(toggle(settings, 'pill-show-network', 'Show upload/download rates',
            'Uses existing System metrics samples'));
        const offline = new Adw.ComboRow({title: 'When offline',
            subtitle: 'Broken edge adds a split amber underline. Hide keeps fresh cached values.',
            model: Gtk.StringList.new(['Connection icon', 'Broken edge', 'Hide unavailable indicators'])});
        const syncOffline = () => { offline.selected = Math.max(0, OFFLINE_MODES.indexOf(settings.get_string('pill-offline-mode'))); };
        syncOffline();
        offline.connect('notify::selected', () => settings.set_string('pill-offline-mode', OFFLINE_MODES[offline.selected]));
        const offlineId = settings.connect('changed::pill-offline-mode', syncOffline);
        window.connect('close-request', () => { settings.disconnect(offlineId); return false; });
        notch.add(offline);
        const titles = new Adw.PreferencesGroup({title: 'Music name',
            description: 'Choose one behavior for the collapsed notch. The full title remains available to screen readers.'});
        const titleModes = ['fixed', 'scroll', 'fit'];
        const titleMode = new Adw.ComboRow({title: 'Music name behavior', model: Gtk.StringList.new([
            'Fixed width · trim', 'Scroll overflowing title', 'Fit width to title']),
            subtitle: 'Fit mode caps the title at 240 px and the notch at 60% of the monitor (up to 600 px).'});
        const characters = spin(settings, 'pill-title-characters', 'Title character limit', '5–40 characters · fixed mode only', 5, 40, 1);
        const syncTitle = () => {
            titleMode.selected = Math.max(0, titleModes.indexOf(settings.get_string('pill-title-mode')));
            characters.sensitive = settings.get_string('pill-title-mode') === 'fixed';
        };
        titleMode.connect('notify::selected', () => settings.set_string('pill-title-mode', titleModes[titleMode.selected]));
        syncTitle();
        const titleModeId = settings.connect('changed::pill-title-mode', syncTitle);
        window.connect('close-request', () => { settings.disconnect(titleModeId); return false; });
        titles.add(titleMode); titles.add(characters);
        const pages = [
            ['appearance', 'Appearance', 'preferences-desktop-appearance-symbolic', [appearance]],
            ['notch', 'Notch', 'view-reveal-symbolic', [notchStyles(settings, window), notchPreview(settings, window), notch, titles, hover]],
            ['modules', 'Modules', 'application-x-addon-symbolic', [modules]],
            ['weather', 'Weather', 'weather-clear-symbolic', [weatherPreferences(settings, window)]],
            ['commute', 'Commute', 'find-location-symbolic', commutePreferences(settings, window)],
            ['agents', 'Agents', 'system-run-symbolic', agentsPreferences(settings, window, this.path)],
        ];
        window.search_enabled = true;
        for (const [name, title, icon_name, groups] of pages) {
            const page = new Adw.PreferencesPage({name, title, icon_name});
            for (const group of groups) page.add(group);
            window.add(page);
        }
        if (pages.some(p => p[0] === settings.get_string('preferences-page')))
            window.set_visible_page_name(settings.get_string('preferences-page'));
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
