// Runs only in the temporary Shell created by tests/smoke.py.
import UbuntuIsland from './implementation.js';
import {localTime} from './services/weather-model.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Cogl from 'gi://Cogl';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

export default class Smoke extends UbuntuIsland {
    enable() {
        this.getSettings().set_boolean('enable-weather', true);
        super.enable();
        this._smoke().catch(error => console.error(`[Island Smoke] FAIL ${error.message}: ${error.stack}`));
    }

    async _capture(name) {
        await delay(300);
        const file = Gio.File.new_for_path(`${GLib.getenv('ISLAND_SMOKE_OUTPUT')}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        try { await new Shell.Screenshot().screenshot(false, stream); }
        finally { stream.close(null); }
    }

    _checkNavigationAlignment() {
        const center = actor => actor.get_transformed_position()[1] + actor.get_transformed_size()[1] / 2;
        const caption = this._card._pageCaption;
        const expected = center(caption);
        const tolerance = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const [id, tab] of this._card._tabs) {
            if (!tab.visible) continue;
            assert(Math.abs(center(tab.child.get_first_child()) - expected) <= tolerance,
                `${id} icon is not aligned with the navigation caption`);
            const glyph = tab.child.get_first_child();
            const marker = tab.child.get_last_child();
            assert(marker.get_transformed_position()[1] >= glyph.get_transformed_position()[1] + glyph.height,
                `${id} selection marker overlaps its icon`);
        }
        const preferences = caption.get_parent().get_last_child();
        assert(Math.abs(center(preferences.child) - expected) <= tolerance,
            'Preferences icon is not aligned with the navigation caption');
    }

    async _smoke() {
        await delay(3500);
        Main.overview.hide();
        const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        background.set_string('picture-options', 'none');
        background.set_string('primary-color', '#897c6c');
        this._system?.stop();
        this._media?.stop();
        this._audio?.stop();
        this._bluetooth?.stop();
        this._settings.set_boolean('disable-animations', true);
        if (this._media) this._media.positionSec = () => 72;
        for (let i = 0; i < 60; i++) this._renderSystem({
            cpu: 24 + 16 * Math.sin(i / 5), memory: 48 + 4 * Math.sin(i / 12),
            loadAvg: 1.44, memoryUsed: 3.5 * 1024 ** 3,
            iface: 'wlan0', rx: '2.4 MB/s', tx: '128 KB/s',
            rxBytes: 1e6 + 8e5 * Math.sin(i / 4), txBytes: 2e5 + 1e5 * Math.sin(i / 3),
        });
        const audio = {available: true, volume: 0.64, muted: false, outputs: [
            {id: 1, name: 'Built-in speakers', active: true},
            {id: 2, name: 'HDMI / DisplayPort', active: false},
        ]};
        this._renderAudio(audio);
        const originalRow = this._card._outputRows.get(1);
        this._renderAudio({...audio, volume: 0.65});
        assert(this._card._outputRows.get(1) === originalRow, 'Audio update replaced a focused row');
        this._renderBluetooth({available: true, hasAdapter: true, powered: true, devices: [
            {path: '/org/bluez/test', name: 'Studio headphones', connected: true, battery: 82},
        ]});
        this._renderMedia({available: false});
        assert(!this._card._mediaSection.box.visible, 'Idle media section is visible');
        assert(!this._pill._mediaIcon.visible && !this._pill._title.visible,
            'Idle notch retains media icon or label');
        await this._capture('collapsed');

        const media = {available: true, title: 'A quiet place to begin', artist: 'Evening sessions',
            playerName: 'spotify', status: 'Playing', positionSec: 72, canControl: true, canNext: true, canPrevious: true, canSeek: true, lengthSec: 240};
        this._renderMedia(media);
        // Procedural fixture cover; no real music or network request needed.
        const pixels = new Uint8Array(160 * 160 * 4);
        for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
            const offset = (y * 160 + x) * 4;
            const sun = Math.hypot(x - 104, y - 49) < 25;
            const ridge = y > 100 + Math.sin(x / 24) * 18;
            pixels.set(sun ? [192, 68, 43, 255] : ridge ? [51, 47, 42, 255]
                : [224 - Math.round(y / 8), 211 - Math.round(y / 6), 190 - Math.round(y / 5), 255], offset);
        }
        const cover = St.ImageContent.new_with_preferred_size(160, 160);
        cover.set_data(pixels, Cogl.PixelFormat.RGBA_8888, 160, 160, 160 * 4);
        this._card.renderArt(cover);
        this._card._pillTitle.emit('clicked', 1);
        assert(!this._pill._title.visible && this._pill._mediaIcon.visible, 'Hide title removed the playback icon');
        await this._capture('hidden-title-pill');
        this._togglePillTitle();
        assert(this._pill._title.visible, 'Title did not return');
        await this._capture('playing-pill');
        this._island.expand();
        assert(this._island.state === 'expanded', 'Could not expand');
        assert(global.stage.key_focus === this._island.actor, 'Opening focused a child control');
        this._card.renderProgress(72);
        await this._capture('expanded');
        this._checkNavigationAlignment();
        const decoded = await new Promise(resolve => this._art.load(
            `file://${GLib.getenv('ISLAND_SMOKE_OUTPUT')}/expanded.png`, 64, resolve));
        assert(decoded !== null, 'Local artwork failed to decode');
        this._card.renderArt(cover);
        assert(this._card._page === 'media', 'Media did not select its compact face');
        for (const [page, name] of [['system', 'system'], ['audio', 'sound'], ['bluetooth', 'bluetooth']]) {
            this._card.selectPage(page);
            assert([...this._card._pages.values()].filter(item => item.box.visible).length === 1,
                'More than one module surface is visible');
            await this._capture(name);
        }
        let weatherRequests = 0;
        this._weather.http.get = async () => {
            weatherRequests++;
            return {current: {temperature_2m: 18, apparent_temperature: 16,
                relative_humidity_2m: 42, wind_speed_10m: 12, weather_code: 2}, hourly: {
                    time: [1, 2, 3, 4].map(i => localTime('Asia/Tehran', Date.now() + i * 3600000)),
                    temperature_2m: [17, 16, 15, 14], precipitation_probability: [0, 20, 40, 60]}};
        };
        this._settings.set_string('weather-location', JSON.stringify({name: 'Tehran, Iran',
            latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran'}));
        assert(weatherRequests === 0, 'Hidden Weather fetched data');
        this._card.selectPage('weather');
        await delay(100);
        assert(weatherRequests === 1, 'Visible Weather did not fetch exactly once');
        const scene = this._card._weatherView.scene;
        const paint = scene.paint.bind(scene);
        let paintCount = 0, paintTotalUs = 0, paintMaxUs = 0;
        scene.paint = () => {
            const started = GLib.get_monotonic_time();
            paint();
            const elapsed = GLib.get_monotonic_time() - started;
            paintCount++; paintTotalUs += elapsed; paintMaxUs = Math.max(paintMaxUs, elapsed);
        };
        const desktopMotion = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        desktopMotion.set_boolean('enable-animations', true);
        scene.isPowerSaving = () => false; // Isolate fixture from the host power profile.
        this._settings.set_boolean('disable-animations', false);
        this._settings.set_string('weather-motion', 'live');
        await delay(200);
        assert(scene.ready && scene.sprite.width > 0 && scene.image.get_content(), 'Weather atlas failed to load or allocate');
        assert(scene.timer !== 0, `Visible live weather has no animation timer: active=${scene.active} mapped=${scene.actor.mapped} viewport=${scene.inViewport()} animations=${scene.stSettings.enable_animations} locked=${Main.sessionMode.isLocked} power=${scene.power?.get_cached_property('ActiveProfile')?.deep_unpack()}`);
        scene.isPowerSaving = () => true;
        scene.sync();
        assert(scene.timer === 0, 'Power saver retained weather timer');
        scene.isPowerSaving = () => false;
        this._settings.set_string('weather-motion', 'off');
        assert(scene.timer === 0, 'Off mode retained weather timer');
        this._settings.set_string('weather-motion', 'subtle');
        await delay(4300);
        assert(scene.timer === 0, 'Subtle weather did not settle');
        assert(scene.phase >= 4, 'Weather animation did not advance');
        console.log(`[Island Smoke] Weather frame: ${paintCount} frames, mean ${Math.round(paintTotalUs / paintCount)} us, max ${paintMaxUs} us (texture frame selection only)`);
        this._settings.set_string('weather-motion', 'live');
        this._settings.set_boolean('disable-animations', true);
        assert(scene.timer === 0, 'Reduced motion retained weather timer');
        this._settings.set_boolean('disable-animations', false);
        const scrollSpace = new St.Widget({height: 600});
        this._card._weatherView.hours[0].get_parent().get_parent().add_child(scrollSpace);
        await delay(100);
        scene.adjustment.value = scene.adjustment.upper - scene.adjustment.page_size;
        await delay(200);
        assert(scene.timer === 0, 'Scrolled-out weather retained animation timer');
        scene.adjustment.value = 0;
        await delay(200);
        assert(scene.timer !== 0, 'Scrolling back did not resume live weather');
        scrollSpace.destroy();
        this._settings.set_boolean('disable-animations', true);
        assert(this._card._weatherView.current.text.includes('18°C'), 'Weather data failed to render');
        await this._capture('weather');
        assert(this._card._weatherView.hours.every(h => h.visible), 'Forecast rows missing');
        this._settings.set_int('expanded-width', 380);
        await this._capture('weather-narrow');
        this._settings.set_int('expanded-width', 440);
        this._settings.set_string('weather-units', 'fahrenheit');
        assert(this._card._weatherView.current.text.includes('64°F'), 'Weather units did not update live');
        this._settings.set_string('weather-units', 'celsius');
        this._card.selectPage('system');
        assert(!this._weather.controller.timer && !this._weather.controller.active, 'Hidden Weather retained a timer');
        assert(scene.timer === 0, 'Hidden scene retained animation timer');
        this._settings.set_boolean('pill-show-weather', true);
        this._settings.set_boolean('pill-show-network', true);
        this._island.collapse();
        await delay(200);
        assert(this._pill._weather.visible && this._pill._network.visible, 'Notch indicators missing');
        assert(this._weather.controller.active && !scene.timer, 'Collapsed weather lifecycle incorrect');
        assert(this._pill.actor.accessible_name.includes(this._states.system.rx), 'Notch rates did not follow samples');
        this._settings.set_int('pill-width', 150);
        await this._capture('notch-indicators');
        const [pillX] = this._pill.actor.get_transformed_position();
        const [netX] = this._pill._network.get_transformed_position();
        assert(netX + this._pill._network.width <= pillX + this._pill.actor.width, 'Network indicator overflows notch');
        const [, netY] = this._pill._network.get_transformed_position();
        const [, pillY] = this._pill.actor.get_transformed_position();
        assert(netY + this._pill._network.height <= pillY + this._pill.actor.height, 'Network rates clipped vertically');
        this._settings.set_int('pill-width', 170);
        this._island.actor.hide();
        assert(!this._weather.controller.active, 'Hidden notch retained weather polling');
        this._island.actor.show();
        this._settings.set_boolean('pill-show-weather', false);
        this._settings.set_boolean('pill-show-network', false);
        assert(!this._pill._weather.visible && !this._pill._network.visible, 'Notch indicators did not hide live');
        assert(!this._weather.controller.active, 'Disabled indicator retained weather polling');
        this._island.expand();
        await delay(100);
        this._island.suspendGrab();
        assert(this._island.expanded && !this._island._grab, 'Preview retained the modal grab');
        for (const theme of ['ocean', 'forest', 'ember', 'graphite']) {
            this._settings.set_string('color-theme', theme);
            this._settings.set_int('surface-opacity', theme === 'graphite' ? 98 : 85);
            assert(this._island.actor.opacity === 255, 'Opacity faded text and controls');
            assert(this._card.actor.has_style_class_name(`ubuntu-island-theme-${theme}`), 'Theme did not apply live');
            await this._capture(`theme-${theme}`);
        }
        this._island.resumeGrab();
        assert(this._island.expanded && this._island._grab, 'Preview failed to restore dismissal');
        this._card.selectPage('media');
        await delay(100);
        let hiddenRepaints = 0;
        const chart = this._card._cpu.chart;
        const repaintSignal = chart.actor.connect('repaint', () => hiddenRepaints++);
        for (let i = 0; i < 100; i++) chart.push(25);
        await delay(100);
        assert(hiddenRepaints === 0, 'Hidden chart repainted');
        assert(chart.series[0].count === 60, 'History grew beyond its bound');
        chart.actor.disconnect(repaintSignal);

        // Exercise an actual GTK preferences window in this private compositor.
        const launch = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launch.set_environ(GLib.get_environ());
        launch.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
        launch.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
        launch.setenv('XDG_RUNTIME_DIR', GLib.getenv('XDG_RUNTIME_DIR'), true);
        launch.setenv('WAYLAND_DISPLAY', 'island-smoke', true);
        launch.setenv('GDK_BACKEND', 'wayland', true);
        launch.setenv('GTK_USE_PORTAL', '0', true);
        launch.setenv('ADW_DISABLE_PORTAL', '1', true);
        launch.setenv('GIO_USE_VFS', 'local', true);
        launch.setenv('GTK_A11Y', 'none', true);
        launch.setenv('GSETTINGS_BACKEND', 'memory', true);
        let process;
        this.openPreferences = () => {
            process = launch.spawnv(['gjs', '-m', `${this.path}/tests/preview-window.mjs`]);
        };
        this._openPreferencesLive();
        for (let i = 0; i < 30 && !this._prefsWindow; i++) await delay(200);
        assert(this._prefsWindow && this._island.expanded && !this._island._grab,
            `Preferences preview: tracked=${Boolean(this._prefsWindow)} expanded=${this._island.expanded} grab=${Boolean(this._island._grab)} windows=${global.get_window_actors().map(a => a.meta_window.get_title()).join(',')}`);
        await delay(600);
        await this._capture('preferences-tabs');
        this._openPreferencesLive();
        assert(this._prefsWindow, 'Raising preferences lost its close watcher');
        await new Promise((resolve, reject) => process.wait_check_async(null, (child, result) => {
            try { child.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
        }));
        await delay(150);
        assert(!this._prefsWatch && this._island.expanded && this._island._grab,
            'Closing preferences did not restore normal island interaction');
        this._settings.set_string('color-theme', 'graphite');
        this._settings.set_int('surface-opacity', 98);

        // Real pointer picking catches clipped or overlaid footer buttons.
        const pointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        for (let i = 0; i < 12; i++) {
            const page = i % 2 ? 'system' : 'audio';
            const tab = this._card._tabs.get(page);
            const [x, y] = tab.get_transformed_position();
            const [w, h] = tab.get_transformed_size();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + w / 2, y + h / 2);
            await delay(50);
            assert(tab.hover, `Tab hover lost on iteration ${i}`);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(50);
            assert(this._card._page === page, `Tab click lost on iteration ${i}`);
        }
        this._card.selectPage('media');
        const context = St.ThemeContext.get_for_stage(global.stage);
        const originalScale = context.scale_factor;
        context.scale_factor = 2;
        await delay(200);
        assert(this._island.actor.width === this._settings.get_int('expanded-width') * 2,
            'Surface does not follow CSS scaling');
        await this._capture('scaled');
        this._card.selectPage('system');
        await this._capture('scaled-system');
        this._checkNavigationAlignment();
        const [captionX, captionY] = this._card._iface.get_transformed_position();
        const [, captionHeight] = this._card._iface.get_transformed_size();
        const [, footerY] = this._card._tabs.get('system').get_parent().get_transformed_position();
        assert(captionY + captionHeight <= footerY, 'System history caption is clipped');
        this._card.selectPage('media');
        context.scale_factor = originalScale;
        await delay(200);

        this._island._onCapturedEvent(this._island.actor, {
            type: () => Clutter.EventType.BUTTON_PRESS,
            get_coords: () => [0, 850],
        });
        assert(this._island.state === 'collapsed' && !this._island._grab, 'Outside press retained input grab');
        for (let i = 0; i < 30; i++) this._island.toggle();
        assert(this._island.state === 'collapsed' && !this._island._grab, 'Rapid toggle retained input grab');

        this._settings.set_int('expanded-width', 380);
        this._card.selectPage('system');
        this._island.expand();
        await this._capture('narrow-system');
        this._checkNavigationAlignment();
        for (const metric of [this._card._cpu, this._card._ram]) {
            const title = metric.title;
            assert(!title.clutter_text.get_layout().is_ellipsized(), 'Metric heading was ellipsized');
        }
        const desktopText = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const oldTextScale = desktopText.get_double('text-scaling-factor');
        for (const scale of [1.25, 1.5]) {
            desktopText.set_double('text-scaling-factor', scale);
            await this._capture(`large-text-${scale}`);
            this._checkNavigationAlignment();
            for (const metric of [this._card._cpu, this._card._ram]) {
                const layout = metric.title.clutter_text.get_layout();
                assert(!layout.is_ellipsized(), 'Large metric heading was ellipsized');
                assert(!metric.value.clutter_text.get_layout().is_ellipsized(), 'Large metric percentage was ellipsized');
                const [left] = this._card.actor.get_transformed_position();
                const [valueX] = metric.value.get_transformed_position();
                const [valueWidth] = metric.value.get_transformed_size();
                assert(valueX + valueWidth < left + this._card.actor.width, 'Percentage overflowed the card');
                assert(layout.get_pixel_size()[0] <= metric.title.width + 1, 'Large metric heading was clipped');
            }
        }
        desktopText.set_double('text-scaling-factor', oldTextScale);
        for (const opacity of [0, 20, 50, 70, 100]) {
            this._settings.set_int('surface-opacity', opacity);
            await this._capture(`opacity-${opacity}`);
            const [, start, end] = this._island.actor.get_theme_node().get_background_gradient();
            assert(Math.abs(start.alpha - opacity * 255 / 100) <= 1, 'Rendered start alpha differs from opacity');
            assert(Math.abs(end.alpha - opacity * 255 / 100) <= 1, 'Rendered end alpha differs from opacity');
        }
        this._settings.set_int('surface-opacity', 98);
        this._card.selectPage('media');
        this._renderMedia({...media, title: 'A long track title that must ellipsize inside the narrow island without pushing controls away'});
        this._card.renderArt(cover);
        this._island.expand();
        await this._capture('narrow');

        this._renderMedia({available: false});
        assert(!this._card._mediaSection.box.visible, 'Media section failed to disappear');
        await this._capture('idle');
        this._island._onCapturedEvent(this._island.actor, {
            type: () => Clutter.EventType.KEY_PRESS, get_key_symbol: () => Clutter.KEY_Escape,
        });
        assert(this._island.state === 'collapsed' && !this._island._grab, 'Escape retained input grab');
        this._settings.set_boolean('disable-animations', false);
        for (let i = 0; i < 30; i++) this._island.toggle();
        await delay(500);
        assert(this._island.state === 'collapsed' && !this._island._grab,
            'Interrupted animations failed to settle');

        const saved = this._dateRestore;
        this.disable();
        if (saved) assert(saved.date.get_parent() === saved.center, 'Calendar parent was not restored');
        assert(!this._island && !this._progressTimer, 'Disable retained actors or progress timer');
        console.log('[Island Smoke] PASS: themes, opacity, bounded charts, hidden redraws, scaled layout, render, idle media, narrow layout, persistent rows, outside press, Escape, rapid toggle, disable');
    }
}
