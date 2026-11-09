import {formatTime} from './services/format.js';
import {roundedCover} from './services/artwork-model.js';
// Runs only in the temporary Shell created by tests/smoke.py.
import UbuntuIsland from './implementation.js';
import {ConnectivityService} from './services/connectivity.js';
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
        this.getSettings().set_boolean('enable-commute', true);
        this.getSettings().set_boolean('enable-agents', true);
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

    async _checkMediaFeatures(original, cover) {
        const card = this._card, actions = card._actions, tools = card._mediaTools;
        const saved = {...actions}, lyrics = this._lyrics;
        const textSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const textScale = textSettings.get_double('text-scaling-factor');
        const seeks = [], commands = [];
        let state = {...original, playerId: 'one', trackId: '/one', shuffle: false, loopStatus: 'None', canRaise: true,
            players: [{id: 'one', name: 'Music player', status: 'Playing'}, {id: 'two', name: 'Podcast player', status: 'Paused'}]};
        const render = () => {
            this._renderMedia(state);
            card.renderArt(cover);
        };
        actions.seek = seconds => { seeks.push(seconds); };
        actions.selectPlayer = id => { state = {...state, pinned: id}; render(); };
        actions.mediaProperty = (key, value) => { state = {...state, [key === 'Shuffle' ? 'shuffle' : 'loopStatus']: value}; render(); };
        actions.raisePlayer = () => commands.push('raise');
        actions.playTrack = id => commands.push(id);
        actions.setVolume = value => commands.push(value);
        this._lyrics = {load() { tools.renderLyrics({synced: true, lines: [
            {time: 0, text: 'A sample verse'}, {time: 60, text: 'A quiet place to begin'}, {time: 120, text: 'The next sample line'},
        ]}); }, cancel() {}};
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        try {
            render();
            await delay(100);
            const height = this._island.actor.height;
            const adjustment = card._scroll.vscroll.adjustment;
            assert(adjustment.upper <= adjustment.page_size + 1, 'Normal media scrolls');
            assert(card._cover.width === card._cover.height, 'Cover is not square');
            card._shuffle.emit('clicked', 1);
            card._repeat.emit('clicked', 1);
            assert(state.shuffle && state.loopStatus === 'Playlist', 'Shuffle/repeat controls failed');
            card._openPlayer.emit('clicked', 1);
            assert(commands.includes('raise'), 'Open player failed');
            await this._capture('media-modern');
            card._playerPicker.emit('clicked', 1);
            assert(!this._progressTimer, 'Player picker retained hidden playback updates');
            tools.playerRows.get('two').emit('clicked', 1);
            assert(state.pinned === 'two', 'Player pin failed');
            tools.playerRows.get('two').grab_key_focus();
            const focused = global.stage.get_key_focus();
            render();
            assert(global.stage.get_key_focus() === focused, 'Player update replaced focused control');
            await this._capture('media-players');
            tools.automatic.emit('clicked', 1);
            assert(!state.pinned, 'Automatic player selection failed');
            tools.show(null);
            card._soundButton.emit('clicked', 1);
            tools.volume.value = 0.42;
            assert(commands.includes(0.42), 'Quick volume failed');
            await this._capture('media-sound');
            tools.show(null);
            card._lyricsButton.emit('clicked', 1);
            tools.progress(72);
            assert(tools.lyricLines[1].text === 'A quiet place to begin', 'Synced lyric mismatch');
            await this._capture('media-lyrics');
            tools.lyricsToggle.emit('clicked', 1);
            assert(tools.fullLyrics.visible, 'Full lyrics unavailable');
            tools.show(null);
            card._queueButton.emit('clicked', 1);
            assert(!this._progressTimer, 'Queue retained hidden playback updates');
            tools.renderQueue({message: 'Player order', tracks: [{id: '/two', title: 'Next track', artist: 'Sample artist', canPlay: true}]});
            tools.queueRows.get('/two').emit('clicked', 1);
            assert(commands.includes('/two'), 'Queue playback failed');
            await this._capture('media-queue');
            tools.show(null);
            await delay(80);
            const slider = card._progressTrack;
            const [x, y] = slider.get_transformed_position(), [width, sliderHeight] = slider.get_transformed_size();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width * 0.25, y + sliderHeight / 2);
            await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            await delay(40);
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width * 0.6, y + sliderHeight / 2);
            await delay(50);
            assert(card._draggingProgress, 'Pointer did not begin seek drag');
            assert(card._elapsed.text === formatTime(slider.value * state.lengthSec), 'Time did not follow dragged thumb');
            card.renderProgress(12);
            assert(card._elapsed.text === formatTime(slider.value * state.lengthSec), 'Timer overwrote drag preview');
            assert(seeks.length === 0, 'Dragging flooded the player with seeks');
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(50);
            assert(seeks.length === 1, 'Release did not seek exactly once');
            card._seekBack.emit('clicked', 1);
            assert(seeks.length === 2, 'Ten-second seek failed');
            slider.emit('drag-begin');
            state = {...state, trackId: '/changed', positionSec: 0}; render();
            slider.value = 0.8;
            slider.emit('drag-end');
            assert(seeks.length === 2, 'Old drag sought in a new track');
            this._settings.set_int('expanded-width', 380);
            await delay(100);
            assert(adjustment.upper <= adjustment.page_size + 1, 'Narrow media scrolls');
            const right = this._island.actor.get_transformed_position()[0] + this._island.actor.width;
            for (const actor of [card._next, card._repeat, card._total, card._openPlayer])
                assert(actor.get_transformed_position()[0] + actor.width <= right, 'Media control overflows at 380px');
            await this._capture('media-modern-narrow');
            textSettings.set_double('text-scaling-factor', 1.25);
            for (const width of [440, 380]) {
                this._settings.set_int('expanded-width', width);
                await delay(100);
                assert(adjustment.upper <= adjustment.page_size + 1,
                    `Media scrolls at ${width}px with 125% text`);
            }
            await this._capture('media-modern-medium-text');
            textSettings.set_double('text-scaling-factor', 1.5);
            state = {...state, title: 'A much longer title that must fit with enlarged text', artist: 'A long artist name'}; render();
            await delay(100);
            assert(this._island.actor.height === height, 'Media text scaling changed tab height');
            assert(card._total.get_transformed_position()[0] + card._total.width <= right, 'Enlarged timeline overflows');
            await this._capture('media-modern-large-text');
            adjustment.value = adjustment.upper - adjustment.page_size;
            await this._capture('media-modern-large-text-scrolled');
            const footerTop = card._pageCaption.get_parent().get_transformed_position()[1];
            assert(card._openPlayer.get_transformed_position()[1] + card._openPlayer.height <= footerTop + 1, 'Enlarged controls are unreachable');
            textSettings.set_double('text-scaling-factor', textScale);
            this._settings.set_int('expanded-width', 440);
            for (const [opener, mode] of [[card._playerPicker, 'players'], [card._soundButton, 'sound'],
                [card._lyricsButton, 'lyrics'], [card._queueButton, 'queue']]) {
                opener.emit('clicked', 1);
                assert(tools.mode === mode, `Could not open ${mode}`);
                const tab = card._tabs.get('audio');
                tab.grab_key_focus();
                tab.emit('clicked', 1);
                assert(tools.mode === null && !tools.panel.visible, `Leaving Music retained ${mode}`);
                assert(global.stage.get_key_focus() === tab, 'Closing the media view stole tab focus');
                assert(!this._progressTimer, 'Leaving a secondary view retained the media clock');
                card._tabs.get('media').emit('clicked', 1);
                assert(tools.main.visible && !tools.panel.visible && this._progressTimer,
                    'Returning to Music did not restore playback');
            }
            state = {...state, shuffle: null, loopStatus: null, canRaise: false, canSeek: false}; render();
            assert(!card._shuffle.visible && !card._repeat.visible && !card._openPlayer.visible && !card._seekBack.visible,
                'Unsupported controls remain visible');
            this._card.selectPage('audio');
            assert(!this._progressTimer, 'Hidden media retained its UI timer');
            console.log('[Island Smoke] Media PASS: drag timestamps, release seek, track changes, controls, secondary views and sizes');
        } finally {
            textSettings.set_double('text-scaling-factor', textScale);
            this._settings.set_int('expanded-width', 440);
            tools.show(null);
            Object.assign(actions, saved);
            this._lyrics = lyrics;
            this._renderMedia(original);
            this._card.selectPage('media');
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), 50, 500);
            global.stage.set_key_focus(this._island.actor);
            await delay(80);
        }
    }

    async _smoke() {
        await delay(3500);
        Main.overview.hide();
        assert(this._states.agents?.connected, 'Local agent observer did not start in Shell');
        await this._agents.send({provider:'claude',session:'native-smoke',state:'input',label:'Native smoke'});
        const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        background.set_string('picture-options', 'none');
        background.set_string('primary-color', '#897c6c');
        this._system?.stop();
        this._media?.stop();
        this._audio?.stop();
        this._bluetooth?.stop();
        // Drive connection notifications without changing the host's networking.
        this._connectivity.stop();
        const connectionSignals = new Map();
        let nextConnectionId = 0;
        const network = {network_available: true, connectivity: Gio.NetworkConnectivity.FULL,
            connect: (_signal, callback) => { const id = ++nextConnectionId; connectionSignals.set(id, callback); return id; },
            disconnect: id => connectionSignals.delete(id)};
        const connect = (available, connectivity) => {
            network.network_available = available; network.connectivity = connectivity;
            for (const callback of connectionSignals.values()) callback();
        };
        this._connectivity = new ConnectivityService(state => this._renderConnectivity(state), network);
        this._connectivity.start();
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
        cover.set_data(roundedCover(pixels, 160, 160, 160 * 4, 4).data, Cogl.PixelFormat.RGBA_8888, 160, 160, 160 * 4);
        this._card.renderArt(cover);
        this._card._pillTitle.emit('clicked', 1);
        assert(!this._pill._title.visible && this._pill._mediaIcon.visible, 'Hide title removed the playback icon');
        await this._capture('hidden-title-pill');
        this._togglePillTitle();
        assert(this._pill._title.visible, 'Title did not return');
        await this._capture('playing-pill');
        const longTitle = 'A long music title that should scroll completely across the collapsed notch';
        this._renderMedia({...media, title: longTitle});
        this._settings.set_int('pill-title-characters', 5);
        assert(this._pill._title.text === 'A lon…', 'Fixed title ignored character threshold');
        this._settings.set_string('pill-title-mode', 'fit');
        await delay(100);
        const titleScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        assert(this._pill._mediaTitle.actor.width <= 240 * titleScale, 'Fit title exceeded its safe cap');
        assert(this._pill._title.text === longTitle, 'Fit title lost text');
        assert(this._island.actor.width >= this._pill._mediaTitle.desiredWidth + 26 * titleScale, 'Fit title did not grow the notch');
        assert(this._pill._mediaTitle.actor.width > 84 * titleScale, 'Fit title stayed at fixed width');
        await this._capture('fit-title-pill');
        this._settings.set_boolean('disable-animations', false);
        this._settings.set_string('pill-title-mode', 'scroll');
        await delay(1700);
        assert(this._pill._title.translation_x < 0, 'Overflowing title did not scroll');
        assert(this._pill._title.width > this._pill._mediaTitle.actor.width, 'Scrolling label was squeezed into its viewport');
        await this._capture('scroll-title-pill');
        const titleTransition = this._pill._title.get_transition('island-title-scroll');
        assert(titleTransition?.repeat_count === -1, 'Scrolling title did not use a repeating native transition');
        const titleDuration = titleTransition.duration;
        titleTransition.duration = 400;
        await delay(950);
        assert(titleTransition.is_playing(), 'Scrolling stopped after its first round trip');
        titleTransition.duration = titleDuration;
        this._island.expand(); await delay(300);
        assert(this._pill._title.translation_x === 0 && !this._pill._mediaTitle.animationKey, 'Expanded notch kept scrolling');
        this._island.collapse(); await delay(300);
        assert(Boolean(this._pill._mediaTitle.animationKey), 'Collapsed title did not resume');
        this._island.actor.hide();
        assert(!this._pill._mediaTitle.animationKey, 'Hidden notch kept scrolling');
        this._island.actor.show();
        this._settings.set_boolean('disable-animations', true);
        assert(!this._pill._mediaTitle.animationKey, 'Reduced motion kept scrolling');
        this._settings.set_string('pill-title-mode', 'fixed');
        this._settings.set_int('pill-title-characters', 12);
        this._renderMedia(media);

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
        await this._checkMediaFeatures(media, cover);
        this._settings.set_string('expand-tab', 'system');
        assert(this._card._page === 'media', 'Opening preference changed the already-open tab');
        this._island.collapse(); this._island.expand();
        assert(this._card._page === 'system', 'Fixed opening tab was not selected');
        this._card.selectPage('audio'); this._island.expand();
        assert(this._card._page === 'audio', 'Repeated expand reset a tab while already open');
        this._island.collapse(); this._island.expand();
        assert(this._card._page === 'system', 'Fixed tab did not apply on every opening');
        this._settings.set_string('expand-tab', 'last');
        this._card.selectPage('audio'); this._island.collapse(); this._island.expand();
        assert(this._card._page === 'audio', 'Last-used tab was not preserved');
        const commutePage = this._card._pages.get('commute');
        this._card._pages.delete('commute');
        this._settings.set_string('expand-tab', 'commute');
        this._island.collapse(); this._island.expand();
        assert(this._card._page === 'audio', 'Disabled preferred module did not preserve last tab');
        this._card._pages.set('commute', commutePage);
        this._settings.set_string('expand-tab', 'media');
        this._renderMedia({available: false});
        this._island.collapse(); this._island.expand();
        assert(this._card._page === 'audio', 'Unavailable media did not preserve last tab');
        this._settings.set_string('expand-tab', 'last');
        this._renderMedia(media); this._card.selectPage('media');
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
        const otherPageHeight = this._island.actor.height;
        this._card.selectPage('weather');
        await delay(100);
        assert(this._island.actor.height === otherPageHeight, 'Weather changed the island height');
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
        const [hasSize, atlasWidth, atlasHeight] = scene.image.get_content().get_preferred_size();
        assert(hasSize && atlasWidth === 1536 && atlasHeight === 1152,
            `Weather atlas was cropped: ${atlasWidth} × ${atlasHeight}`);
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
        const credit = this._card._weatherView.source;
        const creditBottom = credit.get_transformed_position()[1] + credit.get_transformed_size()[1];
        const scroll = this._card._scroll;
        assert(creditBottom <= scroll.get_transformed_position()[1] + scroll.get_transformed_size()[1], 'Weather credit is below the fold');
        assert(this._card._weatherView.hours.every(h => h.visible), 'Forecast rows missing');
        this._settings.set_int('expanded-width', 380);
        await this._capture('weather-narrow');
        this._settings.set_int('expanded-width', 440);
        this._settings.set_string('weather-units', 'fahrenheit');
        assert(this._card._weatherView.current.text.includes('64°F'), 'Weather units did not update live');
        this._settings.set_string('weather-units', 'celsius');
        let routeCalls = 0;
        this._commute.controller.keys = async () => ({});
        this._commute.http.get = async () => { routeCalls++; return {code: 'Ok', routes: [{duration: 1920, distance: 18400}]}; };
        this._settings.set_string('commute-routes', JSON.stringify([{id: 'test', name: 'Heading home', originMode: 'fixed', originName: 'Work', destinationName: 'Home', origin: {latitude: 35.72, longitude: 51.33}, destination: {latitude: 35.68, longitude: 51.39}}]));
        assert(routeCalls === 0, 'Hidden Commute fetched');
        const standardTabHeight = this._island.actor.height;
        const navigationTop = () => this._card._pageCaption.get_parent().get_transformed_position()[1];
        const standardNavigationTop = navigationTop();
        this._card.selectPage('commute');
        await delay(150);
        assert(this._card._commuteView.eta.text === '32' && this._card._commuteView.unit.text === 'min', 'Commute estimate failed to render');
        assert(this._card._commuteView.status.accessible_name.includes('Traffic freshness unverified'), 'Commute misrepresented traffic');
        assert(this._card._commuteView.name.get_parent().get_n_children() === 2, 'Redundant Commute heading controls remain');
        await this._capture('commute');
        const commute = this._card._commuteView;
        assert(this._island.actor.height === standardTabHeight, 'Commute height differs from the other tabs');
        assert(navigationTop() === standardNavigationTop, 'Switching to Commute moved navigation');
        const readyCommute = this._states.commute;
        for (const control of [commute.swap, commute.refresh]) {
            const [x, y] = control.get_transformed_position();
            assert(global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x + control.width / 2, y + control.height / 2) === control,
                'Scroll padding clipped a right-aligned Commute control');
        }
        const routePointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const clickRouteActor = async actor => {
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            routePointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
            await delay(30);
            routePointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
            await delay(30);
            routePointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
            await delay(80);
        };
        const openRoute = commute._openRoute;
        let routeOpens = 0;
        // Intercept the launch so native pointer testing never opens a browser.
        commute._openRoute = () => routeOpens++;
        try {
            commute.open.grab_key_focus();
            commute.render(readyCommute);
            assert(global.stage.key_focus === commute.open, 'Commute update lost keyboard focus');
            await clickRouteActor(commute.driving);
            await clickRouteActor(commute.eta);
            assert(routeOpens === 0, 'Car or ETA still acts as a hidden route button');
            await clickRouteActor(commute.open);
            assert(routeOpens === 1, 'Open route button did not activate');
            commute.render({...readyCommute, data: null, status: 'loading'});
            await delay(50);
            assert(commute.open.reactive, 'Fixed route should open even when ETA is unavailable');
            commute.render({...readyCommute, data: null, route: {...readyCommute.route, originMode: 'current'}, status: 'loading'});
            assert(!commute.open.reactive && !commute.open.can_focus, 'Missing current location left a route action enabled');
            await clickRouteActor(commute.open);
            assert(routeOpens === 1, 'Disabled Commute opened a route');
        } finally {
            commute._openRoute = openRoute;
            commute.render(readyCommute);
            this._island.actor.grab_key_focus();
            routePointer.notify_absolute_motion(GLib.get_monotonic_time(), 50, 500);
        }
        // Select sources through native controls and retain the reversed route.
        this._commute.availableProviders = ['balad', 'mapbox', 'fossgis', 'osrm'];
        this._commute.controller.keys = async () => ({mapbox: 'fixture-token'});
        this._commute.publish(this._commute.controller.state);
        await clickRouteActor(commute.provider);
        assert(commute.providerPanel.visible && !commute.main.visible, 'Provider picker did not open');
        await this._capture('commute-providers');
        this._commute.controller.lastAttempt = -Infinity;
        await clickRouteActor(commute.providerRows.get('balad'));
        assert(this._settings.get_string('commute-provider') === 'balad' && commute.main.visible, 'Balad selection failed');
        await this._capture('commute-selected-provider');
        this._commute.controller.lastAttempt = -Infinity;
        await clickRouteActor(commute.swap);
        assert(this._commute.reversed && this._states.commute.preferred === 'balad', `Reverse changed preferred source: reversed=${this._commute.reversed}, provider=${this._states.commute.preferred}, swap=${commute.swap.reactive}`);
        await clickRouteActor(commute.provider);
        this._commute.controller.lastAttempt = -Infinity;
        await clickRouteActor(commute.providerRows.get('mapbox'));
        assert(this._commute.reversed && this._states.commute.preferred === 'mapbox', 'Source selection reversed the journey');
        assert(this._commute.route.origin.latitude === readyCommute.route.destination.latitude, 'Wrong source coordinates after source selection');
        for (const [app, host] of [['google', 'www.google.com'], ['balad', 'balad.ir'], ['neshan', 'neshan.org']]) {
            this._settings.set_string('commute-open-with', app);
            assert(commute.openUrl.startsWith(`https://${host}/`), 'Open route setting did not apply live');
        }
        this._settings.set_string('commute-open-with', 'google');
        this._commute.swap();
        this._settings.set_string('commute-provider', 'auto');
        commute.render(readyCommute);
        this._island.actor.grab_key_focus();
        routePointer.notify_absolute_motion(GLib.get_monotonic_time(), 50, 500);
        await delay(80);
        assert(commute.feedback.get_theme_node().get_background_color().alpha === 0,
            'Commute traffic status has a surrounding box');
        const checkCommuteBounds = (withinViewport = true) => {
            const [left, top] = this._card._scroll.get_transformed_position();
            const [width, height] = this._card._scroll.get_transformed_size();
            if (withinViewport) {
                const adjustment = this._card._scroll.get_vscroll_bar().get_adjustment();
                assert(adjustment.upper - adjustment.lower <= adjustment.page_size + 1,
                    `Default Commute needs scrolling (${adjustment.upper - adjustment.lower} > ${adjustment.page_size})`);
            }
            for (const actor of [commute.eta, commute.unit, commute.arrival, commute.origin,
                commute.destination, commute.swap, commute.status, commute.freshness, commute.open, commute.credit, commute.provider]) {
                if (!actor.visible) continue;
                const [x, y] = actor.get_transformed_position();
                const [w, h] = actor.get_transformed_size();
                assert(x >= left && x + w <= left + width + 1,
                    `Commute content overflows horizontally: ${actor.get_style_class_name()} (${x}, ${w}) outside (${left}, ${width})`);
                if (withinViewport)
                    assert(y >= top && y + h <= top + height + 1, 'Commute content is below the fold');
            }
        };
        checkCommuteBounds();
        this._settings.set_int('expanded-width', 380);
        await this._capture('commute-narrow');
        checkCommuteBounds();
        const commuteText = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const originalCommuteText = commuteText.get_double('text-scaling-factor');
        commuteText.set_double('text-scaling-factor', 1.5);
        commute.render({...readyCommute, data: {...readyCommute.data, seconds: 10080 * 60},
            route: {...readyCommute.route, originName: 'A very long starting address in the city centre',
                destinationName: 'A very long destination name across the city'}});
        await this._capture('commute-large-text');
        checkCommuteBounds(false);
        assert(commute.summary.vertical, 'Long Commute estimate did not stack at enlarged text');
        assert(!commute.arrival.clutter_text.get_layout().is_ellipsized(), 'Commute arrival was truncated');
        assert(this._island.actor.height === standardTabHeight, 'Enlarged Commute resized the tabs');
        const largeTextNavigationTop = navigationTop();
        const commuteScroll = this._card._scroll.get_vscroll_bar().get_adjustment();
        commuteScroll.value = commuteScroll.upper - commuteScroll.page_size;
        await this._capture('commute-large-text-scrolled');
        assert(navigationTop() === largeTextNavigationTop, 'Scrolling Commute moved navigation');
        const creditEdge = commute.credit.get_transformed_position()[1] + commute.credit.get_transformed_size()[1];
        const viewportEdge = this._card._scroll.get_transformed_position()[1] + this._card._scroll.height;
        assert(creditEdge <= viewportEdge + 1, 'Commute attribution is unreachable when scrolled');
        commuteScroll.value = 0;
        commuteText.set_double('text-scaling-factor', originalCommuteText);
        this._settings.set_int('expanded-width', 440);
        commute.render({...readyCommute, status: 'loading'});
        assert(!commute.refresh.reactive && commute.status.text.includes('Updating'), 'Commute loading state missing');
        await this._capture('commute-loading');
        commute.render({...readyCommute, status: 'error', stale: true,
            error: 'Routing is unavailable. Check your connection and try again.',
            data: {...readyCommute.data, updatedAt: Date.now() - 30 * 60000}});
        await this._capture('commute-stale');
        assert(commute.status.text.includes('Saved estimate') && commute.open.reactive, 'Stale commute lost its estimate or route action');
        checkCommuteBounds(false);
        assert(this._island.actor.height === standardTabHeight, 'Commute error resized the tabs');
        commute.render({});
        await this._capture('commute-empty');
        assert(commute.configure.visible && commute.configure.reactive && !commute.summary.visible,
            'Empty Commute has no setup action');
        commute.render(readyCommute);
        const fixedRoute = JSON.parse(this._settings.get_string('commute-routes'))[0];
        this._commute.controller.locate = async () => { throw Object.assign(new Error('Location Services are off.'), {code: 'location-disabled'}); };
        this._commute.controller.lastAttempt = -Infinity;
        this._settings.set_string('commute-routes', JSON.stringify([{...fixedRoute, name: '', originMode: 'current'}]));
        await delay(80);
        assert(this._card._commuteView.name.text === 'Work → Home', 'Unnamed route title missing');
        assert(this._card._commuteView.savedStart.visible, 'Location failure has no recovery action');
        assert(!commute.open.reactive, 'Location failure left the route action enabled');
        assert(this._card._commuteView.status.text === 'Location Services are off.', 'Location error is unclear');
        await this._capture('commute-location-off');
        this._commute.controller.lastAttempt = -Infinity;
        this._card._commuteView.savedStart.emit('clicked', 1);
        await delay(1300);
        assert(this._commute.route.originMode === 'fixed' && this._card._commuteView.eta.text === '32', 'Saved-start recovery failed');
        assert(!this._card._commuteView.savedStart.visible, 'Recovery action still shown after success');
        this._card.selectPage('system');
        assert(!this._commute.controller.active && !this._commute.controller.timer, 'Hidden Commute retained timer');
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
        this._settings.set_strv('pill-order', ['weather', 'network', 'media', 'cpu', 'bluetooth']);
        await this._capture('notch-indicators');
        assert(this._pill.actor.get_child().get_first_child() === this._pill._weather, 'Notch order did not update live');
        this._settings.set_boolean('pill-show-title', false);
        await this._capture('notch-icons');
        const requestsBeforeNotch = routeCalls;
        this._settings.set_boolean('pill-show-commute', true);
        await delay(120);
        assert(this._pill._commute.visible && this._pill._commuteValue.text === '~32m', 'Commute notch did not show selected estimate');
        assert(this._commute.controller.active && this._commute.controller.timer, 'Commute notch did not resume refresh');
        assert(routeCalls === requestsBeforeNotch, 'Fresh Commute cache fetched again for notch');
        assert(this._pill.actor.accessible_name.includes('traffic freshness unverified'), 'Commute notch omitted traffic limitation');
        await this._capture('notch-commute');
        const onlineSystem = this._states.system;
        const onlineWeather = this._states.weather;
        const onlineCommute = this._states.commute;
        const connectionBounds = () => {
            const indicator = this._pill._connection;
            const [x, y] = indicator.get_transformed_position();
            const [px, py] = this._pill.actor.get_transformed_position();
            assert(x >= px && x + indicator.width <= px + this._pill.actor.width + 1, 'Connection icon clips horizontally');
            assert(y >= py && y + indicator.height <= py + this._pill.actor.height + 1, 'Connection icon clips vertically');
            assert(indicator.get_n_children() === 1 && indicator.get_first_child() instanceof St.Icon, 'Connection indicator contains visible text');
            assert(indicator.get_theme_node().get_background_color().alpha === 0, 'Connection indicator retained its badge background');
        };
        const edgeBounds = () => {
            const edge = this._island._connectionEdge;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const [x, y] = edge.get_transformed_position();
            const [sx, sy] = this._island.actor.get_transformed_position();
            assert(Math.abs(x + edge.width / 2 - sx - this._island.actor.width / 2) < 1, 'Broken edge is not centered');
            assert(y + edge.height <= sy + this._island.actor.height, 'Broken edge escapes the surface');
            assert(y >= sy + this._island.actor.height - 6 * scale, 'Broken edge is not at the bottom');
            const [left, right] = edge.get_children();
            assert(right.x - left.x - left.width >= 8 * scale - 1, 'Broken edge lost its gap');
            assert(left.height === 2 * scale && right.height === 2 * scale, 'Broken edge did not follow CSS scale');
        };
        for (const mode of ['icon', 'edge']) {
            this._settings.set_string('pill-offline-mode', mode);
            for (const [available, state, name, description] of [
                [false, Gio.NetworkConnectivity.LOCAL, 'offline', 'Offline'],
                [true, Gio.NetworkConnectivity.LIMITED, 'no-internet', 'without full internet'],
                [true, Gio.NetworkConnectivity.PORTAL, 'sign-in', 'sign-in required'],
            ]) {
                connect(available, state);
                await this._capture(`notch-${mode}-${name}`);
                assert(this._pill._connection.visible, 'Disconnected icon missing');
                assert(!this._pill._weather.visible && !this._pill._network.visible && !this._pill._commute.visible, 'Offline style left dependent indicators visible');
                assert(this._pill._mediaIcon.visible && this._pill._bluetooth.visible && this._pill._cpuDot.visible, 'Offline mode hid local indicators');
                assert(this._pill.actor.get_child().get_first_child() === this._pill._connection, 'Connection icon lost indicator order');
                assert(this._pill.actor.accessible_name.includes(description), 'Connection status has no accessible description');
                assert(this._island._connectionEdge.visible === (mode === 'edge'), 'Offline edge does not follow selected mode');
                connectionBounds();
                if (mode === 'edge') edgeBounds();
            }
            const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            const initialTextScale = interfaceSettings.get_double('text-scaling-factor');
            interfaceSettings.set_double('text-scaling-factor', 1.5);
            await this._capture(`notch-${mode}-large-text`);
            connectionBounds();
            interfaceSettings.set_double('text-scaling-factor', initialTextScale);
            this._island.expand();
            assert(!this._island._connectionEdge.visible, 'Expanded card retained offline edge');
            this._island.collapse();
            assert(this._island._connectionEdge.visible === (mode === 'edge'), 'Collapse did not restore edge mode');
            connect(true, Gio.NetworkConnectivity.FULL);
            assert(!this._pill._connection.visible && !this._island._connectionEdge.visible, 'Reconnection retained offline decoration');
        }
        this._settings.set_string('pill-offline-mode', 'edge');
        connect(false, Gio.NetworkConnectivity.LOCAL);
        const offlineContext = St.ThemeContext.get_for_stage(global.stage);
        const offlineScale = offlineContext.scale_factor;
        offlineContext.scale_factor = 2;
        await this._capture('notch-edge-scaled');
        connectionBounds();
        edgeBounds();
        offlineContext.scale_factor = offlineScale;
        this._settings.set_string('pill-offline-mode', 'hide');
        await delay(60);
        assert(!this._pill._connection.visible && !this._island._connectionEdge.visible && !this._pill._network.visible, 'Hide mode retained a connection icon or disconnected rates');
        assert(this._pill._weather.visible && this._pill._commute.visible, 'Hide mode removed fresh cached data');
        this._states.weather = {...onlineWeather, stale: true};
        this._states.commute = {...onlineCommute, stale: true};
        this._renderPill();
        await this._capture('notch-offline-hidden');
        assert(!this._pill._weather.visible && !this._pill._commute.visible, 'Hide mode retained stale indicators');
        this._states.weather = {...onlineWeather, data: null};
        this._states.commute = {...onlineCommute, data: null};
        this._renderSystem({...onlineSystem, iface: 'No default route', rx: '—', tx: '—', rxBytes: null, txBytes: null});
        assert(!this._pill._weather.visible && !this._pill._network.visible && !this._pill._commute.visible, 'Hide mode retained missing values');
        this._settings.set_string('pill-offline-mode', 'icon');
        assert(this._pill._connection.visible, 'Changing offline mode did not apply immediately');
        this._states.weather = onlineWeather;
        this._states.commute = onlineCommute;
        this._renderSystem(onlineSystem);
        connect(true, Gio.NetworkConnectivity.FULL);
        await delay(80);
        assert(!this._pill._connection.visible && this._pill._weather.visible && this._pill._network.visible && this._pill._commute.visible,
            'Reconnection did not restore indicators');
        // Weather-only and Commute-only configurations still show the connection icon.
        this._settings.set_boolean('pill-show-network', false);
        this._settings.set_boolean('pill-show-weather', false);
        connect(false, Gio.NetworkConnectivity.LOCAL);
        assert(this._pill._connection.visible, 'Commute-only offline icon missing');
        this._settings.set_boolean('pill-show-commute', false);
        assert(!this._pill._connection.visible, 'Connection icon appeared with no dependent indicators enabled');
        this._settings.set_boolean('pill-show-weather', true);
        assert(this._pill._connection.visible, 'Weather-only offline icon missing');
        connect(true, Gio.NetworkConnectivity.FULL);
        this._settings.set_boolean('pill-show-network', true);
        this._settings.set_boolean('pill-show-commute', true);
        this._island.actor.hide();
        assert(!this._commute.controller.active && !this._commute.controller.timer, 'Hidden notch kept Commute active');
        this._island.actor.show();
        this._settings.set_boolean('pill-show-commute', false);
        assert(!this._pill._commute.visible && !this._commute.controller.timer, 'Disabled Commute notch retained timer');
        for (const shape of ['classic', 'chevron']) {
            this._settings.set_string('pill-arrow-style', shape);
            await delay(70);
            assert(this._pill._arrowStyle === `${shape}:80`, 'Arrow style did not update live');
            await this._capture(`notch-${shape}`);
        }
        for (const angle of [40, 95, 120]) {
            this._settings.set_int('pill-arrow-angle', angle);
            await delay(60);
            assert(this._pill._arrowStyle === `chevron:${angle}`, 'Arrow angle did not update live');
            await this._capture(`notch-angle-${angle}`);
        }
        this._settings.set_int('pill-arrow-angle', 80);
        this._states.weather.data.current.isDay = false;
        this._renderPill(); await this._capture('notch-clouds-night');
        this._states.weather.data.current.isDay = true;
        this._renderPill();
        this._settings.set_string('pill-weather-style', 'minimal');
        await delay(70);
        assert(this._pill._weather.icon_size === 14 && this._pill._weather.icon_name.includes('symbolic'), 'Minimal weather style missing');
        await this._capture('notch-minimal-weather');
        this._settings.set_string('pill-weather-style', 'colorful');
        assert(this._pill._weather.icon_size === 20, 'Colorful weather style did not restore');
        this._settings.set_boolean('pill-show-title', true);
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
        const agentSession = this._states.agents.sessions[0];
        const targetWindow = this._prefsWindow;
        assert(agentSession?.state === 'input', 'Native agent event did not reach Shell');
        this._island.resumeGrab();
        assert(this._island._grab, 'Agent focus check needs a real modal grab');
        this._activateAgent(agentSession, targetWindow);
        await delay(350);
        const focused = global.display.focus_window;
        assert(!this._island.expanded && !this._island._grab &&
            (focused === targetWindow || focused?.get_transient_for() === targetWindow),
        `Agent focus failed: expanded=${this._island.expanded} grab=${Boolean(this._island._grab)} focused=${focused?.get_title()}`);
        this._island.expand(); this._island.suspendGrab();
        await delay(1600);
        await this._capture('commute-map');
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

        // Exercise a real outside press/release, not just the dismissal callback.
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 50, 850);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(250);
        assert(!this._island.expanded && !this._island._grab, 'Real outside click did not dismiss');
        const [reopenX, reopenY] = this._pill.actor.get_transformed_position();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), reopenX + this._pill.actor.width / 2, reopenY + 12);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(250);
        assert(this._island.expanded, 'Real notch click could not reopen after outside dismissal');
        // Escape must also dismiss outside key dispatch, and the notch must
        // still reopen with a real pointer click afterwards.
        this._island._onCapturedEvent(this._island.actor, {
            type: () => Clutter.EventType.KEY_PRESS,
            get_key_symbol: () => Clutter.KEY_Escape,
        });
        await delay(50);
        assert(!this._island.expanded && !this._island._grab, 'Escape did not dismiss');
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), reopenX + this._pill.actor.width / 2, reopenY + 12);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(50);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(250);
        assert(this._island.expanded, 'Real notch click could not reopen after Escape dismissal');
        // The guard holds the grab through a pending dismissing press; the
        // matching release completes the dismissal.
        this._island._onCapturedEvent(this._island.actor, {
            type: () => Clutter.EventType.BUTTON_PRESS,
            get_coords: () => [0, 850],
        });
        assert(this._island.expanded && this._island._grab, 'Guard dropped the grab mid-press');
        this._island._onCapturedEvent(this._island.actor, {
            type: () => Clutter.EventType.BUTTON_RELEASE,
            get_coords: () => [0, 850],
        });
        await delay(50);
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
        await delay(50);
        assert(this._island.state === 'collapsed' && !this._island._grab, 'Escape retained input grab');
        this._settings.set_boolean('disable-animations', false);
        for (let i = 0; i < 30; i++) this._island.toggle();
        await delay(500);
        assert(this._island.state === 'collapsed' && !this._island._grab,
            'Interrupted animations failed to settle');

        const saved = this._dateRestore;
        const agentWindows = this._agentWindows;
        this.disable();
        assert(agentWindows.windows.size === 0 && !agentWindows.created && !this._agents && !this._agentFocus,
            'Disable retained agent state or window signals');
        assert(connectionSignals.size === 0, 'Disable retained connection notifications');
        if (saved) assert(saved.date.get_parent() === saved.center, 'Calendar parent was not restored');
        assert(!this._island && !this._progressTimer, 'Disable retained actors or progress timer');
        console.log('[Island Smoke] PASS: themes, opacity, bounded charts, hidden redraws, scaled layout, render, idle media, narrow layout, persistent rows, outside press, Escape, rapid toggle, disable');
    }
}
