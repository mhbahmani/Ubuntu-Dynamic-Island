// Development-only wrapper; never packaged or installed.
import UbuntuIsland from './implementation.js';
import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {localTime} from './services/weather-model.js';
import {sampleDevices, sampleAgents} from './preview-data.js';

export default class Preview extends UbuntuIsland {
    enable() {
        this._previewConfigured = false;
        const settings = this.getSettings();
        // Setup buttons in the preview must never modify real CLI configuration.
        for (const provider of ['claude', 'codex', 'opencode'])
            settings.set_string(`agents-${provider}-config`, `${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/agent-configs/${provider}`);
        for (const module of ['media', 'metrics', 'audio', 'bluetooth', 'weather', 'commute', 'agents'])
            settings.set_boolean(`enable-${module}`, true);
        for (const indicator of ['title', 'weather', 'network', 'commute', 'agents'])
            settings.set_boolean(`pill-show-${indicator}`, true);
        settings.set_string('pill-offline-mode', GLib.getenv('ISLAND_PREVIEW_OFFLINE_STYLE') || 'icon');
        settings.set_string('commute-routes', JSON.stringify([{id: 'sample', name: 'Heading home (sample)', originMode: 'fixed', originName: 'Work', destinationName: 'Home', origin: {latitude: 35.7219, longitude: 51.3347}, destination: {latitude: 35.6892, longitude: 51.389}}]));
        settings.set_string('commute-selected', 'sample');
        settings.set_string('weather-motion', GLib.getenv('ISLAND_PREVIEW_MOTION') || 'live');
        settings.set_string('weather-location', JSON.stringify({name: GLib.getenv('ISLAND_PREVIEW_LIVE') === '1' ? 'Tehran, Iran' : 'Tehran, Iran (sample)',
            latitude: 35.6892, longitude: 51.389, timezone: 'Asia/Tehran'}));
        super.enable();
        // Keep provider controllers inactive until the sample adapters are ready.
        this._weather.setActive(false);
        this._commute.setActive(false);
        const sample = GLib.getenv('ISLAND_PREVIEW_LIVE') !== '1';
        sampleDevices(this, sample);
        sampleAgents(this);
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
            if (tab === 'notch') this._island.collapse();
            else this._island.expand();
            if (GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1') this._openPreferencesLive('commute');
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_INPUT') === '1') this._checkInput().catch(error => console.error(`[Island Preview] INPUT FAIL: ${error.message}`));
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_FULL') === '1') this._checkFullPreview().catch(error => console.error(`[Island Preview] FULL FAIL: ${error.message}`));
            console.log(`[Island Preview] READY: All modules enabled; ${tab === 'notch' ? 'collapsed notch' : tab} visible. Device controls use sample data.`);
            if (GLib.getenv('ISLAND_PREVIEW_CHECK_FULL') === '1') return GLib.SOURCE_REMOVE;
            this._captureTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GLib.getenv('ISLAND_PREVIEW_LIVE') === '1' ? 20000 : GLib.getenv('ISLAND_PREVIEW_EDIT_ROUTE') === '1' ? 8000 : 1500, () => {
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
        for (const tab of ['media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents']) {
            assert(this._card._pages.get(tab)?.available, `${tab} module unavailable`);
            this._card.selectPage(tab);
            this._island.expand();
            await delay(400);
            await this._capture(`preview-${tab}`);
        }
        this._media.command('PlayPause');
        assert(this._states.media.status === 'Paused', 'Sample playback control failed');
        this._media.command('PlayPause');
        this._audio.setVolume(0.35);
        assert(this._states.audio.volume === 0.35, 'Sample volume control failed');
        this._audio.selectOutput(2);
        assert(this._states.audio.outputs[1].active, 'Sample output control failed');
        this._bluetooth.toggle(this._states.bluetooth.devices[1]);
        assert(this._states.bluetooth.devices[1].connected, 'Sample Bluetooth control failed');
        await this._checkAgents();
        this._card.selectPage('media');
        this._island.collapse();
        await delay(400);
        await this._capture('notch');
        console.log('[Island Preview] FULL PASS: populated notch, all seven tabs, sample controls and Agents interactions');
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
        const first = [...view.rows.values()][0];
        assert(!view.recentList.visible && view.recentButton.visible, 'Recent sessions are not collapsed');
        const order = view.activeList.get_children();
        await click(first.open);
        assert(view.mode === 'windows', 'Clicking a session did not open its window chooser');
        assert(this._island._onEscape() && view.mode === 'list', 'Escape did not return from the chooser');
        const updated = {...initial, sessions:initial.sessions.map((s,i) => i ? s : {...s,state:'working'})};
        first.open.grab_key_focus();
        this._renderAgents(updated);
        assert([...view.rows.values()][0] === first && first.open.has_key_focus(), 'Status update replaced a row or stole focus');
        assert(view.activeList.get_children().every((actor,i)=>actor === order[i]), 'Status update reordered click targets');
        const motionBefore = this._settings.get_boolean('disable-animations');
        this._settings.set_boolean('disable-animations', true);
        assert(!view.activity.get_transition('agent-working'), 'Reduced motion retained an animation');
        this._settings.set_boolean('disable-animations', false);
        if (view.stSettings.enable_animations) assert(view.activity.get_transition('agent-working'), 'Visible working indicator did not animate');
        this._card.selectPage('media');
        await delay(100);
        assert(!view.activity.get_transition('agent-working'), 'Hidden Agents view retained its animation');
        const text = first.status.text;
        this._renderAgents(initial);
        assert(first.status.text === text, 'Hidden session view repainted');
        this._card.selectPage('agents');
        await delay(150);
        assert(first.status.text.includes('Needs approval'), 'Remapped view did not catch up');
        await click(view.askButton);
        assert(view.mode === 'ask' && view.prompt.clutter_text.has_key_focus(), 'Quick Ask pointer click failed');
        assert(!view.activity.get_transition('agent-working'), 'Composer retained the list animation');
        view.prompt.text = 'A sample multiline request\nKeep this as one prompt.';
        this._island._onEscape();
        assert(view.mode === 'list' && view.prompt.text.includes('multiline'), 'Escape discarded a draft');
        await click(view.askButton);
        await click(view.providerButton);
        await click(view.options.get_children()[1]);
        assert(view.provider === 'codex', 'Agent picker did not select Codex');
        await click(view.destinationButton);
        await click(view.options.get_children()[2]);
        assert(view.destination === 'desktop' && !view.folder.visible, 'Desktop destination did not update');
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
        assert(this._island.actor.height === height, 'Text scaling changed card height');
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
        assert(view.footer.get_transformed_position()[1] + view.footer.height <= this._card._tabs.get('agents').get_parent().get_transformed_position()[1], 'Agents footer overlaps navigation at 200%');
        await this._capture('agents-scaled');
        context.scale_factor = originalScale;
        await delay(200);
        view.destination = 'terminal'; view.folder.text = '/tmp'; view.prompt.text = 'Remember this project';
        await click(view.askButton);
        await click(view.submit);
        assert(this._settings.get_string('agents-project') === '/tmp', 'Successful launch did not remember the project');
        // Launch a real GTK window inside this private session and bind it explicitly.
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
        assert(view.mode === 'windows', 'Unbound session did not show a chooser');
        this._activateAgent(first.session,window);
        await delay(500);
        assert((global.display.focus_window === window || global.display.focus_window?.get_transient_for() === window) && !this._island.expanded, `Selected window did not receive focus: focused=${global.display.focus_window?.get_title()}, expanded=${this._island.expanded}, message=${view.message.text}`);
        assert(this._agentWindows.candidates(first.session)[0] === window, 'Window binding was not retained');
        window.delete(global.get_current_time());
        await delay(300);
        assert(!this._agentWindows.bindings.has(first.session.id), 'Closed window binding leaked');
        view.show('list');
        this._island.expand();
        await delay(200);
        await click(first.menu);
        await click(view.options.get_children()[3]);
        assert(view.rows.size === 2, 'Dismiss did not update the list');
        const latest = {...first.session, state:'input', start:true};
        await this._agents.send(latest);
        assert(view.rows.size === 2 && view.undoRow.visible, 'Hidden event resurfaced a row or lost Undo');
        await click(view.undoButton);
        assert(view.rows.size === 3 && view.rows.get(first.session.id).session.state === 'input', 'Undo restored stale status');
        await click(view.menuButton);
        await click(view.options.get_first_child());
        assert(view.rows.size === 2 && [...view.rows.values()].every(item=>!['finished','closed'].includes(item.session.state)), 'Clear finished affected active work');
        await click(view.undoButton);
        assert(view.rows.size === 3, 'Clear finished could not be undone');
        this._settings.set_boolean('disable-animations', motionBefore);
        await this._agents.send({control:'clear'});
        assert(view.rows.size === 0, 'Clear did not update the list');
        sampleAgents(this);
        console.log('[Island Preview] AGENTS PASS: rows, menus, draft/errors, Undo with live events, motion cleanup, narrow/scaled layout and window activation');
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
