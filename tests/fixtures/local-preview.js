// Development-only wrapper; never packaged or installed.
import Pango from 'gi://Pango';
import UbuntuIsland from './implementation.js';
import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {localTime} from './services/weather-model.js';
import {formatRate} from './services/proc.js';
import {TAB_MAX_WIDTH, REGULAR_HEIGHT, GROWING_PAGES} from './ui/card.js';
import {agentIcon} from './ui/agent-icon.js';
import {sampleDevices, sampleAgents, sampleCalendar, sampleNotifications, postNotification} from './preview-data.js';
import {THEMES, THEME_IDS, themeAccent} from './services/appearance.js';
import {notchTime} from './services/notch-model.js';
import {applyPreviewSettings} from './preview-settings.js';
import {civilDay, todayDay, fullDate, calendarTodayLabel, monthTitle, primaryCalendar, notchDate, notchDates, formatNotchDate} from './services/calendar-model.js';

export default class Preview extends UbuntuIsland {
    enable() {
        this._previewConfigured = false;
        const settings = this.getSettings();
        const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const uiSettings = GLib.getenv('ISLAND_PREVIEW_UI_SETTINGS');
        const snapshot = uiSettings ? JSON.parse(uiSettings) : null;
        settings.set_int('expanded-width', 440);
        desktop.set_double('text-scaling-factor', 1);
        // Setup buttons in the preview must never modify real CLI configuration.
        for (const provider of ['claude', 'codex', 'opencode'])
            settings.set_string(`agents-${provider}-config`, `${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/agent-configs/${provider}`);
        for (const module of ['media', 'metrics', 'audio', 'bluetooth', 'weather', 'commute', 'agents', 'notifications', 'calendar'])
            settings.set_boolean(`enable-${module}`, true);
        for (const indicator of ['title', 'weather', 'network', 'commute', 'agents', 'date'])
            settings.set_boolean(`pill-show-${indicator}`, true);
        settings.set_string('pill-offline-mode', 'icon');
        settings.set_string('commute-routes', JSON.stringify([{id: 'sample', name: 'Heading home (sample)', originMode: 'fixed', originName: 'Work', destinationName: 'Home', origin: {latitude: 35.7219, longitude: 51.3347}, destination: {latitude: 35.6892, longitude: 51.389}}]));
        settings.set_string('commute-selected', 'sample');
        settings.set_string('weather-motion', 'live');
        settings.set_string('weather-location', JSON.stringify({name: GLib.getenv('ISLAND_PREVIEW_LIVE') === '1' ? 'Tehran, Iran' : 'Tehran, Iran (sample)',
            latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran'}));
        applyPreviewSettings(settings, desktop, snapshot);
        // Explicit command-line options take precedence over the host snapshot.
        if (GLib.getenv('ISLAND_PREVIEW_CARD_WIDTH')) settings.set_int('expanded-width', Number(GLib.getenv('ISLAND_PREVIEW_CARD_WIDTH')));
        if (GLib.getenv('ISLAND_PREVIEW_TEXT_SCALE')) desktop.set_double('text-scaling-factor', Number(GLib.getenv('ISLAND_PREVIEW_TEXT_SCALE')));
        if (GLib.getenv('ISLAND_PREVIEW_OFFLINE_STYLE')) settings.set_string('pill-offline-mode', GLib.getenv('ISLAND_PREVIEW_OFFLINE_STYLE'));
        if (GLib.getenv('ISLAND_PREVIEW_MOTION')) settings.set_string('weather-motion', GLib.getenv('ISLAND_PREVIEW_MOTION'));
        super.enable();
        // Keep provider controllers inactive until the sample adapters are ready.
        this._weather.setActive(false);
        this._commute.setActive(false);
        const sample = GLib.getenv('ISLAND_PREVIEW_LIVE') !== '1';
        sampleDevices(this, sample);
        sampleAgents(this);
        sampleCalendar(this, {enableIndicator: !snapshot});
        sampleNotifications();
        const connection = GLib.getenv('ISLAND_PREVIEW_CONNECTION') || 'online';
        if (connection !== 'auto') {
            this._connectivity.stop();
            this._renderConnectivity(connection);
        }
        // Nested Mutter can lose the physical pointer release across a modal
        // seat grab. The preview owns a private stage, so observe its events
        // without taking a modal grab. Installed extension behavior is unchanged.
        this._island._takeGrab = () => true;
        this._previewInput = global.stage.connect('captured-event', (_stage, event) => {
            if (!this._island?.expanded || this._island._grabSuspended) return Clutter.EVENT_PROPAGATE;
            const type = event.type();
            if ([Clutter.EventType.BUTTON_PRESS, Clutter.EventType.TOUCH_BEGIN].includes(type)) {
                const [x, y] = event.get_coords();
                const [left, top] = this._island.actor.get_transformed_position();
                const [width, height] = this._island.actor.get_transformed_size();
                if (x < left || x >= left + width || y < top || y >= top + height)
                    this._island._armDismissal(0);
            } else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._island._onEscape?.()) return Clutter.EVENT_STOP;
                this._island._armDismissal(0);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        if (GLib.getenv('ISLAND_PREVIEW_IGNORE_POWER') === '1')
            this._card._weatherView.scene.isPowerSaving = () => false;
        if (sample) {
            this._weather.controller.online = () => true;
            this._commute.controller.keys = async () => ({});
            this._commute.controller.locate = async () => ({latitude: 35.7219, longitude: 51.3347});
            const emitCommute = this._commute.controller.emit;
            this._commute.controller.emit = state => emitCommute({...state, sample: true});
            this._commute.http.get = async () => ({code: 'Ok', routes: [{duration: 1920, distance: 18400}]});
            this._weather.http.get = async () => ({
                current: {temperature_2m: 18, apparent_temperature: 16, relative_humidity_2m: 42,
                    wind_speed_10m: 12, is_day: GLib.getenv('ISLAND_PREVIEW_SCENE')?.endsWith('night') ? 0 : 1,
                    weather_code: {sun: 0, clouds: 2, rain: 63, snow: 73, night: 0, 'clouds-night': 2, 'rain-night': 63, 'snow-night': 73}[GLib.getenv('ISLAND_PREVIEW_SCENE')] ?? 2},
                hourly: {time: [1, 2, 3, 4].map(i => localTime('Asia/Tehran', Date.now() + i * 3600000)),
                    temperature_2m: [17, 16, 15, 14], precipitation_probability: [0, 20, 40, 60]},
                // wttr and MET Norway fields allow changing preferred source in sample mode too.
                current_condition: [{temp_C: '18', FeelsLikeC: '16', humidity: '42', windspeedKmph: '12',
                    weatherDesc: [{value: 'Partly cloudy (sample)'}]}],
                properties: {timeseries: [0, 1, 2, 3].map(i => ({time: new Date(Date.now() + i * 3600000).toISOString(),
                    data: {instant: {details: {air_temperature: 17 - i, apparent_air_temperature: 16 - i,
                        relative_humidity: 42, wind_speed: 12 / 3.6}},
                        next_1_hours: {summary: {symbol_code: GLib.getenv('ISLAND_PREVIEW_SCENE')?.endsWith('night')
                            ? 'partlycloudy_night' : 'partlycloudy_day'}}}}))},
            });
        }
        const emit = this._commute.controller.emit;
        this._commute.controller.emit = state => {
            emit(state);
            if (state.status === 'ready') console.log(`[Island Preview] Commute: ${Math.round(state.data.seconds / 60)} min via ${state.data.provider}`);
            if (state.status === 'error') console.warn(`[Island Preview] Commute: ${state.error}`);
        };
        this._previewConfigured = true;
        this._syncWeather();
        this._previewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._previewTimer = 0;
            Main.overview.hide();
            const tab = GLib.getenv('ISLAND_PREVIEW_TAB') || 'notch';
            this._card.selectPage(tab === 'notch' ? 'media' : tab);
            const calendarDate = GLib.getenv('ISLAND_PREVIEW_CALENDAR_DATE');
            if (tab === 'calendar' && calendarDate)
                this._card._calendarView.select(civilDay(...calendarDate.split('-').map(Number)));
            if (tab === 'notch') this._island.collapse();
            else this._island.expand();
            const preferences = GLib.getenv('ISLAND_PREVIEW_PREFERENCES');
            if (preferences) {
                this._settings.set_string('preferences-page', preferences);
                this._openPreferencesLive();
            }
            if (GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1') this._openPreferencesLive('commute');
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_INPUT') === '1') this._checkInput().catch(error => console.error(`[Island Preview] INPUT FAIL: ${error.message}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_FULL') === '1') this._checkFullPreview().catch(error => console.error(`[Island Preview] FULL FAIL: ${error.message}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_AUDIO') === '1') this._checkAudio().catch(error => console.error(`[Island Preview] AUDIO FAIL: ${error.message}: ${error.stack}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_AGENT_METADATA') === '1') this._checkAgentMetadata().catch(error => console.error(`[Island Preview] AGENT METADATA FAIL: ${error.message}: ${error.stack}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_AGENT_HOVER') === '1') this._checkAgentHover().catch(error => console.error(`[Island Preview] AGENT HOVER FAIL: ${error.message}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_NOTIFICATIONS') === '1') this._checkNotifications().catch(error => console.error(`[Island Preview] NOTIFICATIONS FAIL: ${error.message}: ${error.stack}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_CALENDAR') === '1') this._checkCalendar().catch(error => console.error(`[Island Preview] CALENDAR FAIL: ${error.message}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_COMMUTE') === '1') this._checkCommute().catch(error => console.error(`[Island Preview] COMMUTE FAIL: ${error.message}: ${error.stack}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_MOTION') === '1')
                import('./motion-check.js').then(module => module.checkMotion(this))
                    .catch(error => console.error(`[Island Preview] MOTION FAIL: ${error.message}: ${error.stack}`));
            const monitor = Main.layoutManager.primaryMonitor;
            const uiScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            console.log(`[Island Preview] READY: ${monitor.width}x${monitor.height}, ${uiScale * 100}% UI; all modules enabled; ${tab === 'notch' ? 'collapsed notch' : tab} visible. Device controls use sample data.`);
            if (['FULL', 'AUDIO', 'CALENDAR', 'COMMUTE', 'MOTION', 'NOTIFICATIONS'].some(check => GLib.getenv(`ISLAND_PREVIEW_CHECK_${check}`) === '1')) return GLib.SOURCE_REMOVE;
            this._captureTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GLib.getenv('ISLAND_PREVIEW_LIVE') === '1' ? 20000 : GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1' || preferences ? 8000 : 1500, () => {
                this._captureTimer = 0;
                this._capture().catch(error => console.warn(`[Island Preview] Screenshot: ${error.message}`));
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncWeather() {
        // Do not start provider requests before the fixture adapters are ready.
        if (this._previewConfigured) super._syncWeather();
    }

    async _checkInput() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const click = async (x, y) => {
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await delay(50);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            await delay(80);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(400);
        };
        this._island.expand();
        await delay(800);
        for (let i = 0; i < 3; i++) {
            await click(50, 500);
            if (this._island.expanded || this._island._grab) throw new Error('Dismissal retained expansion/grab');
            const pill = this._pill.actor;
            const [x, y] = pill.get_transformed_position();
            await click(x + pill.width / 2, y + pill.height / 2);
            if (!this._island.expanded) throw new Error('Notch could not reopen');
        }
        await click(50, 500);
        const date = Main.panel.statusArea.dateMenu;
        const [x, y] = date.get_transformed_position();
        await click(x + date.width / 2, y + date.height / 2);
        if (!date.menu.isOpen) throw new Error('Top-bar date menu did not respond');
        date.menu.close();
        console.log('[Island Preview] INPUT PASS: three dismiss/reopen cycles and top-bar menu');
    }

    async _checkFullPreview() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        await delay(500);
        const pill = this._pill;
        const connection = GLib.getenv('ISLAND_PREVIEW_CONNECTION') || 'online';
        assert(!this._island.expanded, 'Default preview must start collapsed');
        assert(pill._media.visible && pill._cpuDot.visible && pill._bluetooth.visible, 'Local notch indicators missing');
        if (connection === 'online')
            assert(pill._weather.visible && pill._network.visible && pill._commute.visible, 'Online notch data missing');
        else if (connection !== 'auto') {
            const style = this._settings.get_string('pill-offline-mode');
            assert(pill._connection.visible === (style !== 'hide'), 'Offline indicator does not match selected style');
            assert(this._island._connectionEdge.visible === (style === 'edge'), 'Offline edge does not match selected style');
        }
        if (connection === 'online') await this._checkNetworkWidths();
        await this._checkNavigation();
        let navigationY = null;
        for (const tab of ['media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents', 'notifications', 'calendar']) {
            assert(this._card._pages.get(tab)?.available, `${tab} module unavailable`);
            this._card.selectPage(tab);
            this._island.expand();
            await delay(400);
            // List tabs follow their content between the regular height and the
            // configured maximum; the bar heading the card never moves.
            const tabScale = St.ThemeContext.get_for_stage(global.stage).scale_factor, border = this._island._border;
            const regular = REGULAR_HEIGHT * tabScale + border, height = this._island.actor.height;
            const max = Math.min(this._settings.get_int('expanded-max-height') * tabScale + border, this._island._heightBudget());
            if (GROWING_PAGES.has(tab)) assert(height >= regular - 1 && height <= max + 1, `${tab} height ${height} outside ${regular}–${max}`);
            else assert(Math.abs(height - regular) <= 1, `${tab} height ${height}, expected ${regular}`);
            if (tab === 'notifications') {
                assert(height > regular + 1, 'Sample notifications did not grow the tab');
                this._settings.set_int('expanded-max-height', 300); await delay(400);
                assert(Math.abs(this._island.actor.height - (Math.min(300 * tabScale + border, this._island._heightBudget()))) <= 1,
                    'Maximum height setting did not cap Notifications');
                this._settings.reset('expanded-max-height'); await delay(400);
                assert(Math.abs(this._island.actor.height - height) <= 1, 'Resetting the maximum did not restore Notifications');
            }
            const y = this._card._navigation.get_transformed_position()[1];
            navigationY ??= y;
            assert(Math.abs(y - navigationY) <= 1, `Switching to ${tab} moved navigation`);
            if (tab === 'weather') {
                const surface = this._card._weatherView.surface, nav = this._card._navigation;
                const top = surface.get_transformed_position()[1], navBottom = nav.get_transformed_position()[1] + nav.height;
                const cardBottom = this._island.actor.get_transformed_position()[1] + this._island.actor.height;
                const gap = cardBottom - (top + surface.height);
                const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                assert(top >= navBottom - 1, 'Weather surface overlaps navigation');
                assert(gap <= 8 * scale, `Surplus band below weather: ${gap / scale}px`);
            }
            await this._capture(`preview-${tab}`);
        }
        this._media.command('PlayPause');
        assert(this._states.media.status === 'Paused', 'Sample playback control failed');
        this._media.command('PlayPause');
        this._audio.setVolume(0.35);
        assert(this._states.audio.volume === 0.35, 'Sample volume control failed');
        this._audio.selectOutput(2);
        assert(this._states.audio.outputs.find(output => output.id === 'bluetooth:sample').active, 'Sample output control failed');
        this._bluetooth.toggle(this._states.bluetooth.devices[1]);
        assert(this._states.bluetooth.devices[1].connected, 'Sample Bluetooth control failed');
        await this._checkAudio();
        await this._checkAgents();
        this._card.selectPage('media');
        this._island.collapse();
        await delay(400);
        await this._capture('notch');
        console.log('[Island Preview] FULL PASS: populated notch, all nine tabs, sample controls and Agents interactions');
    }

    async _checkNavigation() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const card = this._card, settings = this._settings;
        const context = St.ThemeContext.get_for_stage(global.stage);
        const text = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        const original = {scale:context.scale_factor, text:text.get_double('text-scaling-factor'),
            width:settings.get_int('expanded-width'), opacity:settings.get_int('surface-opacity'),
            theme:settings.get_string('color-theme'), page:card._page,
            available:new Map([...card._pages].map(([id,page]) => [id,page.available]))};
        let shown = false, hidden = false;
        const bounds = actor => [actor.get_transformed_position()[0], actor.get_transformed_size()[0]];
        // Caption and tab widths are fitted on an idle after layout; a busy
        // headless shell can delay it past a fixed wait.
        const settle = async () => {
            for (let i = 0; i < 50 && (card._navigationFit || card._sliderSnap); i++) await delay(20);
            await delay(40); // the fit's tab widths are allocated on the next frame
        };
        try {
            this._island.expand();
            // Measure the settled card, not the scaled opening transition.
            await delay(400);
            for (const scale of [1,2]) for (const font of [1,2]) for (const width of [380,440,480]) {
                context.scale_factor = scale; text.set_double('text-scaling-factor',font);
                settings.set_int('expanded-width',width);
                for (const count of [2,4,9]) {
                    const enabled = ['bluetooth','calendar','system','audio','weather','commute','agents','media','notifications'].slice(0,count);
                    for (const [id,page] of card._pages) page.available = enabled.includes(id);
                    card.selectPage('bluetooth'); await delay(80); await settle();
                    const tabs = [...card._tabs.values()].filter(tab => tab.visible);
                    assert(tabs.length === count, 'Navigation did not follow available modules');
                    const [left, navWidth] = bounds(card._navigation);
                    const controls = [...tabs, ...(card._pageCaption.visible ? [card._pageCaption] : []), card._preferencesButton];
                    let end = left;
                    for (const actor of controls) {
                        const [x,w] = bounds(actor);
                        assert(x >= end - 1 && x + w <= left + navWidth + 1,
                            `Overlapping navigation at ${width}px/${scale}x/${font} text/${count} tabs`);
                        end = x + w;
                    }
                    assert(tabs.every(tab => Math.abs(tab.width - tabs[0].width) <= 1), 'Tabs do not share one width');
                    assert(tabs[0].width <= TAB_MAX_WIDTH * scale + 1, `Tabs grew past the cap at ${width}px/${scale}x/${count} tabs`);
                    if (count === 2) assert(tabs[0].width >= TAB_MAX_WIDTH * scale - 1, `Few tabs did not spread at ${width}px/${scale}x/${font} text`);
                    assert(card.actor.get_first_child() === card._navigation, 'Navigation does not head the card');
                    const stripSpacing = card._tabStrip.get_theme_node().get_length('spacing');
                    assert(tabs.every((tab, i) => !i || Math.abs(bounds(tab)[0] - (bounds(tabs[i - 1])[0] + tabs[i - 1].width + stripSpacing)) <= 1),
                        `Tabs are not packed at ${width}px/${scale}x/${font} text/${count} tabs`);
                    const [gearX, gearWidth] = bounds(card._preferencesButton);
                    const navPadding = card._navigation.get_theme_node().get_padding(St.Side.RIGHT);
                    assert(Math.abs(gearX + gearWidth - (left + navWidth - navPadding)) <= 1, 'Settings left the trailing edge');
                    if (card._pageCaption.visible) {
                        shown = true;
                        const layout = card._pageCaption.clutter_text.get_layout().copy(); layout.set_width(-1);
                        assert(card._pageCaption.width + 1 >= layout.get_pixel_size()[0], 'Visible tab caption was squeezed');
                    } else hidden = true;
                    const before = tabs.map(bounds);
                    settings.set_int('surface-opacity',settings.get_int('surface-opacity') === 75 ? 98 : 75);
                    settings.set_string('color-theme',settings.get_string('color-theme') === 'ocean' ? 'graphite' : 'ocean');
                    await delay(60); await settle();
                    assert(card.actor.has_style_class_name('ubuntu-island-with-calendar') && card.actor.has_style_class_name('ubuntu-island-with-agents'),
                        'Appearance update discarded module layout classes');
                    assert(tabs.every((tab,i) => bounds(tab).every((v,j) => Math.abs(v-before[i][j]) <= 1)),
                        'Appearance update changed navigation geometry');
                    const captionShown = card._pageCaption.visible;
                    for (const id of enabled) {
                        card.selectPage(id); await delay(40); await settle();
                        assert(card._pageCaption.visible === captionShown, 'Changing tab names changed caption visibility');
                        assert(tabs.every((tab,i) => bounds(tab).every((v,j) => Math.abs(v-before[i][j]) <= 1)),
                            `Changing to ${id} moved navigation icons at ${width}px/${scale}x/${font} text`);
                        if (captionShown) {
                            const caption = card._pageCaption, node = caption.get_theme_node();
                            const layout = caption.clutter_text.get_layout().copy(); layout.set_width(-1);
                            assert(caption.width - node.get_horizontal_padding() + 1 >= layout.get_pixel_size()[0],
                                `Reserved caption slot cannot fit ${id}`);
                            const textEnd = bounds(caption.clutter_text)[0] + layout.get_pixel_size()[0];
                            assert(bounds(card._preferencesButton)[0] - textEnd >= 8 * scale - 1,
                                'Tab name is too close to Settings');
                        }
                    }
                    card.selectPage('bluetooth'); await delay(40);
                    if (scale === 1 && width === 440 && count === 8)
                        await this._capture(`navigation-text-${font}`);
                    if (scale === 1 && width === 380 && font === 2 && count === 8)
                        await this._capture('navigation-icons-only');
                }
            }
            assert(shown && hidden, 'Caption did not adapt to available space');
            console.log('[Island Preview] NAVIGATION PASS: fixed caption slots, Settings separation, stable tab switching, 2/4/8 tabs, 380/440/480px, 100/200% scale and text, live appearance stability');
        } finally {
            context.scale_factor = original.scale; text.set_double('text-scaling-factor',original.text);
            settings.set_int('expanded-width',original.width); settings.set_int('surface-opacity',original.opacity);
            settings.set_string('color-theme',original.theme);
            for (const [id,available] of original.available) card._pages.get(id).available = available;
            card.selectPage(original.page);
        }
    }

    async _checkNetworkWidths() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const pill = this._pill, state = this._states.system;
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const originalText = text.get_double('text-scaling-factor');
        const context = St.ThemeContext.get_for_stage(global.stage);
        const originalScale = context.scale_factor;
        const animations = this._settings.get_boolean('disable-animations');
        const render = (rxBytes, txBytes, iface = state.iface) => this._renderSystem({...state,
            rxBytes, txBytes, rx:formatRate(rxBytes), tx:formatRate(txBytes), iface});
        const fits = () => {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            for (const rate of [pill._down, pill._up])
                assert(rate.width >= rate.clutter_text.get_preferred_width(-1)[1] + 4 * scale,
                    'Network rate is clipped after a value or font change');
        };
        const compact = () => {
            for (const rate of [pill._down, pill._up]) {
                const layout = rate.clutter_text.get_layout().copy();
                layout.set_width(-1);
                let widest = 0;
                for (const template of ['888B', '888K', '8.8K', '8.8M', '888M', '8.8G', '888G']) {
                    layout.set_text(template, -1);
                    widest = Math.max(widest, layout.get_pixel_size()[0]);
                }
                assert(rate.width === Math.ceil(widest) + 4 * context.scale_factor,
                    'Bandwidth slot differs from the fixed reference plus 4px');
            }
        };
        try {
            this._settings.set_boolean('disable-animations', true);
            render(500 * 1024, 500 * 1024); await delay(150); compact();
            const width = this._island.actor.width, networkWidth = pill._network.width;
            for (const value of [0, 9, 888, 9.9 * 1024, 999.4 * 1024, 1000.3 * 1024, 120 * 1024 ** 2, 1024 ** 3, 999 * 1024 ** 3, null]) {
                render(value, value); await delay(60);
                assert(this._island.actor.width === width && pill._network.width === networkWidth,
                    `Bandwidth refresh resized the notch for ${value}`);
                fits(); compact();
            }
            await this._capture('notch-stable-idle-rates');
            render(8888.8 * 1024 ** 3, 8888.8 * 1024 ** 3); await delay(100);
            assert(pill._network.width === networkWidth, 'Saturated GiB rates resized their slots'); fits(); compact();
            render(7.2 * 1024, 2.5 * 1024); await delay(100);
            assert(pill._network.width === networkWidth, 'Earlier traffic left oversized rate slots'); compact();
            await this._capture('notch-compact-rates');
            render(0, 0, 'new-network'); await delay(100); compact();
            text.set_double('text-scaling-factor', 1.5); await delay(250); fits(); compact();
            await this._capture('notch-stable-large-text');
            context.scale_factor = 2; await delay(250); fits(); compact();
            context.scale_factor = originalScale;
            text.set_double('text-scaling-factor', originalText); await delay(250); fits(); compact();
            this._settings.set_boolean('pill-show-network', false);
            this._settings.set_boolean('pill-show-network', true);
            await delay(100); compact();
            console.log('[Island Preview] NETWORK PASS: fixed compact-rate slots plus 4px, no traffic resizing, GiB saturation, interface/toggle stability, font and 200% scale changes');
        } finally {
            context.scale_factor = originalScale;
            text.set_double('text-scaling-factor', originalText);
            this._settings.set_boolean('disable-animations', animations);
            this._settings.set_boolean('pill-show-network', true);
            this._renderSystem(state);
        }
    }

    async _checkCommute() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,() => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition,message) => { if (!condition) throw new Error(message); };
        this._card.selectPage('commute'); this._island.expand(); await delay(500);
        const view = this._card._commuteView, ready = this._states.commute;
        assert(ready.data, 'Sample route missing');
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const context = St.ThemeContext.get_for_stage(global.stage), scale = context.scale_factor;
        const text = new Gio.Settings({schema_id:'org.gnome.desktop.interface'}), font = text.get_double('text-scaling-factor');
        const width = this._settings.get_int('expanded-width');
        try {
            for (const [provider,name] of [['balad','Balad'],['mapbox','Mapbox'],['neshan','Neshan'],['ors','openrouteservice'],['graphhopper','GraphHopper'],['fossgis','FOSSGIS'],['osrm','OSRM']]) {
                view.render({...ready,preferred:'balad',data:{...ready.data,provider,fallback:provider!=='balad',trafficUnverified:provider==='balad'}});
                assert(view.credit.text.includes(name) && view.credit.text.includes('OpenStreetMap') && view.creditLink.visible &&
                    view.providerPanel.contains(view.creditLink) && !view.creditLink.mapped,
                    'Credit does not follow the actual provider');
            }
            view.render({...ready,data:null}); assert(!view.creditLink.visible, 'No estimate has a fabricated credit');
            view.render(ready); await delay(100);
            assert(!view.status.visible && !view.metadataDivider.visible && view.statusInfo.can_focus, 'Unverified traffic is not icon-only');
            const [x,y] = view.statusInfo.get_transformed_position(), [w,h] = view.statusInfo.get_transformed_size();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),x+w/2,y+h/2); await delay(100);
            assert(view.statusTip.tip.visible && view.statusTip.tip.text === 'Live traffic freshness not confirmed', 'Traffic hover explanation missing');
            await this._capture('commute-traffic-tooltip');
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),50,500); await delay(80);
            assert(!view.statusTip.tip.visible, 'Traffic tooltip survived pointer leave');
            view.statusInfo.grab_key_focus(); await delay(80);
            assert(view.statusTip.tip.visible, 'Traffic tooltip is inaccessible from the keyboard');
            view.render({...ready,status:'loading'});
            assert(view.status.visible && !view.statusTip.tip.visible, 'Traffic tooltip hid the loading state');
            view.render({...ready,status:'error',stale:true,error:'Routing unavailable'});
            assert(view.status.visible && view.status.text.includes('Routing unavailable'), 'Traffic tooltip hid the error');
            this._island.actor.grab_key_focus(); view.render(ready);
            for (const uiScale of [1,2]) for (const typeScale of [1,2]) for (const cardWidth of [380,440]) {
                context.scale_factor=uiScale; text.set_double('text-scaling-factor',typeScale);
                this._settings.set_int('expanded-width',cardWidth); await delay(150);
                const scroll = this._card._scroll, [left] = scroll.get_transformed_position(), [available] = scroll.get_transformed_size();
                if (typeScale === 1) {
                    const adjustment = scroll.get_vscroll_bar().get_adjustment();
                    assert(adjustment.upper-adjustment.lower <= adjustment.page_size+1, 'Default Commute requires scrolling');
                }
                assert(!view.creditLink.mapped, 'Attribution remains on the route face');
                view.statusInfo.grab_key_focus(); await delay(100);
                const tip = view.statusTip.tip, [tx,ty] = tip.get_transformed_position(), [tw,th] = tip.get_transformed_size();
                const monitor = Main.layoutManager.primaryMonitor;
                assert(tip.visible && tx >= monitor.x && ty >= monitor.y && tx+tw <= monitor.x+monitor.width && ty+th <= monitor.y+monitor.height,
                    'Traffic popup exceeds the monitor');
                this._island.actor.grab_key_focus();
            }
            view.statusInfo.grab_key_focus(); this._card.selectPage('media'); await delay(100);
            assert(!view.statusTip.tip.visible, 'Hidden Commute retains tooltip');
            console.log('[Island Preview] COMMUTE PASS: actual provider credits, hover/focus explanation, error/loading states, narrow/scaled text and hidden cleanup');
        } finally {
            context.scale_factor=scale; text.set_double('text-scaling-factor',font); this._settings.set_int('expanded-width',width);
            view.render(ready);
        }
    }

    async _checkNotifications() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const key = async symbol => {
            keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
            await delay(200);
        };
        const card = this._card, pill = this._pill, settings = this._settings;
        const view = card._notificationsView;
        const cards = () => view._cards();
        const find = title => cards().find(entry => entry._title.text === title);
        const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const open = async () => { card.selectPage('notifications'); this._island.expand(); await delay(400); };
        assert(view && card._tabs.get('notifications')?.visible, 'Notifications tab unavailable');
        settings.set_string('notifications-layout', 'compact');
        await open();

        assert(cards().length === 5, `Expected 5 compact rows, found ${cards().length}`);
        assert(find('Sara')._body.text === 'Are we still on for lunch & the design review?', 'Markup not stripped');
        assert(view._newChip.visible && view._newChip.text === '5 new', `Unexpected new count: ${view._newChip.text}`);
        assert(cards().every(entry => entry._dot.visible), 'Unseen rows lack the new marker');
        const headings = view._list.get_children().filter(entry => !entry._openButton).map(entry => entry.text);
        assert(headings.includes('Earlier'), `Missing Earlier heading: ${headings}`);
        assert(cards().at(-1)._title.text === 'Weekly sync starts in 10 minutes', 'Older notification not under Earlier');
        const files = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
        if (files) assert(find('Copy finished')._icon.gicon?.equal(files.get_icon()), 'Row does not use the application logo');
        assert(find('Sara')._dismissButton.opacity === 0 && !find('Sara')._actionRow.visible, 'Row controls visible at rest');
        await this._capture('notifications-compact');

        const context = St.ThemeContext.get_for_stage(global.stage);
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const original = {scale: context.scale_factor, text: text.get_double('text-scaling-factor'), width: settings.get_int('expanded-width')};
        try {
            for (const layout of ['compact', 'grouped']) for (const scale of [1, 2]) for (const font of [1, 1.5]) for (const width of [380, 440]) {
                settings.set_string('notifications-layout', layout);
                context.scale_factor = scale; text.set_double('text-scaling-factor', font); settings.set_int('expanded-width', width);
                await delay(250);
                const where = `${layout} ${width}px/${scale}x/${font} text`;
                const [listX] = view._list.get_transformed_position(), [listWidth] = view._list.get_transformed_size();
                for (const entry of cards()) {
                    const [x] = entry.get_transformed_position(), [w] = entry.get_transformed_size();
                    assert(x >= listX - 1 && x + w <= listX + listWidth + 1, `Row overflows at ${where}`);
                    assert(entry._title.get_transformed_size()[0] > 20 * scale, `Title squeezed at ${where}`);
                }
                const [headerX] = view._header.get_transformed_position(), [headerWidth] = view._header.get_transformed_size();
                let end = headerX;
                for (const actor of view._header.get_children().filter(child => child.visible && child.width > 0)) {
                    const [x] = actor.get_transformed_position(), [w] = actor.get_transformed_size();
                    assert(x >= end - 1 && x + w <= headerX + headerWidth + 1, `Toolbar overlaps at ${where}`);
                    end = x + w;
                }
                const adjustment = card._scroll.get_vscroll_bar().get_adjustment();
                const last = cards().at(-1);
                const bottom = last.get_transformed_position()[1] + last.get_transformed_size()[1];
                const scrollBottom = card._scroll.get_transformed_position()[1] + card._scroll.get_transformed_size()[1];
                assert(bottom <= scrollBottom + 1 || adjustment.upper > adjustment.page_size, `Overflow unreachable at ${where}`);
                // Corner actions stay inside the card, and the last row can scroll clear of them.
                const bar = view._actionsBar, island = this._island.actor;
                const [barX, barY] = bar.get_transformed_position(), [barW, barH] = bar.get_transformed_size();
                const [islandX, islandY] = island.get_transformed_position();
                assert(bar.mapped && barX >= islandX && barX + barW <= islandX + island.width && barY + barH <= islandY + island.height,
                    `Corner actions leave the card at ${where}`);
                assert(barW < island.width / 2 + barW / 2 || font > 1, `Corner actions span the card at ${where}`);
                adjustment.value = adjustment.upper - adjustment.page_size; await delay(80);
                const lastBottom = last.get_transformed_position()[1] + last.get_transformed_size()[1];
                assert(lastBottom <= bar.get_transformed_position()[1] + 1, `Last row cannot scroll clear of the actions at ${where}`);
                await this._capture(`notifications-${layout}-${width}-${scale}x-${font}-end`);
                adjustment.value = 0; await delay(40);
                await this._capture(`notifications-${layout}-${width}-${scale}x-${font}`);
            }
        } finally {
            context.scale_factor = original.scale; text.set_double('text-scaling-factor', original.text);
            settings.set_int('expanded-width', original.width);
            settings.set_string('notifications-layout', 'compact');
            await delay(250);
        }

        find('Sara')._openButton.grab_key_focus(); await delay(50);
        const sara = find('Sara');
        assert(sara._actionRow.visible && sara._actionRow.get_n_children() === 2, 'Actions hidden on focus');
        assert(sara._dismissButton.opacity === 255 && sara._age.opacity === 0, 'Dismiss did not replace the age on focus');
        await this._capture('notifications-focused');
        find('Omid')._openButton.grab_key_focus(); await delay(50);
        await key(Clutter.KEY_Delete); await delay(100);
        assert(!find('Omid') && cards().length === 4, 'Delete did not dismiss the focused row');
        assert(cards().some(entry => entry._openButton.has_key_focus()), 'Delete lost keyboard focus');
        sara._actionRow.get_child_at_index(1).emit('clicked', 1); await delay(400);
        assert(!this._island.expanded && this._states.notifications.count === 3, 'Action did not run and collapse');

        postNotification({app: 'Messages (sample)', icon: 'mail-unread-symbolic', minutes: 1, title: 'Lena', body: 'On my way'});
        postNotification({app: 'Messages (sample)', icon: 'mail-unread-symbolic', minutes: 3, title: 'Ali', body: 'Call me'});
        await delay(150);
        settings.set_string('notifications-layout', 'grouped');
        await open();
        const group = view._entries.get('g:Messages (sample)');
        assert(group && group._count.text === '2' && group._shelf.visible, 'Same-app notifications were not grouped');
        assert(group._body.text === 'Lena · Ali', `Unexpected group preview: ${group._body.text}`);
        group._openButton.emit('clicked', 1); await delay(150);
        const children = cards().filter(entry => entry.has_style_class_name('ubuntu-island-notification-child'));
        assert(children.length === 2 && !group._shelf.visible, 'Group did not expand');
        await this._capture('notifications-grouped-expanded');
        view._filterButtons.get('today').emit('clicked', 1); await delay(150);
        assert(!find('Weekly sync starts in 10 minutes'), 'Today filter kept an older notification');
        view._filterButtons.get('all').emit('clicked', 1); await delay(150);
        group._dismissButton.reactive = true; group._dismissButton.emit('clicked', 1); await delay(150);
        assert(!view._entries.has('g:Messages (sample)') && !find('Lena'), 'Dismissing a group left its notifications');
        view._layoutButton.emit('clicked', 1); await delay(150);
        assert(settings.get_string('notifications-layout') === 'compact', 'Layout button did not switch back');

        this._island.collapse(); await delay(400);
        assert(!pill._notifications.visible, 'Seen notifications still counted in the notch');
        postNotification({app: 'Chat (sample)', icon: 'user-available-symbolic', quiet: false,
            title: 'A deliberately long notification title that must not widen the collapsed notch'});
        await delay(250);
        assert(pill.peeking && pill._peek.visible && pill._content.opacity === 0, 'New notification did not peek');
        const width = this._island.actor.width;
        assert(pill.actor.accessible_name.includes('Notification from Chat (sample)'), 'Peek missing from the accessible name');
        await this._capture('notification-peek');
        pill.endPeek(false); await delay(250);
        assert(Math.abs(this._island.actor.width - width) <= 1, 'Peek changed the notch width');
        assert(pill._notifications.visible && pill._notificationsText.text === '1', 'Unseen count missing from the notch');
        await this._capture('notification-unseen');
        pill.peek({app: 'Chat (sample)', title: 'Again'}, 4000, false);
        pill.actor.emit('clicked', 1); await delay(400);
        assert(this._island.expanded && card._page === 'notifications' && !pill.peeking, 'Opening during a peek did not show Notifications');
        assert(cards().filter(entry => entry._dot.visible).length === 1, 'Only the newest notification should be new');

        postNotification({app: 'Chat (sample)', icon: 'user-available-symbolic', quiet: false, title: 'While open'});
        await delay(100);
        assert(!pill.peeking, 'Peeked while expanded');
        settings.set_boolean('notifications-peek', false);
        this._island.collapse(); await delay(400);
        postNotification({app: 'Chat (sample)', icon: 'user-available-symbolic', quiet: false, title: 'Peek disabled'});
        await delay(100);
        assert(!pill.peeking, 'Peeked with the preference off');
        settings.set_boolean('notifications-peek', true);
        postNotification({app: 'Mail (sample)', icon: 'mail-unread-symbolic', title: 'Quiet app'});
        await delay(100);
        assert(!pill.peeking, 'Peeked for an app with banners off');

        await open();
        view._dndButton.emit('clicked', 1); await delay(150);
        assert(!desktop.get_boolean('show-banners') && view._dndButton.checked, 'Do Not Disturb did not turn on');
        assert(card._tabGlyphs.get('notifications').icon_name === 'notifications-disabled-symbolic', 'Tab icon ignores Do Not Disturb');
        this._island.collapse(); await delay(400);
        postNotification({app: 'Chat (sample)', icon: 'user-available-symbolic', quiet: false, title: 'During DND'});
        await delay(200);
        assert(!pill.peeking && this._states.notifications.silenced === 1, 'Do Not Disturb did not silence the peek');
        postNotification({app: 'Battery (sample)', icon: 'battery-caution-symbolic', title: 'Battery critically low', urgency: 3});
        await delay(250);
        assert(pill.peeking && this._states.notifications.silenced === 1, 'Critical notification did not bypass Do Not Disturb');
        pill.endPeek(false);

        await open();
        assert(view._silencedLabel.visible && view._silencedLabel.text === '1 silenced', 'Silenced count missing');
        const critical = find('Battery critically low');
        assert(cards()[0] === critical && critical._card.has_style_class_name('ubuntu-island-notification-critical'), 'Critical notification not pinned');
        view._clear.emit('clicked', 1); await delay(150);
        assert(cards().length === 0 && view._empty.visible && !view._header.visible, 'Clear all left rows');
        assert(view._emptyDnd.visible && view._emptySwitch.state && view._emptySilenced.visible, 'Empty state lacks Do Not Disturb details');
        assert(Main.messageTray.getSources().every(source => !source.notifications.length), 'Clear all left Shell notifications');
        await this._capture('notifications-empty-dnd');
        view._emptyDnd.emit('clicked', 1); await delay(150);
        assert(desktop.get_boolean('show-banners') && !view._emptySilenced.visible && this._states.notifications.silenced === 0,
            'Turning Do Not Disturb off did not reset the silenced count');
        assert(card._tabGlyphs.get('notifications').icon_name === 'preferences-system-notifications-symbolic', 'Tab icon kept Do Not Disturb');
        await this._capture('notifications-empty');

        this._notifications.stop();
        const before = this._states.notifications;
        postNotification({app: 'Chat (sample)', icon: 'user-available-symbolic', quiet: false, title: 'After stop'});
        await delay(150);
        assert(this._states.notifications === before && !pill.peeking, 'Stopped service still received notifications');
        this._notifications.start(); await delay(100);
        assert(this._states.notifications.count === 1, 'Restarted service did not reload existing notifications');
        console.log('[Island Preview] NOTIFICATIONS PASS: compact and grouped layouts, logos, actions, keys, sections, filters, peek, unseen, DND, clear and stop');
    }

    async _checkCalendar() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const click = async actor => {
            const [x, y] = actor.get_transformed_position(), [w, h] = actor.get_transformed_size();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + w / 2, y + h / 2);
            await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            await delay(40);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(180);
        };
        const key = async symbol => {
            keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
            await delay(180);
        };
        await this._checkNotchDate();
        const card = this._card, navigation = card._navigation, soundRows = card._outputRows;
        for (let i = 0; i < 3; i++) {
            card.selectPage('calendar'); this._island.expand(); await delay(400);
            const previous = card._calendarView;
            previous.todayButton.grab_key_focus();
            assert(previous.todayButton.has_key_focus(), 'Calendar focus setup failed');
            this._settings.set_boolean('enable-calendar', false); await delay(150);
            assert(!card._calendarView && !card._pages.has('calendar') && !card._tabs.get('calendar').visible,
                'Disabled Calendar retained its view or navigation tab');
            assert(!previous.midnightTimer && !previous.layoutIdle, 'Disabled Calendar retained callbacks');
            assert(previous.dayTip.destroyed, 'Disabled Calendar retained its date popup');
            assert(card._page !== 'calendar' && !card.actor.has_style_class_name('ubuntu-island-with-calendar'),
                'Disabling Calendar did not restore the available page/layout');
            assert(card._tabs.get(card._page).has_key_focus(), 'Removing the focused calendar lost keyboard focus');
            const page = card._page;
            this._settings.set_boolean('enable-calendar', true); await delay(150);
            assert(card._calendarView && card._tabs.get('calendar').visible && card._page === page,
                'Calendar must appear immediately without changing the current tab');
            assert(card._navigation === navigation && card._outputRows === soundRows, 'Calendar toggle rebuilt unrelated controls');
        }
        this._card.selectPage('calendar'); this._island.expand(); await delay(600);
        const view = this._card._calendarView;
        view.select(todayDay()); await delay(200);
        // Simulate the cached Shell profile in this private session only.
        const quickSettings = Main.panel.statusArea.quickSettings;
        const profiles = quickSettings._powerProfiles;
        const disabled = this._settings.get_boolean('disable-animations');
        const desktopSettings = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        const desktopMotion = desktopSettings.get_boolean('enable-animations');
        try {
            this._settings.set_boolean('disable-animations', false);
            desktopSettings.set_boolean('enable-animations', true);
            await delay(50);
            quickSettings._powerProfiles = {quickSettingsItems: [{_proxy: {ActiveProfile: 'balanced'}}]};
            view.todayButton.grab_key_focus(); view.select(todayDay(),true);
            assert(view.dayTip.tip.get_transition('opacity'), 'Normal date popup did not animate');
            await delay(200);
            assert(view.dayTip.tip.opacity === 255 && !view.dayTip.tip.get_transition('opacity'), 'Date popup fade did not settle');
            for (const mode of ['power-saver', 'extension', 'desktop']) {
                view.todayButton.grab_key_focus();
                quickSettings._powerProfiles.quickSettingsItems[0]._proxy.ActiveProfile = mode;
                this._settings.set_boolean('disable-animations', mode === 'extension');
                desktopSettings.set_boolean('enable-animations', mode !== 'desktop');
                await delay(50);
                view.select(todayDay(),true);
                assert(view.dayTip.tip.visible && view.dayTip.tip.opacity === 255 && !view.dayTip.tip.get_transition('opacity'),
                    `${mode} popup should open instantly`);
            }
        } finally {
            view.todayButton.grab_key_focus();
            quickSettings._powerProfiles = profiles;
            this._settings.set_boolean('disable-animations', disabled);
            desktopSettings.set_boolean('enable-animations', desktopMotion);
        }
        for (const primary of ['jalali','gregorian','hijri']) for (const native of [true,false]) {
            this._settings.set_string('calendar-primary',primary);
            this._settings.set_boolean('calendar-use-calendar-language',native);
            view.todayButton.grab_key_focus(); await delay(100);
            const cell = view.cells.find(item => item.day != null && item.day !== view.selected);
            const [x,y] = cell.control.get_transformed_position(), [w,h] = cell.control.get_transformed_size();
            const selected = view.selected;
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),x+w/2,y+h/2); await delay(100);
            const tip = view.dayTip.tip;
            assert(!tip.visible && view.dayTip.timer, 'Day hover opened without its pause');
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),50,500); await delay(80);
            assert(!tip.visible && !view.dayTip.timer, 'Leaving retained a pending popup');
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),x+w/2,y+h/2); await delay(550);
            assert(!/Hijri:|Gregorian:|Jalali:|calculated|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(tip.text), 'Day popup has unnecessary labels');
            assert(tip.visible && tip.text.split('\n').length === 2 && !tip.text.includes(`${primary[0].toUpperCase()+primary.slice(1)}:`),
                'Day hover did not show the other two calendars');
            assert(tip.clutter_text.line_alignment === Pango.Alignment.CENTER && tip.clutter_text.get_layout().get_line_count() === 2,
                'First hover did not show two centered dates');
            const firstSize = tip.get_transformed_size();
            view.dayTip.refresh(); await delay(40);
            assert(tip.get_transformed_size().every((value,index) => Math.abs(value-firstSize[index]) < 1),
                'First hover size changed after applying its style');
            assert(view.selected === selected, 'Day hover changed the selection');
            if (!native) assert(!/[\u0600-\u06ff]/.test(tip.text), 'Day hover ignored English dates');
            if (primary === 'jalali' && native) await this._capture('calendar-day-hover');
            assert(tip.x === Math.round(tip.x) && tip.y === Math.round(tip.y), 'Date popup has a fractional text origin');
            await click(cell.control); await delay(500);
            assert(view.selected === cell.day && !tip.visible && !view.dayTip.timer,
                'Clicking a date opened its popup');
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),50,500); await delay(80);
            assert(!tip.visible, 'Date popup survived pointer leave');
            view.todayButton.grab_key_focus();
            view.select(cell.day,true); await delay(100);
            assert(tip.visible && cell.control.accessible_description === tip.text, 'Focused date lacks the alternate dates');
            this._card.selectPage('media'); await delay(80);
            assert(!tip.visible, 'Hidden Calendar retained the date popup');
            this._card.selectPage('calendar'); view.todayButton.grab_key_focus(); view.select(todayDay());
        }
        this._settings.set_string('calendar-primary','jalali');
        this._settings.set_boolean('calendar-use-calendar-language',true);
        view.select(todayDay()); await delay(100);
        assert(!view.content.contains(view.agenda.actor) && view.actor.contains(view.agenda.actor), 'Events must have their own panel');
        assert(view.agenda.actor.visible && view.agenda.rows.size === 3, 'Inline selected-day events missing');
        assert(view.cells.find(cell => cell.day === todayDay()).indicator.opacity === 255, 'Event marker missing');
        const eventRow = [...view.agenda.rows.values()].find(row => row.event.uid === 'review');
        assert(eventRow.color === '#78aed4', 'Provider calendar color missing');
        const originalColor = this._sampleCalendarColor;
        this._sampleCalendarColor = '#e79a62'; this._calendarEvents.publish(); await delay(80);
        assert(view.agenda.rows.get(eventRow.event.id) === eventRow && eventRow.color === '#e79a62', 'Color update rebuilt or missed the event row');
        this._sampleCalendarColor = originalColor; this._calendarEvents.publish();
        assert(view.agenda.header.contains(view.todayButton) && !view.header.contains(view.todayButton), 'Today remains in the month navigation');
        const stripeX = eventRow.accent.get_transformed_position()[0];
        for (const item of view.agenda.rows.values())
            assert(Math.abs(item.accent.get_transformed_position()[0] - stripeX) <= 1 && stripeX < item.title.get_transformed_position()[0],
                'Event stripes do not share the left edge');
        eventRow.control.grab_key_focus(); await delay(150);
        assert(view.header.mapped && view.grid.mapped && navigation.mapped, 'Events replaced the month/navigation');
        assert(view.agenda.scroll.contains(eventRow.control), 'Event focus left the independent scroll area');
        const eventCell = view.cells.find(cell => cell.day === todayDay());
        assert(eventCell.indicator.get_transformed_position()[1] >= eventCell.main.get_transformed_position()[1] + eventCell.main.height,
            'Event indicator overlaps the day number');
        assert(view.month.get_theme_node().get_border_width(St.Side.LEFT) > 0, 'Panel divider missing');
        const compactHeight = eventRow.control.height;
        assert([...view.agenda.rows.values()].every(item => Math.abs(item.control.height - compactHeight) <= 1),
            'Event cards have different heights');
        const longEvent = [...view.agenda.rows.values()].find(item => item.event.uid === 'later');
        assert(longEvent.title.clutter_text.get_layout().is_ellipsized(), 'Long sample title does not demonstrate truncation');
        const defaultTitleWidth = longEvent.title.clutter_text.get_preferred_width(-1)[1];
        this._settings.set_int('calendar-event-title-size', 14); await delay(100);
        assert(view.agenda.rows.get(longEvent.event.id) === longEvent && longEvent.title.clutter_text.get_preferred_width(-1)[1] > defaultTitleWidth,
            'Event font setting did not resize existing titles');
        this._settings.reset('calendar-event-title-size'); await delay(100);
        assert(Math.abs(longEvent.control.height - compactHeight) <= 1, 'Restoring title size changed the default card height');
        await this._capture('calendar-inline-events');
        const sampleRecords = this._sampleCalendarRecords;
        this._sampleCalendarRecords = sampleRecords.filter(event => event.uid !== 'review'); this._calendarEvents.publish(); await delay(50);
        assert(view.agenda.rows.size === 2 && view.todayButton.has_key_focus(), 'Removed focused event did not restore focus');
        this._sampleCalendarRecords = sampleRecords; this._calendarEvents.publish();
        this._settings.set_strv('calendar-event-sources',[]); await delay(100);
        assert(view.agenda.actor.visible && view.agenda.message.text === 'No events' && !view.agenda.rows.size, 'Unconfigured day panel must retain its date and empty state');
        this._settings.set_strv('calendar-event-sources',['sample-calendar']);
        this._island.collapse(); await delay(350);
        assert(this._pill._event.visible && this._eventIndicator?.label === 'Event now' && !this._pill._eventText.visible &&
            this._pill._event.accessible_name === 'Event now', 'Ongoing event must show only its icon, with an accessible label');
        await click(this._pill._event); await delay(350);
        assert(this._island.expanded && view.agenda.actor.visible && view.header.mapped && view.agenda.actor.contains(global.stage.get_key_focus()),
            'Event click did not reveal inline events');
        await key(Clutter.KEY_Escape); await delay(250);
        assert(!this._island.expanded, 'Inline calendar Escape did not close the island');
        this._island.expand(); await delay(250);
        this._card.selectPage('media');
        assert(!this._calendarClock && !this._calendarDeadline && this._calendarEvents.suspended, 'Hidden calendar retains timers or an active reader');
        assert(view.agenda.rows.size > 0, 'Hidden calendar discarded its last events');
        this._card.selectPage('calendar'); await delay(150);
        const gridY = view.grid.get_transformed_position()[1], gridScroll = view.adjustment.value;
        const many = Array.from({length:12}, (_, index) => ({...sampleRecords.find(event => event.uid === 'review'),
            uid:`overflow-${index}`, title:`Planning ${index} · A long event title that must stay on one line برنامه‌ریزی`,
            startMs:sampleRecords[1].startMs + index * 60000, endMs:sampleRecords[1].endMs + index * 60000}));
        this._sampleCalendarRecords = [...sampleRecords, ...many]; this._calendarEvents.publish(); await delay(150);
        const finalRow = view.agenda.list.get_last_child(); finalRow.grab_key_focus(); await delay(150);
        assert(view.agenda.adjustment.value > 0 && view.adjustment.value === gridScroll && view.grid.get_transformed_position()[1] === gridY,
            'Scrolling events moved the month');
        assert(finalRow.get_transformed_position()[1] + finalRow.height <= view.agenda.scroll.get_transformed_position()[1] + view.agenda.scroll.height + 1,
            'Last event is unreachable');
        for (const item of view.agenda.rows.values()) {
            assert(item.control.width <= view.agenda.scroll.width, 'Long event title widened the panel');
            assert(item.title.clutter_text.get_layout().get_line_count() === 1, 'Event title wrapped onto another line');
            assert(Math.abs(item.control.height - compactHeight) <= 1,
                `A long title changed the card height: ${item.control.height}/${compactHeight}`);
        }
        await this._capture('calendar-long-events');
        const lastItem = [...view.agenda.rows.values()].find(item => item.control === finalRow);
        assert(lastItem.title.clutter_text.get_layout().is_ellipsized() && view.agenda.titleTip.tip.visible &&
            view.agenda.titleTip.tip.text === lastItem.title.text, 'Truncated event lacks its full title popup');
        assert(Math.abs(view.agenda.titleTip.tip.y - (finalRow.get_transformed_position()[1] + finalRow.height + 6)) <= 1,
            'Event popup did not follow its scrolled row');
        await this._capture('calendar-event-title');
        view.todayButton.grab_key_focus();
        const [ex,ey] = finalRow.get_transformed_position(), [ew,eh] = finalRow.get_transformed_size();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), ex+ew/2, ey+eh/2); await delay(700);
        assert(view.agenda.titleTip.tip.visible && view.agenda.titleTip.tip.text === lastItem.title.text,
            'Hovering a truncated event did not reveal its full title');
        pointer.notify_absolute_motion(GLib.get_monotonic_time(),50,500); await delay(80);
        assert(!view.agenda.titleTip.tip.visible, 'Event title popup survived pointer leave');
        this._sampleCalendarRecords = sampleRecords; this._calendarEvents.publish();
        await click(view.cells.find(cell => cell.day === todayDay() + 1).control);
        assert(view.agenda.rows.size === 1 && [...view.agenda.rows.values()][0].event.uid === 'tomorrow', 'Day selection did not filter events');
        assert(Math.abs([...view.agenda.rows.values()][0].control.height - compactHeight) <= 1, 'One event stretched to fill its panel');
        await this._capture('calendar-single-event');
        await click(view.cells.find(cell => cell.day === todayDay() + 2).control);
        assert(!view.agenda.rows.size && view.agenda.message.text === 'No events', 'Empty selected day is not clear');
        await click(view.todayButton);
        const originalTheme = this._settings.get_string('color-theme');
        this._sampleCalendarColor = null; this._calendarEvents.publish();
        view.select(todayDay(), true);
        for (const theme of THEME_IDS) {
            this._settings.set_string('color-theme', theme); await delay(150);
            assert([...view.agenda.rows.values()].every(item => item.color === themeAccent(theme)), 'Missing source color did not follow the live theme');
            for (const popup of [view.dayTip, view.agenda.titleTip]) {
                popup.tip.ensure_style();
                const [, top, bottom] = popup.tip.get_theme_node().get_background_gradient();
                const matches = (color, rgb) => color.red === rgb[0] && color.green === rgb[1] && color.blue === rgb[2];
                assert(matches(top, THEMES[theme].top) && matches(bottom, THEMES[theme].bottom),
                    `Calendar popup did not follow ${theme}`);
                assert(popup.tip.get_theme_node().get_foreground_color().alpha === 255, 'Themed popup text is translucent');
            }
            assert(view.dayTip.tip.visible, 'Live theme change dismissed the date popup');
            await this._capture(`calendar-theme-${theme}`);
            if (theme === 'ocean') {
                const event = [...view.agenda.rows.values()].find(item => item.title.clutter_text.get_layout().is_ellipsized());
                event.control.grab_key_focus(); await delay(200);
                assert(view.agenda.titleTip.tip.visible, 'Themed full-title popup is missing');
                await this._capture('calendar-event-theme-ocean');
                view.select(todayDay(), true);
            }
        }
        this._settings.set_string('color-theme', originalTheme);
        this._sampleCalendarColor = originalColor; this._calendarEvents.publish();
        const eventContext = St.ThemeContext.get_for_stage(global.stage);
        const eventText = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        const eventSize = {scale:eventContext.scale_factor, text:eventText.get_double('text-scaling-factor'),
            width:this._settings.get_int('expanded-width')};
        for (const titleSize of [8,9,14]) for (const scale of [1,2]) for (const font of [1,2]) for (const width of [380,440]) {
            this._settings.set_int('calendar-event-title-size',titleSize);
            eventContext.scale_factor = scale; eventText.set_double('text-scaling-factor',font);
            this._settings.set_int('expanded-width',width); view.select(todayDay()); await delay(100);
            if (titleSize === 9) {
                view.select(todayDay(),true); await delay(80);
                const tip = view.dayTip.tip, [tx,ty] = tip.get_transformed_position(), [tw,th] = tip.get_transformed_size();
                const monitor = Main.layoutManager.primaryMonitor;
                assert(tip.clutter_text.line_alignment === Pango.Alignment.CENTER && tip.clutter_text.get_layout().get_line_count() === 2,
                    'Alternate dates must remain two centered lines at enlarged text sizes');
                assert(tip.visible && tx >= monitor.x && ty >= monitor.y && tx+tw <= monitor.x+monitor.width && ty+th <= monitor.y+monitor.height,
                    'Scaled alternate-date popup exceeds the monitor');
                if (scale === 2 && font === 2 && width === 380) await this._capture('calendar-day-hover-scaled');
                view.todayButton.grab_key_focus();
            }
            const rows = [...view.agenda.rows.values()], height = rows[0].control.height;
            for (const item of rows) {
                assert(Math.abs(item.control.height - height) <= 1, 'Scaled event cards differ in height');
                assert(item.title.clutter_text.get_layout().get_line_count() === 1 && item.time.clutter_text.get_layout().get_line_count() === 1,
                    'Scaled event text wrapped');
                assert(item.title.height + 1 >= item.title.clutter_text.get_preferred_height(item.title.width)[1], 'Scaled event text clipped vertically');
                assert(item.control.accessible_name.includes(item.event.title), 'Truncation lost the accessible full title');
            }
            view.select(todayDay()+1); await delay(100);
            assert(Math.abs([...view.agenda.rows.values()][0].control.height - height) <= 1, 'Scaled single event fills its panel');
        }
        this._settings.reset('calendar-event-title-size');
        eventContext.scale_factor = eventSize.scale; eventText.set_double('text-scaling-factor',eventSize.text);
        this._settings.set_int('expanded-width',eventSize.width); view.select(todayDay()); await delay(100);
        // Grid sizing remains independent of whether event data is configured.
        this._settings.set_boolean('calendar-events-enabled',false);
        const sample = civilDay(2025, 3, 20);
        view.select(sample);
        assert(!view.modes && !view.modeButtons, 'Calendar choices must stay in preferences');
        assert(!view.copyButton && !view.footer, 'Calendar still has a bottom action row');
        for (const primary of ['jalali', 'gregorian', 'hijri']) {
            this._settings.set_string('calendar-primary', primary); await delay(180);
            assert(view.primary === primary && view.selected === sample, 'Preference switch lost selected date');
            assert(view.todayButton.label === calendarTodayLabel(primary), 'Today language did not follow the main calendar');
            assert(view.title.text === monthTitle(sample, primaryCalendar(primary)), 'Month heading does not match the displayed month');
            assert(view.agenda.heading.text === fullDate(sample, primaryCalendar(primary), 'long'), 'Selected date does not use the main calendar');
            assert(view.cells.filter(cell => cell.control.visible && cell.main.text).length === view.gridData.filter(day => day.inMonth).length, 'Other-month dates still visible');
            for (const cell of view.cells.filter(cell => cell.day === null))
                assert(!cell.control.reactive && !cell.control.can_focus, 'Blank date cell is interactive');
            await this._capture(`calendar-${primary}`);
        }
        this._settings.set_string('calendar-primary', 'jalali');
        this._settings.set_strv('calendar-additional', ['jalali', 'gregorian', 'hijri']);
        await delay(150); await this._capture('calendar-all-dates');
        assert(view.agenda.heading.text === fullDate(sample, primaryCalendar('jalali'), 'long'), 'Additional calendar changed the day heading');
        this._settings.set_string('calendar-primary', 'gregorian'); await delay(150);
        await click(view.cells.find(c => c.day === sample).control);
        await key(Clutter.KEY_Left); assert(view.selected === sample - 1, 'Gregorian arrow did not move left');
        await key(Clutter.KEY_Right); assert(view.selected === sample, 'Gregorian arrow did not return');
        this._settings.set_string('calendar-primary', 'jalali');
        this._settings.set_strv('calendar-additional', ['gregorian']); await delay(150);
        await click(view.next); assert(view.displayed !== sample && view.selected === sample, 'Month browsing changed the selected civil date');
        assert(!view.cells.some(cell => cell.control.visible && cell.control.has_style_pseudo_class('checked')), 'Browsing selected the same date number in another month');
        await click(view.previous); assert(view.displayed === sample && view.selected === sample, 'Previous month did not return');
        await click(view.cells.find(c => c.day === sample).control);
        await key(Clutter.KEY_Left); assert(view.selected === sample + 1, 'RTL arrow did not cross Nowruz');
        await key(Clutter.KEY_Right); assert(view.selected === sample, 'RTL arrow did not return');
        assert(view.agenda.heading.text === fullDate(sample, primaryCalendar('jalali'), 'long'), 'Keyboard selection did not update the day heading');
        // Iranian published dates differ from the tabular Hijri calendar.
        const holidayDay = civilDay(2026, 11, 13);
        view.select(holidayDay - 1); await delay(150);
        await click(view.cells.find(c => c.day === holidayDay).control);
        assert(view.agenda.holiday.visible && view.agenda.holiday.text === 'شهادت حضرت فاطمه', 'Selected Iranian holiday name missing');
        const marked = () => view.cells.filter(cell => cell.control.visible && cell.control.has_style_class_name('ubuntu-island-calendar-holiday')).map(cell => cell.day).join(',');
        const beforeAdditional = marked();
        const holidaySnapshot = {status:'ready',incomplete:false,coverage:[{startDay:holidayDay,endDayExclusive:holidayDay+1}],
            sources:[{uid:'holiday-fixture',holiday:true},{uid:'personal-fixture'}],occurrences:[
                {id:'holiday-fixture',uid:'holiday',sourceUid:'holiday-fixture',title:'Holiday',allDay:true,
                    startDate:'2026-11-13',endDateExclusive:'2026-11-14'},
                {id:'personal-fixture',uid:'personal',sourceUid:'personal-fixture',title:'Personal all-day plan',allDay:true,
                    startDate:'2026-11-13',endDateExclusive:'2026-11-14'}]};
        this._settings.set_boolean('calendar-events-enabled',true);
        view.setEvents(holidaySnapshot);
        assert(view.agenda.rows.size === 2, 'Holiday filtering fixture missing');
        view.agenda.rows.get('holiday-fixture').control.grab_key_focus();
        this._settings.set_boolean('calendar-show-holidays',false); await delay(100);
        assert(!view.agenda.holiday.visible && view.agenda.holiday.text === '' && view.agenda.rows.size === 1 &&
            view.agenda.rows.has('personal-fixture') && view.todayButton.has_key_focus(),
            'Holiday switch must hide the note and holiday rows while preserving personal events and focus');
        assert(marked() === beforeAdditional, 'Holiday text switch changed nonworking-day colors');
        this._settings.set_boolean('calendar-show-holidays',true); await delay(100);
        assert(view.agenda.holiday.visible && view.agenda.rows.size === 2, 'Holiday switch did not restore both displays');
        this._settings.set_boolean('calendar-use-calendar-language',false); await delay(100);
        assert(view.todayButton.label === 'Today' && !/[\u0600-\u06ff]/.test(view.agenda.heading.text + view.title.text + view.agenda.holiday.text),
            'English calendar preference left localized date text');
        assert(view.cells.filter(cell => cell.day !== null).every(cell => /^[0-9]+$/.test(cell.main.text)), 'English calendar retained Persian day numbers');
        await this._capture('calendar-english');
        this._settings.set_boolean('calendar-use-calendar-language',true);
        this._settings.set_boolean('calendar-events-enabled',false);
        this._settings.set_strv('calendar-additional', ['gregorian', 'hijri']);
        assert(marked() === beforeAdditional, 'Additional dates changed holiday markings');
        await delay(150); await this._capture('calendar-iran-holiday');
        this._settings.set_string('calendar-primary', 'gregorian'); await delay(150);
        assert(!view.agenda.holiday.visible && !view.cells.find(cell => cell.day === holidayDay).control.has_style_class_name('ubuntu-island-calendar-holiday'), 'Gregorian inherited Iranian holiday');
        assert(view.cells.find(cell => cell.day === holidayDay + 1).control.has_style_class_name('ubuntu-island-calendar-holiday'), 'Gregorian weekend missing');
        await this._capture('calendar-gregorian-weekends');
        this._settings.set_string('calendar-primary', 'hijri');
        view.select(holidayDay); await delay(150);
        assert(view.agenda.holiday.text.includes('شهادت') && !view.agenda.holiday.text.includes('محاسبه‌ای'),
            'Hijri holiday does not follow the published Iranian date');
        await this._capture('calendar-hijri-holiday');
        this._settings.set_string('calendar-primary', 'jalali');
        this._settings.set_strv('calendar-additional', ['gregorian']);
        await click(view.todayButton); assert(view.selected === todayDay(), 'Today did not reset selection');
        const now = todayDay();
        const redCells = () => view.cells.filter(cell => {
            if (cell.day === null || !cell.control.visible) return false;
            const color = cell.control.child.get_theme_node().get_background_color();
            const rgb = THEMES[this._settings.get_string('color-theme')].strong.match(/[0-9a-f]{2}/gi).map(n => parseInt(n,16));
            return color.red === rgb[0] && color.green === rgb[1] && color.blue === rgb[2];
        });
        assert(redCells().length === 1 && redCells()[0].day === now, 'Today does not own the red fill');
        const controlsY = view.header.get_transformed_position()[1];
        await click(view.next);
        assert(view.selected === now && redCells().length === 0, 'Red Today highlight carried into the next month');
        assert(view.header.get_transformed_position()[1] === controlsY, 'Month controls moved while browsing');
        assert(view.agenda.heading.text === fullDate(now, primaryCalendar(view.primary), 'long'), 'Month browsing changed the selected date heading');
        await this._capture('calendar-next-month');
        await click(view.previous);
        assert(redCells().length === 1 && redCells()[0].day === now, 'Today highlight did not return with its actual month');
        const another = view.cells.find(cell => cell.day !== null && cell.day !== now);
        await click(another.control);
        assert(another.control.has_style_pseudo_class('checked') && redCells().length === 1 && redCells()[0].day === now, 'Selecting another date moved the red Today highlight');
        await click(view.todayButton);
        const context = St.ThemeContext.get_for_stage(global.stage), originalScale = context.scale_factor;
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}), originalText = text.get_double('text-scaling-factor');
        const originalWidth = this._settings.get_int('expanded-width');
        const verifyBounds = () => {
            const nav = this._card._navigation, [left] = this._island.actor.get_transformed_position();
            const right = left + this._island.actor.width;
            for (const actor of [view.previous, view.next, view.todayButton, view.title, view.agenda.heading,
                view.agenda.scroll, view.scroll, ...this._card._tabs.values(), nav.get_last_child()]) {
                const [x] = actor.get_transformed_position();
                assert(x >= left - 1 && x + actor.width <= right + 1, `Control outside card width: ${actor.style_class}`);
            }
            const titleCenter = view.title.get_transformed_position()[0] + view.title.width / 2;
            const arrowsCenter = (view.previous.get_transformed_position()[0] + view.previous.width + view.next.get_transformed_position()[0]) / 2;
            assert(Math.abs(titleCenter - arrowsCenter) <= 1, 'Month title is not centered between the arrows');
            assert(view.title.clutter_text.line_alignment === Pango.Alignment.CENTER, 'Month text is not centered');
            const [dayX] = view.agenda.actor.get_transformed_position();
            const [monthX] = view.month.get_transformed_position();
            assert(dayX + view.agenda.actor.width <= monthX, 'Day and month panels overlap');
            for (const label of [view.title, view.agenda.heading])
                assert(label.height + 1 >= label.clutter_text.get_preferred_height(label.width)[1], 'Date text is clipped');
            for (const scroll of [view.scroll, view.agenda.scroll])
                assert(scroll.get_transformed_position()[1] >= nav.get_transformed_position()[1] + nav.height - 1, 'Panel overlaps navigation');
        };
        this._settings.set_strv('calendar-additional', ['gregorian', 'hijri']);
        for (const scale of [1, 2]) {
            context.scale_factor = scale;
            for (const width of [440, 380]) {
                this._settings.set_int('expanded-width', width); this._island.applyDimensions(); await delay(300);
                verifyBounds();
                await this._capture(`calendar-${width}-scale${scale}`);
                assert(view.adjustment.upper <= view.adjustment.page_size + 1, `Common month scrolls at ${width}/${scale}: ${view.adjustment.upper}/${view.adjustment.page_size}`);
                assert(view.scroll.get_hscroll_bar().get_adjustment().upper <= view.scroll.width + 1, 'Common month needs horizontal scrolling');
                console.log(`[Island Preview] Calendar layout: ${width}px / ${scale * 100}%, height ${this._island.actor.height / scale}px, independent day and month panels`);
            }
        }
        this._settings.set_strv('calendar-additional', ['gregorian', 'hijri']);
        view.select(civilDay(2026, 6, 4)); // Two overlapping holidays and all dates.
        text.set_double('text-scaling-factor', 1.5); this._island.relayout(); await delay(400);
        verifyBounds();
        const heightBudget = this._island._heightBudget;
        this._island._heightBudget = () => 230 * context.scale_factor;
        this._island.relayout(); await delay(200);
        const last = view.cells.filter(cell => cell.day !== null).at(-1).control;
        last.can_focus = true; last.grab_key_focus(); await delay(200);
        assert(last.get_transformed_position()[1] + last.height <= view.scroll.get_transformed_position()[1] + view.scroll.height + 1, 'Last date unreachable with enlarged text');
        verifyBounds();
        await this._capture('calendar-large-text');
        this._island._heightBudget = heightBudget;
        text.set_double('text-scaling-factor', originalText); context.scale_factor = originalScale;
        this._settings.set_int('expanded-width', originalWidth); this._island.applyDimensions(); await delay(300);
        this._settings.set_strv('calendar-additional', []); await delay(200);
        assert(!view.selectedDate, 'Redundant multi-calendar header remains');
        verifyBounds(); await this._capture('calendar-single-date');
        this._settings.set_strv('calendar-additional', ['gregorian']); await delay(200);
        view.select(todayDay()); await delay(200);
        for (let i = 0; i < 3; i++) {
            view.select(todayDay() + 40);
            this._card.selectPage('media'); this._card.selectPage('calendar');
            assert(view.selected === todayDay() + 40, 'Tab switching reset the selected date');
            this._island.collapse(); await delay(300); assert(!view.midnightTimer && !view.dayTip.tip.visible, 'Hidden calendar retains timer or popup');
            this._island.expand(); await delay(300); assert(view.midnightTimer, 'Visible calendar clock missing');
            assert(view.selected === todayDay() && view.displayed === todayDay(), 'Reopening retained the browsed date/month');
            assert(view.agenda.adjustment.value === 0, 'Reopening retained the agenda scroll position');
        }
        this._card.selectPage('media'); assert(!view.midnightTimer, 'Inactive calendar retains timer');
        this._card.selectPage('calendar'); await delay(300); await this._capture('calendar');
        // The shared preferences action should open Calendar directly.
        await click(this._card._navigation.get_last_child());
        let preferences;
        for (let i = 0; i < 40 && !preferences; i++) {
            await delay(100);
            preferences = this._agentWindows.all().find(w => w.get_title() === 'Ubuntu Island' && w.get_compositor_private()?.mapped);
        }
        assert(preferences && this._settings.get_string('preferences-page') === 'calendar', 'Calendar preferences shortcut failed');
        assert(!this._pill._dates.tip.visible, 'Opening a preferences window exposed a hidden date tooltip');
        await delay(500); await this._capture('calendar-preferences');
        preferences.delete(global.get_current_time());
        console.log('[Island Preview] CALENDAR PASS: Today-only red fill, separate month browsing/selection, blank adjacent-month cells, main-calendar holidays, live preferences, Jalali/Gregorian/Hijri, Nowruz, native keys/clicks, 380/440px, 100/200%, enlarged text and hidden cleanup');
    }

    async _checkNotchDate() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        this._island.collapse(); await delay(400);
        const pill = this._pill, settings = this._settings, dates = pill._dates;
        const clock = Main.panel.statusArea.dateMenu._clock;
        const dateLabel = id => dates.items.get(id).date;
        settings.set_boolean('pill-show-date',false);
        settings.set_boolean('pill-show-time',true);
        for (const hour24 of [true,false]) for (const seconds of [false,true]) {
            settings.set_boolean('pill-time-24h',hour24); settings.set_boolean('pill-time-seconds',seconds);
            await delay(120);
            // The clock deliberately ticks 5ms after each second boundary.
            if (seconds && Date.now() % 1000 < 20) await delay(25);
            assert(pill._time.visible && pill._time.text === notchTime(new Date(),{hour24,seconds}), 'Notch clock format mismatch');
            assert(Boolean(pill._secondsTimer) === seconds && pill._dateClock === clock, 'Clock must share minute notifications and only schedule requested seconds');
        }
        const firstTime = pill._time.text, firstWidth = pill._time.width;
        await delay(1150);
        assert(pill._time.text !== firstTime && pill._time.width === firstWidth, 'Seconds did not update in a stable slot');
        assert(pill.actor.accessible_name.includes(pill._time.text), 'Clock time missing from accessible name');
        await this._capture('notch-time-seconds');
        this._island.expand(); await delay(350);
        assert(!pill._secondsTimer && !pill._dateClock && !pill._time.visible, 'Expanded island retains a clock timer/subscription');
        this._island.collapse(); await delay(350);
        assert(pill._secondsTimer, 'Clock seconds did not resume when visible');
        pill.actor.hide();
        const hiddenTime = pill._time.text;
        await delay(1150);
        assert(!pill._secondsTimer && !pill._dateClock && pill._time.text === hiddenTime, 'Hidden notch performs clock work');
        pill.actor.show(); await delay(120);
        assert(pill._secondsTimer && pill._time.text !== hiddenTime, 'Clock did not refresh after remapping');
        settings.set_boolean('pill-show-time',false);
        assert(!pill._secondsTimer && !pill._dateClock, 'Disabled clock retains work');
        settings.reset('pill-time-24h'); settings.reset('pill-time-seconds');
        settings.set_boolean('pill-show-date',true);
        console.log('[Island Preview] CLOCK PASS: 12/24h, seconds, stable width, accessible time, hidden/expanded/disabled cleanup');
        settings.reset('pill-date-formats');
        for (const calendar of ['jalali', 'gregorian', 'hijri']) {
            settings.set_strv('pill-date-calendars', [calendar]); await delay(180);
            const expected = notchDate(todayDay(), calendar), label = dateLabel(calendar);
            assert(pill._date.visible && label.text === expected.text, 'Notch date does not match chosen calendar');
            assert(pill.actor.accessible_name.includes(expected.description), 'Complete notch date is not accessible');
            assert(pill._dateClock === clock, 'Visible date is not using the existing clock');
            assert(!label.clutter_text.get_layout().is_ellipsized(), 'Compact single date is truncated');
            await this._capture(`notch-date-${calendar}`);
        }
        settings.set_strv('pill-date-calendars', ['gregorian']);
        settings.set_strv('pill-date-calendars', ['jalali', 'hijri']);
        settings.set_boolean('calendar-use-calendar-language',false); await delay(100);
        assert(dates.entries.every(entry => !entry.rtl && !/[\u0600-\u06ff]/.test(entry.text + entry.description)),
            'English setting did not update the notch dates and descriptions');
        const fullDescriptions = dates.entries.map(entry => entry.description).join();
        settings.set_strv('pill-date-short-months',['jalali','hijri']); await delay(100);
        for (const id of ['jalali','hijri'])
            assert(dateLabel(id).text === formatNotchDate(todayDay(),id,'%d %mm','auto',false,true), 'Short month setting did not update the notch');
        assert(dates.entries.map(entry => entry.description).join() === fullDescriptions, 'Short months changed accessible full dates');
        await this._capture('notch-short-english-months');
        settings.set_boolean('calendar-use-calendar-language',true); await delay(100);
        assert(/[\u0600-\u06ff]/.test(dateLabel('jalali').text), 'Calendar language did not restore in the notch');
        assert(dateLabel('jalali').text === formatNotchDate(todayDay(),'jalali'), 'Short months affected native calendar language');
        settings.reset('pill-date-short-months');
        settings.set_strv('pill-date-calendars', ['gregorian']);
        settings.set_string('calendar-primary', 'hijri');
        assert(dateLabel('gregorian').visible && dateLabel('gregorian').text === notchDate(todayDay(), 'gregorian').text,
            'Changing the main calendar overwrote the notch selection');
        settings.set_strv('pill-date-calendars', ['jalali', 'gregorian', 'hijri']);
        settings.set_strv('pill-date-order', ['gregorian', 'hijri', 'jalali']);
        settings.set_value('pill-date-formats', new GLib.Variant('a{ss}', {gregorian: '%D/%M', hijri: '%d %mm', jalali: '%Y/%M/%D'}));
        settings.set_value('pill-date-digits', new GLib.Variant('a{ss}', {jalali: 'latin'}));
        await delay(200);
        assert(dates.entries.map(entry => entry.id).join() === 'gregorian,hijri,jalali', 'Calendar order is incorrect');
        assert(pill._date.get_child_at_index(0) === dateLabel('gregorian'), 'Actor order is incorrect');
        assert(pill._date.get_child_at_index(2) === dateLabel('hijri'), 'Middle date is out of order');
        assert(pill._date.get_child_at_index(4) === dateLabel('jalali'), 'Last date is out of order');
        assert(dateLabel('jalali').text === formatNotchDate(todayDay(), 'jalali', '%Y/%M/%D', 'latin'), 'Per-calendar format/numerals ignored');
        await this._capture('notch-dates-multiple');
        settings.set_value('pill-date-formats', new GLib.Variant('a{ss}', Object.fromEntries(
            ['jalali', 'gregorian', 'hijri'].map(id => [id, '%WW %d %MM %Y']))));
        const context = St.ThemeContext.get_for_stage(global.stage), scale = context.scale_factor;
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}), textScale = text.get_double('text-scaling-factor');
        for (const size of [1, 2]) {
            context.scale_factor = size;
            text.set_double('text-scaling-factor', 1.5);
            this._island.applyDimensions(); await delay(250);
            const [px, py] = pill.actor.get_transformed_position(), [pw, ph] = pill.actor.get_transformed_size();
            const monitor = Main.layoutManager.primaryMonitor;
            assert(px >= monitor.x && px + pw <= monitor.x + monitor.width, 'Multiple dates exceed the monitor');
            const visible = [...dates.items.values()].flatMap(item => [item.date, item.separator]).filter(actor => actor.visible);
            for (const actor of visible) {
                const [x, y] = actor.get_transformed_position(), [w, h] = actor.get_transformed_size();
                assert(x >= px && x + w <= px + pw + 1 && y >= py && y + h <= py + ph + 1,
                    `Notch date overflows: ${actor.text} ${JSON.stringify({size, x, y, w, h, px, py, pw, ph})}`);
            }
            pill.actor.grab_key_focus(); await delay(100);
            assert(dates.truncated && dates.tip.visible, 'Long dates cannot be read on keyboard focus');
            for (const entry of dates.entries) assert(dates.tip.text.includes(entry.text), 'Full date is missing from tooltip');
            const [tx, ty] = dates.tip.get_transformed_position(), [tw, th] = dates.tip.get_transformed_size();
            assert(tx >= monitor.x && tx + tw <= monitor.x + monitor.width && ty + th <= monitor.y + monitor.height, 'Full-date tooltip overflows');
            await this._capture(`notch-dates-long-scale${size}`);
            global.stage.set_key_focus(null);
            assert(!dates.tip.visible, 'Date tooltip stayed after focus left');
        }
        text.set_double('text-scaling-factor', textScale); context.scale_factor = scale;
        settings.reset('pill-date-formats'); settings.reset('pill-date-digits'); settings.reset('pill-date-order');
        this._island.applyDimensions(); await delay(150);
        const order = settings.get_strv('pill-order');
        settings.set_strv('pill-order', ['date', ...order]);
        assert(pill._content.get_child_at_index(0) === pill._date, 'Dates group could not be reordered');
        settings.set_strv('pill-order', order);
        pill._dateDay--;
        clock.notify('clock');
        assert(pill._dateDay === todayDay(), 'Dates did not refresh after day changed');
        const fonts = new Set(), iter = dateLabel('jalali').clutter_text.get_layout().get_iter();
        do { const run = iter.get_run_readonly(); if (run) fonts.add(run.item.analysis.font.describe().get_family()); } while (iter.next_run());
        console.log(`[Island Preview] Notch date fonts: ${[...fonts].join(', ')}`);
        const installed = dateLabel('jalali').get_pango_context().list_families().map(family => family.get_name());
        if (installed.includes('Vazir') || installed.includes('Vazirmatn'))
            assert(fonts.has('Vazir') || fonts.has('Vazirmatn'), 'Persian text is not using Vazir/Vazirmatn');
        settings.set_strv('pill-date-calendars', []);
        assert(!pill._date.visible && !pill._dateClock, 'Empty calendar selection retained date indicator or clock');
        settings.set_strv('pill-date-calendars', ['jalali', 'gregorian']);
        for (let i = 0; i < 3; i++) {
            settings.set_boolean('pill-show-date', false);
            assert(!pill._date.visible && !pill._dateClock, 'Disabled dates retained clock subscription');
            settings.set_boolean('pill-show-date', true);
            assert(pill._dateClock === clock, 'Dates did not resume after enabling');
            this._island.expand(); await delay(300);
            assert(!pill._dateClock && !dates.tip.visible, 'Expanded notch retained dates subscription/tooltip');
            this._island.collapse(); await delay(300);
            assert(pill._dateClock === clock, 'Dates did not resume after collapsing');
        }
        this._island.actor.hide(); await delay(100);
        assert(!pill._dateClock && !dates.tip.visible, 'Hidden notch retained dates subscription/tooltip');
        this._island.actor.show(); await delay(100);
        assert(pill._dateClock === clock, 'Dates did not resume after showing');
        settings.set_string('calendar-primary', 'jalali');
        settings.set_strv('pill-date-calendars', ['jalali']);
        console.log('[Island Preview] Notch date checks passed: formats, multiple calendars, order, numerals, bounded layout, full-date tooltip, clock cleanup');
    }

    async _checkAudio() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(`Audio: ${message}`); };
        this._card.selectPage('audio');
        this._island.expand();
        await delay(200);
        const group = this._card._outputRows.get('bluetooth:sample');
        assert(['bluetooth:sample', 1, 4, 5].every((id, index) =>
            this._card._outputs.get_child_at_index(index) === this._card._outputRows.get(id)), 'Output category order is incorrect');
        const calls = group._modeButtons.get('calls');
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const [x,y] = calls.get_transformed_position();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + calls.width / 2, y + calls.height / 2);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(150);
        assert(calls.has_style_pseudo_class('checked') && /lower audio quality/.test(group._note.text), 'Calls click did not switch mode or explain quality');
        calls.grab_key_focus();
        this._audio.setVolume(0.45);
        assert(this._card._outputRows.get('bluetooth:sample') === group && calls.has_key_focus(), 'Volume update replaced the focused mode');
        await this._capture('sound-calls');
        this._audio.selectOutput(2);
        assert(group._modeButtons.get('music').has_style_pseudo_class('checked') && /mic off/.test(group._note.text), 'Music state was not restored');
        this._settings.set_int('expanded-width',380);
        await delay(200);
        const bounds = this._island.actor.get_transformed_position();
        assert(group.get_transformed_position()[0] + group.width <= bounds[0] + this._island.actor.width, 'Sound group overflows narrow card');
        await this._capture('sound-music-narrow');
        const adjustment = this._card._scroll.get_vscroll_bar().get_adjustment();
        adjustment.value = adjustment.upper - adjustment.page_size;
        await delay(100);
        const last = this._card._outputRows.get(5), viewport = this._card._scroll;
        const top = viewport.get_transformed_position()[1], bottom = top + viewport.get_transformed_size()[1];
        const lastTop = last.get_transformed_position()[1], lastBottom = lastTop + last.get_transformed_size()[1];
        assert(lastTop >= top - 1 && lastBottom <= bottom + 1, 'Other outputs are unreachable below the scroll area');
        await this._capture('sound-other-outputs');
        adjustment.value = adjustment.lower;
        this._settings.set_int('expanded-width',440);
        const bluetooth = this._states.bluetooth;
        const context = St.ThemeContext.get_for_stage(global.stage);
        const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const originalScale = context.scale_factor, originalText = desktop.get_double('text-scaling-factor');
        // The headless session has no settings daemon to forward the desktop
        // text scale to Clutter. Exercise actual font metrics, not just the key.
        const fontSettings = Clutter.Settings.get_default(), originalDpi = fontSettings.font_dpi;
        let normalBatteryWidth = 0;
        const updateBattery = battery => this._renderBluetooth({...bluetooth,
            devices: bluetooth.devices.map(device => ({...device, battery}))});
        calls.grab_key_focus();
        updateBattery(0);
        assert(group._battery.visible && group._batteryText.text === '0%', 'Empty battery was treated as missing');
        assert(calls.has_key_focus() && calls.accessible_name.includes('battery 0%'), 'Battery update lost focus or accessible context');
        updateBattery(null);
        assert(!group._battery.visible, 'Unavailable battery retained its old percentage');
        this._renderBluetooth({...bluetooth, powered: false});
        assert(!group._battery.visible, 'Powered-off Bluetooth retained a battery');
        this._settings.set_boolean('enable-bluetooth', false);
        updateBattery(100);
        assert(group._battery.visible && !this._pill._bluetooth.visible, 'Sound battery depends on the Bluetooth tab or enables its notch indicator');
        this._settings.set_boolean('enable-bluetooth', true);
        try {
            for (const scale of [1, 2]) for (const font of [1, 1.5, 2]) for (const width of [380, 440]) {
                context.scale_factor = scale;
                desktop.set_double('text-scaling-factor', font);
                fontSettings.font_dpi = Math.round(96 * 1024 * font);
                this._settings.set_int('expanded-width', width);
                await delay(250);
                const where = `${width}px/${scale}x/${font}text`;
                const batteryWidth = group._batteryText.get_preferred_width(-1)[1] / scale;
                if (font === 1) normalBatteryWidth = batteryWidth;
                else assert(batteryWidth > normalBatteryWidth * 1.2, `Enlarged text did not apply at ${where}`);
                const left = actor => actor.get_transformed_position()[0];
                const right = actor => left(actor) + actor.get_transformed_size()[0];
                assert(group._batteryText.width >= group._batteryText.get_preferred_width(-1)[1] - 1, `Battery clipped at ${where}`);
                assert(right(group._name) <= left(group._battery) + 1, `Name overlaps battery at ${where}`);
                assert(right(group._battery) <= left(group._check) + 1, `Battery overlaps selection at ${where}`);
                assert(right(group._check) <= right(group) + 1 && right(group) <= right(this._island.actor) + 1, `Row overflows at ${where}`);
                assert(group._name.width > 40 * scale, `Name has no useful space at ${where}`);
                await this._capture(`sound-battery-${width}-${scale}-${font}`);
                adjustment.value = adjustment.upper - adjustment.page_size;
                await delay(60);
                const lastY = last.get_transformed_position()[1];
                const viewportY = viewport.get_transformed_position()[1];
                assert(lastY >= viewportY - 1 && lastY + last.get_transformed_size()[1] <= viewportY + viewport.get_transformed_size()[1] + 1,
                    `Other outputs are unreachable at ${where}`);
                adjustment.value = adjustment.lower;
            }
        } finally {
            context.scale_factor = originalScale;
            desktop.set_double('text-scaling-factor', originalText);
            fontSettings.font_dpi = originalDpi;
            this._settings.set_int('expanded-width',440);
            this._renderBluetooth(bluetooth);
        }
        console.log('[Island Preview] AUDIO PASS: category order, grouped modes, focus, battery updates, missing/zero battery, 380/440px at 100/200% scale and enlarged text');
    }

    async _checkAgentMetadata() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,() => {resolve(); return GLib.SOURCE_REMOVE;}));
        const assert = (value, message) => {if (!value) throw new Error(message);};
        const {AgentStore, fromAgentHook} = await import('./services/agents-model.js');
        const store = new AgentStore(), process = {pid:99999,start:'12345'};
        const update = () => this._renderAgents(store.snapshot());
        store.apply(fromAgentHook('claude',{session_id:'metadata-parent',hook_event_name:'SessionStart',
            cwd:'/project',session_title:'Codex 3 fixes review'},{process}));
        store.apply({v:1,provider:'codex',session:'metadata-child',state:'working',label:'Review fixes',
            parent:{provider:'claude',profile:'default',session:'metadata-parent',process}});
        store.apply(fromAgentHook('claude',{session_id:'metadata-parent',hook_event_name:'Stop',cwd:'/scratchpad/before'}));
        this._card.selectPage('agents'); this._island.expand(); update(); await delay(500);
        const view = this._card._agentsView;
        const parent = [...view.rows.values()].find(item => item.session.provider === 'claude');
        const child = [...view.rows.values()].find(item => item.session.provider === 'codex');
        const context = St.ThemeContext.get_for_stage(global.stage), oldScale = context.scale_factor;
        const desktop = new Gio.Settings({schema_id:'org.gnome.desktop.interface'}), textScale = desktop.get_double('text-scaling-factor');
        const originalWindow = view.actions.agentWindow, originalOpen = view.actions.agentOpen;
        const oldWidth = this._settings.get_int('expanded-width');
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const target = {};
        let opened;
        try {
            view.actions.agentWindow = session => session.provider === 'codex' ? target : null;
            view.actions.agentOpen = session => {opened = session.id;};
            for (const scale of [1,2]) for (const text of [1,1.5]) for (const width of [380,440]) {
                this._island.expand();
                context.scale_factor = scale;
                desktop.set_double('text-scaling-factor',scale * text);
                this._settings.set_int('expanded-width',width); update(); await delay(250);
                assert(view.rows.get(child.session.id) === child,'Metadata update replaced row');
                assert(parent.title.text === 'Codex 3 fixes review','cwd replaced title');
                assert(parent.status.text.startsWith('Waiting for Codex'),'Waiting state missing');
                assert(child.status.text.includes('⤷ From Claude'),'Relationship cue missing');
                assert(child.open.accessible_name.includes('Started by Codex 3 fixes review'),'Accessible parent missing');
                child.menu.grab_key_focus(); await delay(120);
                assert(view.relationshipTip.tip.visible && view.relationshipTip.tip.text === 'Started by Codex 3 fixes review',`Keyboard explanation missing at ${width}/${scale}/${text}, focus=${child.menu.has_key_focus()}, expanded=${this._island.expanded}, target=${view.relationshipTip.target?.actor}, text=${view.relationshipTip.tip.text}`);
                assert(child.status.width > 0 && child.status.clutter_text.get_layout().get_pixel_size()[0] <= child.status.width + 1,'Status overflows width');
                assert(child.actor.get_transformed_position()[0] + child.actor.width <= view.scroll.get_transformed_position()[0] + view.scroll.width + 1,'Row overflows card');
                const order = view.activeList.get_children();
                store.setTitle(parent.session.id,'Renamed parent'); update(); await delay(60);
                assert(child.menu.has_key_focus() && view.relationshipTip.tip.text === 'Started by Renamed parent','Rename lost focus or stale tooltip');
                assert(order.every((actor,index) => actor === view.activeList.get_children()[index]),'Rename reordered rows');
                view._session(child); await delay(80);
                assert(view.sessionMenu.visible, `Menu closed before Escape at ${width}/${scale}/${text}, focus=${global.stage.get_key_focus()}, adjustment=${view.adjustment.value}`);
                assert(view.menuUpdated.text.includes('Started by Renamed parent'),'Session details omit parent');
                view.handleEscape(); await delay(50); assert(child.menu.has_key_focus(),`Escape lost menu focus at ${width}/${scale}/${text}, expanded=${this._island.expanded}, menu=${view.sessionMenu.visible}, focus=${global.stage.get_key_focus()}`);
                store.setTitle(parent.session.id,'Codex 3 fixes review'); update();
                await this._capture(`agent-metadata-${width}-${scale}-${text}`);
                const [x,y] = child.actor.get_transformed_position();
                pointer.notify_absolute_motion(GLib.get_monotonic_time(),x+30,y+child.actor.height/2); await delay(100);
                update(); await delay(60); assert(child.actor.hover,'Update lost stationary hover');
                child.open.emit('clicked', 1); assert(opened === child.session.id,'Child activation changed identity');
            }
            this._island.collapse(); await delay(300);
            assert(this._pill._agents.visible && this._pill._agentsText.text.includes('◷1'),'Notch omitted waiting count');
            assert(!view.relationshipTip.tip.visible && !child.glyph.get_transition('agent-working'),'Hidden tooltip or motion');
        } finally {
            view.actions.agentWindow = originalWindow; view.actions.agentOpen = originalOpen;
            context.scale_factor = oldScale; desktop.set_double('text-scaling-factor',textScale);
            this._settings.set_int('expanded-width',oldWidth);
        }
        console.log('[Island Preview] AGENT METADATA PASS: titles, waiting, parent cue, live rename, stable actors/focus/hover, activation identity, widths/scales/text and hidden cleanup');
    }

    async _checkAgentHover() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,() => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (value,message) => { if (!value) throw new Error(message); };
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._card.selectPage('agents'); this._island.expand(); await delay(500);
        const view = this._card._agentsView, initial = this._states.agents;
        const first = [...view.rows.values()][0];
        const originalWindow = view.actions.agentWindow;
        const context = St.ThemeContext.get_for_stage(global.stage), scale = context.scale_factor;
        const width = this._settings.get_int('expanded-width');
        try {
            for (const currentScale of [1,2]) for (const currentWidth of [380,440]) {
                context.scale_factor = currentScale;
                this._settings.set_int('expanded-width',currentWidth); await delay(200);
                const [hx,hy] = first.actor.get_transformed_position();
                pointer.notify_absolute_motion(GLib.get_monotonic_time(), hx+50, hy+first.actor.height/2);
                await delay(100);
                for (const available of [true,false,true,false]) {
                    view.actions.agentWindow = () => available ? {} : null;
                    view.render(initial); await delay(80);
                    assert(first.actor.hover && first.actor.get_theme_node().get_background_color().alpha > 0,
                        'Session hover flickered when window availability changed');
                    assert(first.open.reactive === available, 'Hover changed safe window activation behavior');
                }
                await this._capture(`agents-hover-${currentWidth}-${currentScale}`);
                pointer.notify_absolute_motion(GLib.get_monotonic_time(),50,500);
            }
        } finally {
            view.actions.agentWindow = originalWindow; view.render(initial);
            context.scale_factor = scale; this._settings.set_int('expanded-width',width);
        }
        this._card.selectPage('media'); await delay(100);
        assert(!first.actor.mapped && !first.glyph.get_transition('agent-working'), 'Hidden session retained hover work');
        console.log('[Island Preview] AGENT HOVER PASS: stable highlight, safe activation, hidden cleanup');
    }

    async _checkAgents() {
        const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const assert = (condition, message) => { if (!condition) throw new Error(`Agents: ${message}`); };
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const click = async actor => {
            const adjustment = view.adjustment;
            const top = view.scroll.get_transformed_position()[1];
            const bottom = top + view.scroll.height;
            const y = actor.get_transformed_position()[1];
            if (view.content.contains(actor) && (y + actor.height > bottom || y < top)) {
                adjustment.value = Math.min(adjustment.upper - adjustment.page_size, Math.max(0, adjustment.value + y - top));
                await delay(100);
            }
            const [x, yy] = actor.get_transformed_position();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + actor.width / 2, yy + actor.height / 2);
            await delay(50);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            await delay(70);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(150);
        };
        this._card.selectPage('agents');
        const view = this._card._agentsView;
        assert(view.rows.size === 3 && this._pill._agents.visible, 'Sample sessions or counts missing');
        const initial = this._states.agents;
        await delay(200);
        for (const width of [380,440]) {
            this._settings.set_int('expanded-width',width);
            await delay(150);
            assert(view.adjustment.upper <= view.adjustment.page_size + 1, `Small session list scrolls at ${width}px: ${view.adjustment.upper}/${view.adjustment.page_size}`);
        }
        const first = [...view.rows.values()][0];
        assert(!view.recentList && !view.recentButton && view.activeList.get_n_children() === 3, 'Sessions are not in one list');
        assert(!first.open.reactive && !first.open.can_focus && !first.arrow.visible, 'Unmatched session offers window activation');
        assert(first.harness.gicon && first.status.text === 'Needs approval · sample-1', 'Harness/status/session reference missing');
        const sharedProject = {...initial, sessions:initial.sessions.map(s => ({...s, label:'same-project'}))};
        this._renderAgents(sharedProject);
        assert(new Set([...view.rows.values()].map(item => item.reference)).size === 3, 'Same-project sessions cannot be distinguished');
        for (const item of view.rows.values()) {
            assert(item.status.text.includes(item.reference) && item.menu.accessible_name.includes(item.reference), 'Session identity missing from visible/accessibility labels');
        }
        await this._capture('agents-same-project');
        this._renderAgents(initial);
        const order = view.activeList.get_children();
        await click(first.open);
        assert(view.mode === 'list' && this._island.expanded, 'Unmatched session opened a chooser or dismissed the island');
        const listHeight = this._island.actor.height;
        await click(first.menu);
        assert(view.mode === 'list' && view.sessionMenu.visible && view.hideSession.has_key_focus(), 'Session menu replaced the list or lost focus');
        assert(view.menuIdentity.text === first.session.session && !view.menuIdentity.clutter_text.editable,
            'Full session ID is missing or editable');
        const keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const press = async (key, shift = false) => {
            if (shift) keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
            if (shift) keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
            await delay(100);
        };
        await press(Clutter.KEY_Tab, true);
        assert(view.sessionMenu.visible && view.menuIdentity.clutter_text.has_key_focus(), 'Full session ID is not keyboard reachable');
        await press(Clutter.KEY_Tab);
        assert(view.hideSession.has_key_focus(), 'Tab did not return to the menu action');
        assert(this._island.actor.height === listHeight, 'Session menu changed island height');
        await this._capture('agents-session-menu');
        assert(this._island._onEscape() && !view.sessionMenu.visible && first.menu.has_key_focus(), 'Escape did not restore menu focus');
        await click(first.menu); await click(view.heading);
        assert(!view.sessionMenu.visible && view.mode === 'list', 'Click outside session menu did not dismiss it');
        const updated = {...initial, sessions:initial.sessions.map((s,i) => i ? s : {...s,state:'working'})};
        first.menu.grab_key_focus();
        this._renderAgents(updated);
        assert([...view.rows.values()][0] === first && first.menu.has_key_focus(), 'Status update replaced a row or stole focus');
        assert(view.activeList.get_children().every((actor,i)=>actor === order[i]), 'Status update reordered click targets');
        const motionBefore = this._settings.get_boolean('disable-animations');
        this._settings.set_boolean('disable-animations', true);
        assert(!view.activity && view.summary.text.includes('working'), 'Header should contain status counts without a spinner');
        assert(!first.glyph.get_transition('agent-working'), 'Reduced motion retained an animation');
        this._settings.set_boolean('disable-animations', false);
        if (view.stSettings.enable_animations) {
            assert(first.glyph.get_transition('agent-working'), 'Visible working indicators did not animate');
            const angle = first.glyph.rotation_angle_z; await delay(200);
            assert(first.glyph.rotation_angle_z !== angle, 'Session working ring is static');
        }
        this._card.selectPage('media');
        await delay(100);
        assert(!first.glyph.get_transition('agent-working'), 'Hidden Agents view retained its animation');
        const text = first.status.text;
        this._renderAgents(initial);
        assert(first.status.text === text, 'Hidden session view repainted');
        this._card.selectPage('agents');
        await delay(150);
        assert(first.status.text.includes('Needs approval'), 'Remapped view did not catch up');
        await click(view.askButton);
        assert(view.mode === 'ask' && view.prompt.clutter_text.has_key_focus(), 'Quick Ask pointer click failed');
        assert(!first.glyph.get_transition('agent-working'), 'Composer retained a row animation');
        await this._capture('agents-composer-empty');
        assert(view.adjustment.upper <= view.adjustment.page_size, `Default composer needs unnecessary scrolling: ${view.adjustment.upper}/${view.adjustment.page_size}`);
        view.prompt.text = 'A sample multiline request\nKeep this as one prompt.';
        this._island._onEscape();
        assert(view.mode === 'list' && view.prompt.text.includes('multiline'), 'Escape discarded a draft');
        await click(view.askButton);
        await click(view.providerButton);
        await this._capture('agents-harness-menu');
        await click(view.harnessMenu.get_children()[1]);
        assert(view.provider === 'codex' && !view.harnessMenu.visible, 'Harness picker did not select Codex');
        assert(view.prompt.clutter_text.has_key_focus() && view.prompt.clutter_text.editable, 'Harness selection lost prompt input');
        const ask = this._card._actions.agentAsk;
        this._card._actions.agentAsk = () => { throw new Error('Test app is unavailable'); };
        await click(view.submit);
        assert(view.mode === 'ask' && view.prompt.text.includes('multiline') && /unavailable/.test(view.hint.text), 'Launch failure discarded the draft or hid the error');
        this._card._actions.agentAsk = ask;
        view._syncEditor();
        view.adjustment.value = 0;
        await delay(100);
        await this._capture('agents-quick-ask');
        await click(view.submit);
        assert(view.mode === 'list' && !view.prompt.text && /Sample request/.test(view.message.text), `Sample submission failed: mode=${view.mode}, prompt=${Boolean(view.prompt.text)}, message=${view.message.text}`);
        const textSettings = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        const scale = textSettings.get_double('text-scaling-factor');
        const height = this._island.actor.height;
        this._settings.set_int('expanded-width',380);
        textSettings.set_double('text-scaling-factor',1.5);
        await delay(200);
        const right = this._island.actor.get_transformed_position()[0] + this._island.actor.width;
        await this._capture('agents-narrow-large-text');
        for (const item of view.rows.values()) if (item.open.mapped) assert(item.open.get_transformed_position()[0] + item.open.width <= right, `Session button overflows at narrow width: ${item.session.label}, width=${item.open.width}, right=${right}`);
        const textMax = Math.min(this._settings.get_int('expanded-max-height') * St.ThemeContext.get_for_stage(global.stage).scale_factor +
            this._island._border, this._island._heightBudget());
        assert(this._island.actor.height >= height - 1 && this._island.actor.height <= textMax + 1, 'Text scaling left the Agents height bounds');
        await this._capture('agents-narrow-large-text');
        textSettings.set_double('text-scaling-factor',scale);
        this._settings.set_int('expanded-width',440);
        view.show('list'); view.adjustment.value = 0;
        await delay(200);
        await this._capture('agents');
        const context = St.ThemeContext.get_for_stage(global.stage), originalScale = context.scale_factor;
        context.scale_factor = 2;
        await delay(200);
        assert(this._island.actor.width === 880, 'Agents layout did not follow 200% display scaling');
        const navigation = this._card._navigation, island = this._island.actor;
        assert(view.footer.get_transformed_position()[1] >= navigation.get_transformed_position()[1] + navigation.height - 1 &&
            view.footer.get_transformed_position()[1] + view.footer.height <= island.get_transformed_position()[1] + island.height + 1,
        'Agents footer overlaps navigation or leaves the card at 200%');
        await this._capture('agents-scaled');
        await click(first.menu); await this._capture('agents-session-menu-scaled'); view.handleEscape();
        const regularSize = [this._island.actor.width, this._island.actor.height];
        textSettings.set_double('text-scaling-factor', 1.5);
        view.show('ask'); await delay(200);
        view.prompt.text = ''; await this._capture('agents-composer-scaled-large');
        view.providerButton.emit('clicked', 1); await delay(100);
        await this._capture('agents-harness-scaled-large');
        view.harnessMenu.get_children()[2].emit('clicked', 1); await delay(100);
        assert(view.prompt.clutter_text.has_key_focus(), 'Large-text harness selection lost focus');
        view.prompt.text = 'Sample draft';
        view.submit.grab_key_focus(); view._revealFocus(); await delay(100);
        const maxHeight = Math.min(this._settings.get_int('expanded-max-height') * 2 + this._island._border, this._island._heightBudget());
        assert(this._island.actor.width === regularSize[0] && this._island.actor.height >= REGULAR_HEIGHT * 2 + this._island._border - 1 &&
            this._island.actor.height <= maxHeight + 1, 'Composer left the expanded width or height bounds');
        textSettings.set_double('text-scaling-factor', scale);
        view.show('list'); await delay(100);
        context.scale_factor = originalScale;
        await delay(200);
        const many = {...initial, sessions:[...initial.sessions, ...Array.from({length:12}, (_,i) => ({...initial.sessions[0], id:`overflow-${i}`, label:`Session ${i + 1}`}))]};
        this._renderAgents(many); view.show('list');
        await delay(200);
        assert(view.adjustment.upper > view.adjustment.page_size, 'Long session list has no scroll range');
        const [sx,sy] = view.scroll.get_transformed_position();
        const footerY = view.footer.get_transformed_position()[1];
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), sx + view.scroll.width / 2, sy + view.scroll.height / 2);
        await delay(50);
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
        await delay(250);
        assert(view.adjustment.value > 0, 'Mouse wheel did not scroll sessions');
        const last = view.rows.get('overflow-11');
        for (const item of [last, [...view.rows.values()][0], last]) {
            item.menu.grab_key_focus();
            await delay(150);
            const top = item.actor.get_transformed_position()[1];
            assert(top >= sy - 1 && top + item.actor.height <= sy + view.scroll.height + 1,
                `Keyboard focus did not reveal the full session: top=${top}, bottom=${top + item.actor.height}, viewport=${sy}/${sy + view.scroll.height}, scroll=${view.adjustment.value}, focused=${item.menu.has_key_focus()}, mapped=${view.actor.mapped}, reveal=${view.revealIdle}`);
        }
        const workingRow = [...view.rows.values()].find(item => item.session.state === 'working');
        assert(!workingRow.glyph.get_transition('agent-working'), 'Scrolled-out working row kept animating');
        await click(last.menu);
        assert(view.mode === 'list' && view.menuSession === last && view.sessionMenu.visible, 'Last scrolled session menu is unreachable');
        assert(view.sessionMenu.get_transformed_position()[1] + view.sessionMenu.height <= footerY + 1,
            `Session menu overlaps the fixed footer: bottom=${view.sessionMenu.get_transformed_position()[1] + view.sessionMenu.height}, footer=${footerY}, stack=${view.stack.height}, menu=${view.sessionMenu.height}, translation=${view.sessionMenu.translation_y}`);
        await this._capture('agents-scrolled-menu');
        assert(view.footer.get_transformed_position()[1] === footerY, 'Scrolling moved Quick Ask');
        view.show('list'); this._renderAgents(initial);
        await delay(150);
        assert(view.adjustment.value === 0, 'Shortened list retained stale scroll offset');
        view.folder.text = '/tmp'; view.prompt.text = 'Remember this project';
        await click(view.askButton);
        await click(view.submit);
        assert(this._settings.get_string('agents-project') === '/tmp', 'Successful launch did not remember the project');
        // A real GTK window inside this private session supplies a process ID.
        // A unique ancestry match activates it; ambiguous or absent matches do not.
        this._settings.set_string('preferences-page', 'notch');
        this.openPreferences();
        let window;
        for (let i = 0; i < 40 && !window; i++) {
            await delay(100);
            window = this._agentWindows.all().find(w => w.get_title() === 'Ubuntu Island' && w.get_compositor_private()?.mapped);
        }
        assert(window, 'Window discovery failed');
        await delay(600);
        await this._capture('notch-order-preferences');
        this._island.expand();
        this._openAgent(first.session);
        assert(view.mode === 'list' && this._island.expanded, 'Unmatched session opened a chooser');
        await this._agents.send({...first.session, pids:[window.get_pid()]});
        assert(this._agentWindows.resolve(first.session) === window && first.open.reactive && first.arrow.visible,
            'Unique process ancestry match did not enable the row');
        const ambiguous = {is_skip_taskbar:() => false, get_pid:() => window.get_pid()};
        this._agentWindows.windows.set(ambiguous, []); view.render(this._states.agents);
        assert(!this._agentWindows.resolve(first.session) && !first.open.reactive, 'Shared process ID guessed a window');
        const matcher = this._agentWindows, lookup = matcher.terminalIdentity;
        const second = [...view.rows.values()].find(item => item !== first);
        const secondOriginal = {...second.session};
        const terminal = id => ({kind:'terminator',bus:'net.tenshu.Terminator2',id:`urn:uuid:${id.repeat(8)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(12)}`});
        let secondTitle = 'Other terminal window', lookups = 0;
        ambiguous.get_title = () => secondTitle;
        matcher.terminalIdentity = async session => {
            lookups++;
            return {pid:window.get_pid(),title:session.terminal.id === terminal('1').id ? window.get_title() : secondTitle};
        };
        await this._agents.send({...first.session,terminal:terminal('1')});
        await this._agents.send({...second.session,pids:[window.get_pid()],terminal:terminal('2')});
        await delay(80);
        assert(first.open.reactive && second.open.reactive && matcher.resolve(first.session) === window && matcher.resolve(second.session) === ambiguous,
            'Two sessions sharing a terminal process are not independently clickable');
        const beforeActivation = lookups;
        assert(await matcher.resolveForActivation(first.session) === window && lookups > beforeActivation,
            'Activation reused stale terminal metadata');
        secondTitle = window.get_title(); matcher._invalidate(ambiguous); await delay(80);
        assert(!first.open.reactive && !second.open.reactive, 'Duplicate titles guessed a window');
        secondTitle = 'Other terminal window'; matcher._invalidate(ambiguous); await delay(80);
        const requestCount = lookups;
        this._card.selectPage('media');
        assert(!matcher.identities.size && !matcher.resolve(first.session) && lookups === requestCount,
            'Hidden Agents retained identity requests or started a lookup');
        this._card.selectPage('agents'); await delay(80);
        assert(first.open.reactive && second.open.reactive, 'Reopening did not restore terminal matches');
        // A cancelled reply must not recreate a mapping after the view hides.
        let late;
        matcher.terminalIdentity = () => new Promise(resolve => { late = resolve; });
        matcher._invalidate(window);
        this._card.selectPage('media');
        late?.({pid:window.get_pid(),title:window.get_title()}); await delay(30);
        assert(!matcher.identities.size, 'Late terminal reply revived hidden metadata');
        matcher.terminalIdentity = lookup;
        matcher.windows.delete(ambiguous);
        await this._agents.send({...first.session,terminal:null});
        await this._agents.send(secondOriginal);
        this._card.selectPage('agents'); view.render(this._states.agents);

        this._openAgent(first.session);
        await delay(500);
        assert((global.display.focus_window === window || global.display.focus_window?.get_transient_for() === window) && !this._island.expanded, `Selected window did not receive focus: focused=${global.display.focus_window?.get_title()}, expanded=${this._island.expanded}, message=${view.message.text}`);
        assert(this._agentWindows.resolve(first.session) === window, 'Process match was not retained');
        window.delete(global.get_current_time());
        await delay(300);
        assert(!this._agentWindows.resolve(first.session), 'Closed window is still a target');
        view.show('list');
        this._island.expand();
        await delay(200);
        await click(first.menu);
        assert(!first.open.reactive && !first.arrow.visible, 'Closed window left an activation affordance');
        await click(view.hideSession);
        assert(view.rows.size === 2, 'Dismiss did not update the list');
        const latest = {...first.session, state:'input', start:true};
        await this._agents.send(latest);
        assert(view.rows.size === 2 && view.undoRow.visible, 'Hidden event resurfaced a row or lost Undo');
        await click(view.undoButton);
        assert(view.rows.size === 3 && view.rows.get(first.session.id).session.state === 'input', 'Undo restored stale status');
        assert(view.clearButton.visible && view.notchButton.visible, 'Main Agents actions missing');
        await click(view.notchButton);
        assert(view.mode === 'list' && !this._settings.get_boolean('pill-show-agents') && !this._pill._agents.visible, 'Main notch control did not hide status');
        await click(view.notchButton);
        assert(this._settings.get_boolean('pill-show-agents') && this._pill._agents.visible, 'Main notch control did not restore status');
        await click(view.clearButton);
        assert(view.rows.size === 2 && [...view.rows.values()].every(item=>!['finished','closed'].includes(item.session.state)), 'Clear finished affected active work');
        assert(!view.clearButton.reactive, 'Clear must be disabled without finished sessions');
        await click(view.undoButton);
        assert(view.rows.size === 3, 'Clear finished could not be undone');
        const stale = [...this._agentSampleStore.rows.values()][0];
        stale.updated = Date.now() - 2 * 60 * 60000;
        this._settings.set_int('agents-inactive-minutes', 180);
        this._renderAgents(this._agentSampleStore.snapshot());
        assert(view.rows.size === 3, 'Expiry ran while already viewing Agents');
        this._card.selectPage('media'); this._card.selectPage('agents'); await delay(100);
        assert(view.rows.size === 3, 'Configured inactivity limit was ignored');
        this._settings.set_int('agents-inactive-minutes', 60);
        assert(view.rows.size === 3, 'Settings change performed background cleanup');
        this._card.selectPage('media');
        assert(this._agentSampleStore.rows.size === 3, 'Hidden tab performed cleanup');
        this._card.selectPage('agents'); await delay(100);
        assert(view.rows.size === 2 && this._agentSampleStore.rows.size === 2, 'Opening Agents did not expire cached and stored sessions');
        await this._agents.send({...stale, state:'working', start:true});
        assert(view.rows.size === 3, 'New activity did not return an expired session');
        this._settings.set_boolean('disable-animations', motionBefore);
        await this._agents.send({control:'clear'});
        assert(view.rows.size === 0, 'Clear did not update the list');
        assert(view.empty.visible && view.summary.text === 'No active sessions', 'Empty observer has the wrong session state');
        assert(!view.empty.get_children().some(child => child instanceof St.Button), 'An idle observer incorrectly asks to set up tracking');
        await this._capture('agents-empty');
        sampleAgents(this);
        // Notices come from one Ubuntu Island source and carry the harness logo.
        const notices = [];
        for (const provider of ['claude', 'codex', 'opencode', 'unknown-harness']) {
            this._notifyAgent({provider, state: 'finished', label: `Notice ${provider}`});
            notices.push(this._agentNoticeSource.notifications.at(-1));
        }
        const source = this._agentNoticeSource;
        assert(source.title === 'Ubuntu Island' && source.icon === agentIcon, 'Agent notices lack the Ubuntu Island source');
        for (const [i, provider] of ['claude', 'codex', 'opencode'].entries())
            assert(notices[i].gicon?.get_file?.().get_path().endsWith(`/assets/agents/${provider}.svg`), `${provider} notice lacks its logo`);
        assert(notices[3].gicon === agentIcon, 'Unknown harness notice lacks the module icon');
        assert(notices[0].title === 'Task finished' && notices[0].body.endsWith('Notice claude'), 'Agent notice text changed');
        source.destroy();
        assert(!this._agentNoticeSource, 'Destroyed notice source was retained');
        console.log('[Island Preview] AGENTS PASS: harness icons, inline menus, unique window matches, lazy expiry, draft/errors, Undo, motion cleanup and narrow/scaled layout');
    }

    openPreferences() {
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.set_environ(GLib.get_environ());
        for (const [key, value] of Object.entries({WAYLAND_DISPLAY: 'island-preview', GDK_BACKEND: 'wayland',
            GI_TYPELIB_PATH: '/usr/lib/gnome-shell/girepository-1.0', LD_LIBRARY_PATH: '/usr/lib/gnome-shell',
            GTK_USE_PORTAL: '0', ADW_DISABLE_PORTAL: '1', GTK_A11Y: 'none'})) launcher.setenv(key, value, true);
        launcher.spawnv(['gjs', '-m', `${this.path}/local-preferences.mjs`]);
    }

    async _capture(name = GLib.getenv('ISLAND_PREVIEW_TAB') || 'notch') {
        const file = Gio.File.new_for_path(`${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/${name}.png`);
        const stream = await new Promise((resolve, reject) => file.replace_async(null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT_IDLE, null, (f, result) => {
                try { resolve(f.replace_finish(result)); } catch (e) { reject(e); }
            }));
        try { await new Shell.Screenshot().screenshot(false, stream); }
        finally { stream.close(null); }
    }

    disable() {
        this._previewConfigured = false;
        if (this._previewInput) global.stage.disconnect(this._previewInput);
        this._previewInput = 0;
        if (this._previewTimer) GLib.Source.remove(this._previewTimer);
        if (this._captureTimer) GLib.Source.remove(this._captureTimer);
        this._previewTimer = this._captureTimer = 0;
        super.disable();
    }
}
