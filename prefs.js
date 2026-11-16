import {shortcutRow} from './preferences/shortcut-prefs.js';
import {agentsPreferences} from './preferences/agents-prefs.js';
import {calendarPreferences, notchDatePreferences} from './preferences/calendar-prefs.js';
import {eventNotchPreferences} from './preferences/calendar-events-prefs.js';
import {AGENT_ICON_NAME, agentIconDirectory} from './ui/agent-icon.js';
import {commutePreferences} from './preferences/commute-prefs.js';
import {migrateArrowStyle, migrateOfflineMode, OFFLINE_MODES} from './services/notch-model.js';
import {notchPreview, notchStyles} from './preferences/notch-prefs.js';
import {weatherPreferences} from './preferences/weather-prefs.js';
import {notificationsPreferences} from './preferences/notifications-prefs.js';
import {THEMES, THEME_IDS, themeSwatchCss} from './services/themes.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UbuntuIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Latin keeps the established UI face; Persian falls through to the
        // user's Vazir/Vazirmatn font instead of the system's Arabic fallback.
        const fonts = new Gtk.CssProvider();
        fonts.load_from_data('.ubuntu-island-preferences { font-family: "Noto Sans", "Vazir", "Vazirmatn", "DejaVu Sans"; } .ubuntu-island-notch-chip { min-width: 16px; padding-left: 4px; padding-right: 4px; }\n' + themeSwatchCss(), -1);
        window.add_css_class('ubuntu-island-preferences');
        Gtk.StyleContext.add_provider_for_display(window.get_display(), fonts, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.connect('close-request', () => {
            Gtk.StyleContext.remove_provider_for_display(window.get_display(), fonts);
            return false;
        });
        const iconTheme = Gtk.IconTheme.get_for_display(window.get_display());
        const iconDirectory = agentIconDirectory.get_path();
        if (!iconTheme.get_search_path().includes(iconDirectory)) iconTheme.add_search_path(iconDirectory);
        const settings = this.getSettings();
        migrateArrowStyle(settings);
        migrateOfflineMode(settings);

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        const tabs = ['last', 'media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents', 'notifications', 'calendar'];
        const opening = new Adw.ComboRow({title: 'Opening tab',
            model: Gtk.StringList.new(['Last used tab', 'Media', 'System', 'Sound', 'Bluetooth', 'Weather', 'Commute', 'Agents', 'Notifications', 'Calendar'])});
        const openingFactory = new Gtk.SignalListItemFactory();
        openingFactory.connect('setup', (_factory, item) => item.set_child(new Gtk.Label({xalign: 0})));
        openingFactory.connect('bind', (_factory, item) => { item.get_child().label = item.get_item().get_string(); });
        opening.factory = openingFactory;
        const syncOpening = () => { opening.selected = Math.max(0, tabs.indexOf(settings.get_string('expand-tab'))); };
        syncOpening();
        opening.connect('notify::selected', () => settings.set_string('expand-tab', tabs[opening.selected]));
        const openingId = settings.connect('changed::expand-tab', syncOpening);
        window.connect('close-request', () => { settings.disconnect(openingId); return false; });
        appearance.add(opening);
        const themes = THEME_IDS;
        const theme = new Adw.ComboRow({title: 'Color theme',
            model: Gtk.StringList.new(themes.map(id => THEMES[id].label)),
            selected: Math.max(0, themes.indexOf(settings.get_string('color-theme')))});
        // Each option previews the theme: tint gradient chip, accent dot, name.
        const themeFactory = new Gtk.SignalListItemFactory();
        themeFactory.connect('setup', (_factory, item) => {
            const row = new Gtk.Box({spacing: 10});
            // hexpand: false stops the dot's expand flag propagating, so every
            // chip keeps the same width whatever the theme name's length.
            const swatch = new Gtk.Box({css_classes: ['ubuntu-island-theme-swatch'], valign: Gtk.Align.CENTER,
                hexpand: false, width_request: 40});
            swatch.append(new Gtk.Box({css_classes: ['ubuntu-island-theme-swatch-accent'],
                hexpand: true, halign: Gtk.Align.END, valign: Gtk.Align.CENTER}));
            row.append(swatch);
            row.append(new Gtk.Label({xalign: 0, hexpand: true}));
            item.set_child(row);
        });
        themeFactory.connect('bind', (_factory, item) => {
            // ComboRow's selected-value model has position zero for every
            // selection. Bind to the actual StringObject instead.
            const name = item.get_item().get_string();
            const id = themes.find(id => THEMES[id].label === name) ?? themes[0];
            const swatch = item.get_child().get_first_child();
            swatch.set_css_classes(['ubuntu-island-theme-swatch', `ubuntu-island-theme-swatch-${id}`]);
            swatch.get_next_sibling().label = THEMES[id].label;
        });
        theme.factory = themeFactory;
        theme.connect('notify::selected', () => settings.set_string('color-theme', themes[theme.selected]));
        const themeChanged = settings.connect('changed::color-theme', () => {
            theme.selected = Math.max(0, themes.indexOf(settings.get_string('color-theme')));
        });
        window.connect('close-request', () => { settings.disconnect(themeChanged); return false; });
        appearance.add(theme);
        appearance.add(spin(settings, 'surface-opacity', 'Background opacity',
            '% · Tint strength; text and controls stay fully opaque', 0, 100, 1));
        appearance.add(spin(settings, 'surface-matte', 'Matte tone',
            '% · Frosted-glass blur behind the panel; opacity is unchanged', 0, 100, 1));
        appearance.add(spin(settings, 'pill-width', 'Minimum collapsed width', 'px · Grows to fit enabled indicators', 150, 210, 2));
        appearance.add(spin(settings, 'expanded-width', 'Expanded width', 'px', 380, 480, 4));
        appearance.add(spin(settings, 'expanded-max-height', 'Maximum expanded height',
            'px · Notifications and Agents grow with their content up to this height', 280, 640, 8));
        appearance.add(spin(settings, 'animation-duration', 'Animation duration', 'ms', 0, 500, 10));
        appearance.add(toggle(settings, 'disable-animations', 'Disable animations',
            'Instant open/close regardless of system animation settings'));
        appearance.add(toggle(settings, 'move-clock', 'Move clock to the right',
            'Frees the panel center for the island'));

        const shortcuts = new Adw.PreferencesGroup({title:'Keyboard shortcuts'});
        for (const [key, title, subtitle] of [
            ['island-toggle-shortcut', 'Open or close island', 'Toggle the expanded island from anywhere.'],
            ['island-next-tab-shortcut', 'Next tab', 'Move to the next available tab. Ctrl+Tab also works while open.'],
            ['island-previous-tab-shortcut', 'Previous tab', 'Move back one tab. Ctrl+Shift+Tab also works while open.'],
        ]) shortcuts.add(shortcutRow(settings, window, key, title, subtitle));

        const hover = new Adw.PreferencesGroup({title: 'Hover'});
        hover.add(toggle(settings, 'hover-open', 'Open on hover',
            'Expand after hovering the pill; click always works too'));
        hover.add(spin(settings, 'hover-open-delay', 'Open delay', 'ms', 100, 1000, 10));
        hover.add(spin(settings, 'hover-close-delay', 'Close delay', 'ms', 0, 2000, 10));


        const modules = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Calendar changes apply immediately. Other module toggles and the sampling interval apply after disabling and re-enabling the extension.',
        });
        modules.add(toggle(settings, 'enable-media', 'Media controls'));
        modules.add(toggle(settings, 'enable-metrics', 'System metrics'));
        modules.add(spin(settings, 'metrics-interval', 'Metrics interval', 's', 1, 10, 1));
        modules.add(toggle(settings, 'enable-audio', 'Audio controls'));
        modules.add(toggle(settings, 'enable-bluetooth', 'Bluetooth controls'));
        modules.add(toggle(settings, 'enable-calendar', 'Calendar',
            'Show or hide the tab immediately · Choose calendars in Calendar settings'));
        modules.add(toggle(settings, 'enable-remote-art', 'Fetch remote album art',
            'Downloads artwork over the network with a bounded, host-checked cache'));

        const notch = new Adw.PreferencesGroup({title: 'Collapsed notch',
            description: 'Indicators require their modules to be enabled. Changes apply immediately.'});
        const styles = ['island', 'panel', 'auto-hide'];
        const style = new Adw.ComboRow({title: 'Notch style',
            subtitle: 'Blend uses the top bar’s color and height while collapsed. Auto-hide keeps the island above the screen edge: rest the pointer at the top edge to reveal it, then click or hover to open.',
            model: Gtk.StringList.new(['Floating island', 'Blend with top bar', 'Auto-hide'])});
        const reveal = spin(settings, 'auto-hide-reveal-delay', 'Auto-hide reveal delay',
            'ms · Passing movements along the edge restart the wait', 100, 1500, 50);
        const syncStyle = () => {
            style.selected = Math.max(0, styles.indexOf(settings.get_string('pill-style')));
            reveal.sensitive = settings.get_string('pill-style') === 'auto-hide';
        };
        syncStyle();
        style.connect('notify::selected', () => settings.set_string('pill-style', styles[style.selected]));
        const styleId = settings.connect('changed::pill-style', syncStyle);
        window.connect('close-request', () => { settings.disconnect(styleId); return false; });
        notch.add(style);
        notch.add(reveal);
        notch.add(spin(settings, 'pill-text-scale', 'Text size', '% · Icons follow; the notch grows taller when needed', 80, 150, 5));
        notch.add(toggle(settings, 'pill-show-title', 'Show music name'));
        notch.add(toggle(settings, 'pill-show-weather', 'Show weather icon',
            'Refreshes weather while the collapsed notch is visible'));
        notch.add(toggle(settings, 'pill-show-commute', 'Show Commute ETA',
            'Selected route · Refreshes while visible · ! means stale'));
        notch.add(toggle(settings, 'pill-show-network', 'Show upload/download rates',
            'Uses existing System metrics samples'));
        const layouts = ['inline', 'stacked'];
        const networkLayout = new Adw.ComboRow({title: 'Rates layout',
            subtitle: 'Stacked puts download above upload in smaller text and takes less width.',
            model: Gtk.StringList.new(['Side by side', 'Stacked'])});
        const syncLayout = () => { networkLayout.selected = Math.max(0, layouts.indexOf(settings.get_string('pill-network-layout'))); };
        syncLayout();
        networkLayout.connect('notify::selected', () => settings.set_string('pill-network-layout', layouts[networkLayout.selected]));
        const layoutId = settings.connect('changed::pill-network-layout', syncLayout);
        window.connect('close-request', () => { settings.disconnect(layoutId); return false; });
        settings.bind('pill-show-network', networkLayout, 'sensitive', Gio.SettingsBindFlags.GET);
        notch.add(networkLayout);
        notch.add(toggle(settings, 'pill-cpu-hide-idle', 'Hide CPU dot while load is low',
            'The colored dot appears only at or above the threshold'));
        const cpuThreshold = spin(settings, 'pill-cpu-idle-threshold', 'CPU dot threshold',
            '% load · Hides again 5 points below, so it does not flicker', 5, 95, 5);
        settings.bind('pill-cpu-hide-idle', cpuThreshold, 'sensitive', Gio.SettingsBindFlags.GET);
        notch.add(cpuThreshold);
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
            'Character limit · trim', 'Scroll overflowing title', 'Fit width to title']),
            subtitle: 'Fit mode caps the title at 240 px and the notch at 60% of the monitor (up to 600 px).'});
        const characters = spin(settings, 'pill-title-characters', 'Title character limit', '5–40 characters · trim mode only; short titles use less space', 5, 40, 1);
        const syncTitle = () => {
            titleMode.selected = Math.max(0, titleModes.indexOf(settings.get_string('pill-title-mode')));
            characters.sensitive = settings.get_string('pill-title-mode') === 'fixed';
        };
        titleMode.connect('notify::selected', () => settings.set_string('pill-title-mode', titleModes[titleMode.selected]));
        syncTitle();
        const titleModeId = settings.connect('changed::pill-title-mode', syncTitle);
        window.connect('close-request', () => { settings.disconnect(titleModeId); return false; });
        titles.add(titleMode); titles.add(characters);
        const time = new Adw.PreferencesGroup({title: 'Time in the notch', description: 'Uses your desktop’s local time zone.'});
        time.add(toggle(settings, 'pill-show-time', 'Show time in notch'));
        const hour24 = toggle(settings, 'pill-time-24h', 'Use 24-hour time', 'Turn off for 12-hour time with AM/PM');
        const seconds = toggle(settings, 'pill-time-seconds', 'Show seconds', 'Updates only while the time is visible in the collapsed notch');
        settings.bind('pill-show-time', hour24, 'sensitive', Gio.SettingsBindFlags.GET);
        settings.bind('pill-show-time', seconds, 'sensitive', Gio.SettingsBindFlags.GET);
        time.add(hour24); time.add(seconds);
        const pages = [
            ['appearance', 'Appearance', 'preferences-desktop-appearance-symbolic', [appearance, shortcuts]],
            ['notch', 'Notch', 'view-reveal-symbolic', [notchStyles(settings, window), notchPreview(settings, window), notch, notchDatePreferences(settings, window), time, eventNotchPreferences(settings, window), titles, hover]],
            ['modules', 'Modules', 'application-x-addon-symbolic', [modules]],
            ['weather', 'Weather', 'weather-clear-symbolic', [weatherPreferences(settings, window)]],
            ['commute', 'Commute', 'find-location-symbolic', commutePreferences(settings, window)],
            ['agents', 'Agents', AGENT_ICON_NAME, agentsPreferences(settings, window, this.path)],
            ['notifications', 'Notifications', 'preferences-system-notifications-symbolic', notificationsPreferences(settings, window)],
            ['calendar', 'Calendar', 'x-office-calendar-symbolic', calendarPreferences(settings, window)],
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
