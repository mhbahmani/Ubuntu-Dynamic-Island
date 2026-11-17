import {formatTime} from './services/format.js';
import {roundedCover} from './services/artwork-model.js';
import {THEME_IDS} from './services/themes.js';
import {formatRate} from './services/proc.js';
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
// Before pressing a just-registered shortcut. Adding a binding makes Mutter
// rebuild its binding table; under load, a virtual chord injected before the
// queued rebuild and layout work run never reaches the handler. A low-priority
// idle turn runs only after that higher-priority pending work.
const settle = async () => {
    await delay(100);
    await new Promise(resolve => GLib.idle_add(GLib.PRIORITY_LOW, () => { resolve(); return GLib.SOURCE_REMOVE; }));
};

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

    async _checkTitleTrimming(media) {
        const settings = this._settings, pill = this._pill;
        const context = St.ThemeContext.get_for_stage(global.stage);
        const fonts = Clutter.Settings.get_default();
        const keys = ['pill-title-mode', 'pill-title-characters', 'pill-text-scale',
            'pill-show-network', 'pill-show-date', 'pill-show-time', 'pill-show-commute',
            'pill-show-notifications'];
        const saved = keys.map(key => [key, settings.get_value(key)]);
        const original = {scale: context.scale_factor, dpi: fonts.font_dpi,
            states: {...this._states}, event: this._eventIndicator};
        try {
            settings.set_string('pill-title-mode', 'fixed');
            this._states.commute = {route: {name: 'Work'}, data: {seconds: 1620}};
            this._states.notifications = {unseen: 11};
            for (const scale of [1, 2]) for (const text of [100, 150]) {
                context.scale_factor = scale;
                // No settings daemon forwards font DPI in the private Shell.
                fonts.font_dpi = 96 * 1024 * scale;
                settings.set_int('pill-text-scale', text);
                // Dense at 100%; leave room for the enlarged title on the
                // headless monitor's fixed 1280 physical pixels at 200%.
                settings.set_boolean('pill-show-date', scale === 1);
                settings.set_boolean('pill-show-network', scale === 1);
                settings.set_boolean('pill-show-time', scale === 1);
                settings.set_boolean('pill-show-commute', scale === 1);
                settings.set_boolean('pill-show-notifications', scale === 1);
                for (const [limit, title] of [[17, 'Stay (with Justin Bieber)'], [5, 'WWWWWWWW'], [40, 'i'.repeat(50)]]) {
                    settings.set_int('pill-title-characters', limit);
                    let width;
                    for (const event of [null, {text: 'Event in 15 min'}, null]) {
                        this._eventIndicator = event;
                        this._renderMedia({...media, title});
                        await settle();
                        const measured = pill._title.clutter_text.get_preferred_width(-1)[1];
                        assert(Math.abs(pill._mediaTitle.actor.width - measured) < 1 &&
                            !pill._title.clutter_text.get_layout().is_ellipsized(),
                        `Trim added a second ellipsis: limit=${limit} scale=${scale} text=${text} event=${Boolean(event)} ` +
                            `width=${pill._mediaTitle.actor.width} measured=${measured}`);
                        if (width !== undefined)
                            assert(pill._mediaTitle.actor.width === width, 'Upcoming event changed the title limit');
                        width = pill._mediaTitle.actor.width;
                        assert(this._island.actor.width <= Main.layoutManager.primaryMonitor.width,
                            'Trim title pushed the notch off screen');
                    }
                }
                await this._capture(`trim-dense-${scale}-${text}`);
            }
            console.log('[Island Smoke] Title trim PASS: measured characters, dense indicators, event changes, scale and enlarged text');
        } finally {
            context.scale_factor = original.scale;
            fonts.font_dpi = original.dpi;
            this._states = original.states;
            this._eventIndicator = original.event;
            for (const [key, value] of saved) settings.set_value(key, value);
            this._renderMedia(media);
            await settle();
        }
    }

    _checkNavigationAlignment() {
        const center = actor => actor.get_transformed_position()[1] + actor.get_transformed_size()[1] / 2;
        const caption = this._card._pageCaption;
        const expected = center(caption.visible ? caption : this._card._preferencesButton.child);
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

    async _checkTabSlider() {
        const card = this._card, slider = card._tabSlider;
        const page = card._page;
        const centreX = actor => actor.get_transformed_position()[0] + actor.get_transformed_size()[0] / 2;
        const onTab = id => Math.abs(centreX(slider) - centreX(card._tabs.get(id))) <= 1;
        const reducedMotion = this._settings.get_boolean('disable-animations');
        this._settings.set_boolean('disable-animations', false);
        try {
            const duration = Math.round(0.75 * Math.max(0, Math.min(500, this._settings.get_int('animation-duration'))));
            card.selectPage('system');
            card.selectPage('audio');
            if (duration > 0 && St.Settings.get().enable_animations)
                assert(slider.get_transition('translation-x'), 'Tab slider did not glide between tabs');
            const box = id => card._pages.get(id).box;
            if (duration > 0 && St.Settings.get().enable_animations) {
                assert(box('audio').get_transition('opacity') && box('audio').translation_x > 0,
                    'Incoming page did not enter from the selected tab side');
                assert(!box('system').visible && box('system').opacity === 255 && box('system').translation_x === 0,
                    'Interrupted page kept its transition pose');
            }
            await delay(duration + 150);
            assert(card._page === 'audio' && slider.opacity === 255 && onTab('audio'),
                'Tab slider did not settle under the selected tab');
            assert(box('audio').opacity === 255 && box('audio').translation_x === 0 && !card._revealing,
                'Page transition did not settle');
            // Only the slider marks the selected tab: a focused selected tab's
            // own marker would appear before the slider arrives. Other focused
            // tabs keep their keyboard marker.
            const markerAlpha = id => card._tabMarkers.get(id).get_theme_node().get_background_color().alpha;
            card._tabs.get('audio').grab_key_focus();
            assert(markerAlpha('audio') === 0, 'Focused selected tab showed its own marker');
            card._tabs.get('system').grab_key_focus();
            assert(markerAlpha('system') > 0, 'Focused unselected tab lost its keyboard marker');
            this._settings.set_boolean('disable-animations', true);
            card.selectPage('system');
            assert(!slider.get_transition('translation-x') && onTab('system'),
                'Reduced motion did not place the tab slider immediately');
            assert(!box('system').get_transition('opacity') && box('system').opacity === 255 && box('system').translation_x === 0,
                'Reduced motion still animated the page');
            console.log('[Island Smoke] Tab slider PASS: glide, page transition, slider-only selection marker, settle and reduced-motion snap');
        } finally {
            card.selectPage(page);
            this._settings.set_boolean('disable-animations', reducedMotion);
        }
    }

    async _checkNetworkWidths() {
        const pill = this._pill, state = this._states.system;
        const context = St.ThemeContext.get_for_stage(global.stage);
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const original = {scale:context.scale_factor, text:text.get_double('text-scaling-factor')};
        const rates = [[0, '0B'], [999.4 * 1024, '999K'], [1000.3 * 1024, '1.0M'],
            [120 * 1024 ** 2, '120M'], [1024 ** 3, '1.0G'], [999 * 1024 ** 3, '999G'], [888, '888B']];
        const render = (rxBytes, txBytes) => this._renderSystem({...state, rxBytes, txBytes,
            rx:formatRate(rxBytes), tx:formatRate(txBytes)});
        assert(!this._island.expanded && pill._network.visible, 'Rate sizing needs a visible collapsed notch');
        try {
            for (const layout of ['inline', 'stacked']) for (const scale of [1, 2]) for (const textScale of [1, 1.5]) {
                this._settings.set_string('pill-network-layout', layout);
                context.scale_factor = scale;
                // Manually changing the headless St scale does not update
                // font DPI as a real HiDPI monitor does. Scale text too, so
                // the 200% case exercises doubled glyphs as well as geometry.
                text.set_double('text-scaling-factor', textScale * scale);
                render(0, 0);
                await delay(200);
                // Font and St scale notifications can settle in separate
                // frames, especially with more hidden actors. Establish the
                // baseline after layout stops changing; traffic below must
                // still preserve it exactly (no waiting for a new baseline).
                let previous = '', stable = 0;
                for (let attempt = 0; attempt < 12 && stable < 3; attempt++) {
                    const current = [this._island.actor.width, pill.actor.width,
                        pill._network.width, pill._down.width, pill._up.width].join(':');
                    stable = current === previous && !pill._layoutIdle ? stable + 1 : 0;
                    previous = current;
                    await delay(100);
                }
                assert(stable >= 3, 'Font/scale layout did not settle before the rate-width check');
                const width = this._island.actor.width, pillWidth = pill.actor.width;
                const networkWidth = pill._network.width;
                const reserved = [pill._down.width, pill._up.width];
                for (let i = 0; i < rates.length; i++) {
                    const [rx, down] = rates[i], [tx, up] = rates[rates.length - 1 - i];
                    render(rx, tx);
                    await delay(60);
                    assert(pill._down.text === down && pill._up.text === up, 'Notch did not format raw rate samples');
                    assert(this._island.actor.width === width && pill.actor.width === pillWidth && pill._network.width === networkWidth,
                        `Traffic resized notch at scale=${scale} text=${textScale}: ${down}/${up}`);
                    for (const [index, rate] of [pill._down, pill._up].entries()) {
                        assert(rate.width === reserved[index], 'Traffic changed a reserved rate width');
                        const layout = rate.clutter_text.get_layout().copy();
                        layout.set_width(-1);
                        assert(layout.get_pixel_size()[0] <= rate.width,
                            `Rate clipped at scale=${scale} text=${textScale}: ${rate.text}`);
                        let widest = 0;
                        for (const template of ['888B', '888K', '8.8K', '8.8M', '888M', '8.8G', '888G']) {
                            layout.set_text(template, -1);
                            widest = Math.max(widest, layout.get_pixel_size()[0]);
                        }
                        assert(rate.width === Math.ceil(widest), 'Rate reservation has unnecessary space');
                    }
                }
                // Only the notch's regular item spacing separates the rates
                // from their neighbours: the group adds no width of its own.
                const transfers = pill._transfers;
                assert(pill._network.width === Math.ceil(transfers.get_preferred_width(-1)[1]) &&
                    transfers.vertical === (layout === 'stacked'), `Rates group added width (${layout})`);
                if (layout === 'stacked')
                    assert(pill._down.get_transformed_position()[1] < pill._up.get_transformed_position()[1] &&
                        transfers.height <= pill.actor.height, 'Stacked rates are not one above the other inside the notch');
                const children = pill._content.get_children().filter(child => child.visible);
                const index = children.indexOf(pill._network);
                const left = child => child.get_transformed_position()[0];
                const gaps = [children[index - 1], children[index + 1]].map((neighbour, side) => !neighbour ? null : side
                    ? left(neighbour) - left(pill._network) - pill._network.width
                    : left(pill._network) - left(neighbour) - neighbour.width).map(gap => gap === null ? '-' : Math.round(gap));
                console.log(`[Island Smoke] Network width PASS: ${layout} scale=${scale} text=${textScale} ` +
                    `reserved=${reserved.join('/')}px gaps=${gaps.join('/')}px notch=${width}px`);
                await this._capture(`network-width-${layout}-${scale}-${textScale}`);
            }
        } finally {
            this._settings.reset('pill-network-layout');
            context.scale_factor = original.scale;
            text.set_double('text-scaling-factor', original.text);
            this._renderSystem(state);
            await delay(200);
        }
    }

    // The System tab fits its regular card without scrolling at default and
    // narrow widths and at 200%; only enlarged text may need its scroll area.
    async _checkSystemFits() {
        const card = this._card, settings = this._settings, island = this._island;
        const context = St.ThemeContext.get_for_stage(global.stage);
        const text = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const original = {scale: context.scale_factor, text: text.get_double('text-scaling-factor'), page: card._page};
        const results = [];
        try {
            for (const width of [380, 440]) for (const scale of [1, 2]) {
                settings.set_int('expanded-width', width);
                context.scale_factor = scale;
                text.set_double('text-scaling-factor', scale);
                card.selectPage('system');
                island.expand(); await delay(450);
                const adjustment = card._scroll.vadjustment;
                const overflow = Math.round(adjustment.upper - adjustment.page_size);
                results.push(`${width}px@${scale}x overflow=${overflow}`);
                await this._capture(`system-fit-${width}-${scale}`);
                island.collapse(); await delay(300);
            }
            assert(!results.some(result => !result.endsWith('=0') && !/=-/.test(result)), `System tab scrolls: ${results.join(', ')}`);
            console.log(`[Island Smoke] System fit PASS: ${results.join(', ')}`);
        } finally {
            settings.reset('expanded-width');
            context.scale_factor = original.scale;
            text.set_double('text-scaling-factor', original.text);
            if (original.page) card.selectPage(original.page);
            await delay(300);
        }
    }

    async _checkNotchOptions() {
        const island = this._island, pill = this._pill, settings = this._settings;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const font = actor => actor.get_theme_node().get_font().get_size();
        const system = this._states.system;
        const motion = St.Settings.get().enable_animations && !settings.get_boolean('disable-animations');
        const animation = motion ? Math.max(0, Math.min(500, settings.get_int('animation-duration'))) : 0;
        const base = {height: island.actor.height, title: font(pill._title), rate: font(pill._down), icon: pill._mediaIcon.icon_size};
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const monitor = Main.layoutManager.primaryMonitor;
        const top = [monitor.x + monitor.width / 2, monitor.y + scale];
        assert(!island.expanded, 'Notch options need a collapsed notch');
        try {
            // Text size: labels inherit one font size and the notch grows.
            settings.set_int('pill-text-scale', 150); await delay(250);
            assert(Math.abs(font(pill._down) / base.rate - 1.5) < 0.02 && Math.abs(font(pill._title) / base.title - 1.5) < 0.02,
                'Text size did not scale notch labels');
            assert(pill._mediaIcon.icon_size === Math.round(base.icon * 1.5), 'Notch icons did not follow the text size');
            assert(island.actor.height >= base.height && pill.actor.height <= island.actor.height - 2 * scale,
                `Enlarged text overflows the notch: content ${pill.actor.height}px in ${island.actor.height}px`);
            const enlarged = island.actor.height;
            await this._capture('notch-text-150');
            settings.reset('pill-text-scale'); await delay(250);
            assert(island.actor.height === base.height && font(pill._down) === base.rate, 'Default text size did not restore the notch');

            // CPU dot: hidden while idle, with hysteresis.
            settings.set_boolean('pill-cpu-hide-idle', true);
            const cpu = value => { this._renderSystem({...system, cpu: value}); return pill._cpuDot.visible; };
            assert(!cpu(20) && cpu(60) && cpu(47) && !cpu(40), 'Idle CPU dot did not follow the threshold and its band');
            settings.reset('pill-cpu-hide-idle');
            assert(cpu(5), 'CPU dot did not return when idle hiding was turned off');
            this._renderSystem(system);

            // Blend: the top bar's color and height while collapsed.
            settings.set_string('pill-style', 'panel'); await delay(150);
            const bar = Main.panel.get_theme_node().get_background_color();
            const layer = island._panelLayer.get_theme_node().get_background_color();
            assert(island.actor.height === Math.max(Main.panel.height, Math.ceil(pill.actor.height) + 2 * scale),
                `Blend height ${island.actor.height}px does not match the top bar (${Main.panel.height}px)`);
            assert(island._panelLayer.visible && island._panelLayer.opacity === 255 && island.material.opacity === 0 &&
                ['red', 'green', 'blue'].every(channel => Math.abs(layer[channel] - bar[channel]) <= 1),
                'Blend style did not take the top bar color');
            await this._capture('notch-blend');
            island.expand(); await delay(animation + 200);
            assert(island.material.opacity === 255 && island._panelLayer.opacity === 0, 'Opened blend card did not use the theme');
            island.collapse(); await delay(animation + 200);
            assert(island._panelLayer.opacity === 255 && island.material.opacity === 0, 'Closed blend notch did not return to the top bar color');
            settings.reset('pill-style'); await delay(150);
            assert(island.actor.height === base.height && !island._panelLayer.visible && island.material.opacity === 255,
                'Island style did not restore');

            // Auto-hide: concealed above the edge, revealed only by a resting pointer.
            move(50, 500); await delay(60);
            settings.set_int('auto-hide-reveal-delay', 300);
            settings.set_string('pill-style', 'auto-hide'); await delay(animation + 150);
            assert(island.concealed && island.actor.y + island.actor.height <= monitor.y && island.actor.opacity === 0,
                'Auto-hide did not slide the notch above the edge');
            // A sweep along the edge keeps restarting the wait.
            const zone = this._autoHide._zone, left = zone.x + 4 * scale;
            for (let x = left; x < zone.x + zone.width - 4 * scale; x += 40 * scale) { move(x, top[1]); await delay(50); }
            const sweep = Math.round((zone.width - 8 * scale) / (40 * scale)) * 50;
            assert(sweep > 300 && island.concealed, `A ${sweep}ms sweep along the edge revealed the notch`);
            // Hover slightly below the edge, beyond the old 3px reveal strip.
            move(top[0], monitor.y + 6 * scale); await delay(150);
            assert(island.concealed, 'Notch revealed before the delay');
            await delay(300 + animation);
            assert(!island.concealed && island.actor.y === monitor.y && island.actor.opacity === 255, 'Resting pointer did not reveal the notch');
            move(50, 500); await delay(700 + animation + 200);
            assert(island.concealed, 'Notch did not hide after the pointer left');
            // A click at the edge reveals and opens at once.
            move(...top); await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED); await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED); await delay(animation + 150);
            assert(island.expanded && !island.concealed, 'Clicking the edge did not open the island');
            move(50, 500); await delay(30);
            island.collapse(); await delay(animation + 700 + animation + 250);
            assert(island.concealed, 'Notch did not hide after closing');
            // Opening by shortcut reveals; a notification peek holds it down.
            this._autoHide.hold(400); await delay(animation + 100);
            assert(!island.concealed, 'Peek did not reveal the notch');
            await delay(400 + 700 + animation);
            assert(island.concealed, 'Notch stayed after the peek');
            settings.set_string('pill-style', 'panel'); await delay(animation + 150);
            assert(!island.concealed && !this._autoHide._zone && island.panelBlend, 'Blend style left the notch hidden');
            console.log(`[Island Smoke] Notch options PASS: text size ${base.height}->${enlarged}px, idle CPU band, ` +
                `blend ${Main.panel.height}px, auto-hide dwell/sweep/click/peek`);
        } finally {
            settings.reset('auto-hide-reveal-delay');
            settings.reset('pill-style');
            settings.reset('pill-text-scale');
            settings.reset('pill-cpu-hide-idle');
            this._renderSystem(system);
            move(50, 500);
            await delay(animation + 200);
        }
        assert(!island.concealed && !this._autoHide._zone && island.actor.y === monitor.y, 'Turning off auto-hide left the notch hidden');
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
            const afterTrack = state;
            state = {...state, lengthSec:301, positionSec:324}; render();
            assert(card._elapsed.text === '5:01' && slider.value === 1,
                'Elapsed time exceeded track duration');
            await this._capture('media-progress-bounds');
            state = {...afterTrack, trackRevision:1}; render();
            slider.emit('drag-begin');
            state = {...state, trackRevision:2, positionSec:4}; render();
            slider.emit('drag-end');
            assert(seeks.length === 2, 'Reused track ID allowed an old drag to seek the new track');
            assert(card._elapsed.text === '0:04', 'Reused track ID retained the old seek preview');
            state = {...state, live:true, lengthSec:null, canSeek:false, positionSec:8485}; render();
            assert(card._total.text === 'Live' && slider.value === 1 && !slider.reactive, 'Unbounded stream has invalid duration or seek controls');
            await this._capture('media-live');
            state = {...state, live:false, lengthSec:301, canSeek:true, positionSec:4}; render();
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
                    `Media scrolls at ${width}px with 125% text: ${adjustment.upper}/${adjustment.page_size}`);
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
            const navigation = card._navigation, island = this._island.actor;
            const navigationBottom = navigation.get_transformed_position()[1] + navigation.height;
            const cardBottom = island.get_transformed_position()[1] + island.height;
            const [, playerY] = card._openPlayer.get_transformed_position();
            assert(playerY >= navigationBottom - 1 && playerY + card._openPlayer.height <= cardBottom + 1, 'Enlarged controls are unreachable');
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

    async _checkQuickAsk() {
        const key = 'island-quick-ask-shortcut', card = this._card, quick = card._quickAsk;
        const settings = this._settings, originalAsk = card._actions.agentAsk;
        const saved = ['agents-provider', 'agents-project'].map(name => [name, settings.get_string(name)]);
        const page = card._page, width = settings.get_int('expanded-width');
        const hover = settings.get_boolean('hover-open');
        const context = St.ThemeContext.get_for_stage(global.stage), scale = context.scale_factor;
        const keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const chord = async keys => {
            for (const keyval of keys) keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
            await delay(30);
            for (const keyval of [...keys].reverse()) keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
            await delay(250);
        };
        const hotkey = [Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_space];
        try {
            this._island._snapCollapsed();
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_i]);
            assert(this._island.expanded && !card.quickAskOpen, 'Island shortcut did not expand the regular card');
            const initialPage = card._page, regularHeight = this._island.actor.height;
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_Page_Down]);
            assert(card._page !== initialPage, 'Next-tab shortcut did not advance');
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_Page_Up]);
            assert(card._page === initialPage, 'Previous-tab shortcut did not return');
            await chord([Clutter.KEY_Control_L, Clutter.KEY_Tab]);
            assert(card._page !== initialPage, 'Ctrl+Tab did not advance');
            await chord([Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_Tab]);
            assert(card._page === initialPage && this._island.actor.height === regularHeight, 'Tab cycling changed regular card size');
            for (let i = 0; i < 3; i++) {
                await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_Page_Up]);
                assert(card._page !== initialPage, 'Repeated previous-tab shortcut did not go backward');
                await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_Page_Down]);
                assert(card._page === initialPage, 'Repeated next-tab shortcut did not return');
            }
            console.log('[Island Smoke] Shortcuts PASS: global next/previous and Ctrl+Tab/Ctrl+Shift+Tab');
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_i]);
            assert(!this._island.expanded, 'Island shortcut did not close');
            settings.set_strv(key, ['<Super><Alt>space']);
            settings.set_string('agents-provider', 'codex');
            settings.set_string('agents-project', '');
            assert(this._quickAskBinding, 'Quick Ask binding was not registered');
            this._island.collapse(); await delay(250);
            await chord(hotkey);
            assert(card.quickAskOpen && quick.actor.mapped && this._island._grab, 'Global shortcut did not open the compact composer');
            assert(quick.prompt.clutter_text.has_key_focus(), 'Shortcut did not focus the prompt');
            assert(!card._navigation.mapped && !card._scroll.mapped && !this._progressTimer, 'Compact prompt retained hidden pages or playback updates');
            assert(this._island.actor.height < 150 * scale, 'Shortcut opened a full-height card');
            await chord([Clutter.KEY_z]);
            assert(quick.prompt.text === 'z', 'Compact prompt did not receive real keyboard input');
            settings.set_boolean('hover-open', true);
            this._island._hoverLeave();
            assert(!this._island._hoverClose, 'Typing armed hover dismissal');
            settings.set_boolean('hover-open', hover);
            quick.prompt.text = 'Explain the selected project';
            await this._capture('quick-ask');
            card._actions.agentAsk = () => { throw new Error('CLI missing. Choose its executable in Agents preferences.'); };
            await chord([Clutter.KEY_Return]);
            assert(quick.error.visible && quick.prompt.text === 'Explain the selected project' && this._island.expanded,
                'Launch failure discarded the prompt or closed the composer');
            settings.set_int('expanded-width', 380);
            const interfaceSettings = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
            const textScale = interfaceSettings.get_double('text-scaling-factor');
            interfaceSettings.set_double('text-scaling-factor', 1.5); await delay(200);
            assert(quick.target.text.includes('terminal'), 'Compact prompt lost its CLI target');
            const right = actor => actor.get_transformed_position()[0] + actor.get_transformed_size()[0];
            const bottom = actor => actor.get_transformed_position()[1] + actor.get_transformed_size()[1];
            assert(right(quick.send) <= right(card.actor) && quick.prompt.width > 30 * scale, 'Narrow enlarged-text composer overflowed');
            assert(bottom(quick.error) <= bottom(this._island.actor) && bottom(quick.target) <= bottom(this._island.actor),
                'Compact error or destination hint is clipped at enlarged text');
            await this._capture('quick-ask-error-large-text');
            interfaceSettings.set_double('text-scaling-factor', textScale);
            settings.set_int('expanded-width', width);
            let request;
            card._actions.agentAsk = input => { request = input; this._leaveAgents(); };
            await chord([Clutter.KEY_Return]);
            assert(request?.provider === 'codex' && request.cwd === GLib.get_home_dir() &&
                request.prompt === 'Explain the selected project', 'Shortcut did not use the selected harness/project');
            assert(!this._island.expanded && !this._island._grab && !quick.prompt.text, 'Successful submit retained the modal or draft');
            await chord(hotkey); quick.prompt.text = 'Keep this draft';
            await chord([Clutter.KEY_Escape]);
            assert(!this._island.expanded && quick.prompt.text === 'Keep this draft', 'Escape lost the compact draft');
            await chord(hotkey);
            assert(quick.prompt.text === 'Keep this draft' && quick.prompt.clutter_text.has_key_focus(), 'Reopening lost draft or focus');
            // Outside presses use the same release guard as the full card.
            const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), 40, 700); await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED); await delay(30);
            pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED); await delay(250);
            assert(!this._island.expanded && quick.prompt.text === 'Keep this draft', 'Outside dismissal lost the compact draft');
            await chord(hotkey);
            context.scale_factor = 2; await delay(200);
            assert(this._island.actor.height < 300 && quick.prompt.clutter_text.has_key_focus(), 'Scaled compact composer lost its size or focus');
            await this._capture('quick-ask-scaled');
            context.scale_factor = scale;
            await chord([Clutter.KEY_Escape]);
            settings.set_strv(key, ['<Super><Alt>j']);
            await settle();
            await chord(hotkey);
            assert(!this._island.expanded, 'Old shortcut remained active after rebinding');
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_j]);
            assert(card.quickAskOpen, 'New shortcut did not activate immediately');
            await chord([Clutter.KEY_Escape]);
            settings.set_strv(key, []);
            await settle();
            await chord([Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_j]);
            assert(!this._island.expanded && !this._quickAskBinding, 'Disabled shortcut still opened the prompt');
            this._island.expand(); await delay(200);
            assert(!card.quickAskOpen && card._navigation.mapped && card._page === page && this._island.actor.height >= 248 * scale,
                'Normal opening did not restore the full card');
            settings.set_strv(key, ['<Super><Alt>space']);
            await settle();
            await chord(hotkey);
            assert(card.quickAskOpen && quick.prompt.clutter_text.has_key_focus(), 'Shortcut did not replace an already open tab');
            await chord([Clutter.KEY_Escape]); this._island.expand(); await delay(200);
            console.log('[Island Smoke] Quick Ask PASS: global shortcut, focus, typing, target, launch errors, draft, Enter, Escape, rebind, scaling');
        } finally {
            card._actions.agentAsk = originalAsk; quick.prompt.text = '';
            settings.set_strv(key, []); context.scale_factor = scale;
            for (const [name, value] of saved) settings.set_string(name, value);
            settings.set_int('expanded-width', width);
            settings.set_boolean('hover-open', hover);
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
        await this._checkTitleTrimming(media);
        const longTitle = 'A long music title that should scroll completely across the collapsed notch';
        // Real Pango measurement catches the unused fixed slot after a long
        // title is replaced by a shorter one, including narrow/RTL text.
        this._settings.set_int('pill-title-characters', 17);
        this._renderMedia({...media, title: longTitle}); await delay(100);
        const fullSlotWidth = this._pill._mediaTitle.actor.width;
        const fullNotchWidth = this._island.actor.width;
        await this._capture('trim-long-title');
        for (const title of ['Hi', 'iiiiii', 'روز', 'Hi']) {
            this._renderMedia({...media, title}); await delay(100);
            const measured = this._pill._title.clutter_text.get_preferred_width(-1)[1];
            assert(Math.abs(this._pill._mediaTitle.actor.width - measured) < 1,
                `Short title still reserves unused width: ${title}`);
            assert(this._pill._mediaTitle.actor.width < fullSlotWidth && this._island.actor.width < fullNotchWidth,
                'Short title did not shrink the title slot and notch');
            assert(this._island.actor.width >= this._settings.get_int('pill-width') && !this._pill._mediaTitle.animationKey,
                'Trim mode lost the minimum notch width or started scrolling');
        }
        await this._capture('trim-short-title');
        this._renderMedia({...media, title: longTitle});
        assert(this._pill._mediaTitle.actor.width === fullSlotWidth, 'A new long title failed to restore its width cap');
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
        assert(!this._island._backdrop.visible, 'Collapsed notch kept the backdrop blur running');
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
        await this._checkQuickAsk();
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
        await this._checkTabSlider();
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
        assert(!this._card._commuteView.status.visible && this._card._commuteView.statusInfo.accessible_name === 'Live traffic freshness not confirmed', 'Commute traffic icon lost its explanation');
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
            // Provider credit lives in the closed provider panel, not on the route face.
            assert(commute.providerPanel.contains(commute.creditLink) && !commute.creditLink.mapped,
                'Attribution remains on the route face');
            for (const actor of [commute.eta, commute.unit, commute.arrival, commute.origin,
                commute.destination, commute.swap, commute.status, commute.freshness, commute.open, commute.provider]) {
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
        // The controls row (provider details and Open route) ends the route face.
        const controlsEdge = commute.controls.get_transformed_position()[1] + commute.controls.get_transformed_size()[1];
        const viewportEdge = this._card._scroll.get_transformed_position()[1] + this._card._scroll.height;
        assert(controlsEdge <= viewportEdge + 1, 'Commute controls are unreachable when scrolled');
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
        assert(this._pill._content.get_first_child() === this._pill._weather, 'Notch order did not update live');
        this._settings.set_boolean('pill-show-title', false);
        await this._capture('notch-icons');
        const requestsBeforeNotch = routeCalls;
        this._settings.set_boolean('pill-show-commute', true);
        await delay(120);
        assert(this._pill._commute.visible && this._pill._commuteValue.text === '32m', 'Commute notch did not show selected estimate');
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
                assert(this._pill._content.get_first_child() === this._pill._connection, 'Connection icon lost indicator order');
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
        await this._checkNetworkWidths();
        await this._checkNotchOptions();
        await this._checkSystemFits();
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
        for (const theme of [...THEME_IDS.filter(id => id !== 'graphite'), 'graphite']) {
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
        this._openQuickAsk();
        assert(!this._card.quickAskOpen && !this._island._grab, 'Shortcut stole focus from preferences');
        await delay(600);
        await this._capture('preferences-tabs');
        const agentSession = this._states.agents.sessions[0];
        assert(agentSession?.state === 'input', 'Native agent event did not reach Shell');
        this._island.resumeGrab();
        assert(this._island._grab, 'Agent focus check needs a real modal grab');
        const previousPage = this._card._page;
        this._card.selectPage('agents');
        const agentView = this._card._agentsView;
        agentView.folder.text = '/tmp'; agentView.prompt.text = 'A preserved draft';
        agentView.show('ask');
        await delay(150);
        assert(agentView.prompt.clutter_text.has_key_focus(), 'Quick Ask did not focus the entry under a real modal grab');
        this._island._onCapturedEvent(null, {type: () => Clutter.EventType.KEY_PRESS, get_key_symbol: () => Clutter.KEY_Escape});
        assert(agentView.mode === 'list' && this._island.expanded && agentView.prompt.text === 'A preserved draft', 'Nested Escape discarded the draft or closed the island');
        agentView.show('ask');
        await delay(150);
        assert(agentView.prompt.clutter_text.has_key_focus(), 'Reopening a draft lost focus');
        const composerHeight = this._island.actor.height;
        agentView.providerButton.emit('clicked', 1);
        await delay(100);
        assert(agentView.harnessMenu.visible && agentView.prompt.mapped, 'Harness menu hid the prompt');
        agentView.harnessMenu.get_children()[1].emit('clicked', 1);
        await delay(150);
        assert(agentView.provider === 'codex' && agentView.prompt.clutter_text.has_key_focus(), 'Changing harness lost typing focus');
        assert(this._island.actor.height === composerHeight, 'Harness selection resized the island');
        const keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_z, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_z, Clutter.KeyState.RELEASED);
        await delay(80);
        assert(agentView.prompt.text.includes('z'), 'Quick Ask did not receive keyboard text');
        await this._capture('agents-composer');
        const askAction = this._card._actions.agentAsk;
        this._card._actions.agentAsk = () => 'Smoke request prepared';
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.RELEASED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        await delay(100);
        this._card._actions.agentAsk = askAction;
        assert(agentView.mode === 'list' && !agentView.prompt.text, 'Ctrl+Enter did not submit Quick Ask');
        // Keep Agents mapped, as it is for a real row activation. Leaving the
        // tab disables the resolver and intentionally prevents activation.
        // Match an actual private-session window by its unique process ID.
        // The preferences/map pair may be ambiguous; never bypass the resolver
        // with the old manual-window binding path.
        const targetWindow = this._agentWindows.all().find(window => window.get_pid() > 1 &&
            this._agentWindows.resolve({...agentSession, pids:[window.get_pid()]}) === window);
        assert(targetWindow, 'Agent focus fixture needs an unambiguous application window');
        const targetSession = {...agentSession, pids:[targetWindow.get_pid()]};
        assert(this._agentWindows.active && agentView.actor.mapped, 'Agent resolver must be active for a row click');
        assert(this._agentWindows.resolve(agentSession) !== targetWindow, 'Stale PID fixture must differ from stored session');
        await this._openAgent(targetSession);
        await delay(50);
        assert(this._island.expanded && this._island._grab && !this._agentFocus,
            'Stale PID argument bypassed current-session validation');
        const agentState = this._states.agents;
        try {
            // Publish the fixture through the same snapshot/render path as a
            // broker update, so both activation checks see the same session.
            this._renderAgents({...agentState, sessions:agentState.sessions.map(session =>
                session.id === targetSession.id ? targetSession : session)});
            await this._openAgent(this._states.agents.sessions.find(session => session.id === targetSession.id));
            assert(this._agentFocus, 'Valid agent activation did not schedule focus');
            await delay(350);
            const focused = global.display.focus_window;
            assert(!this._island.expanded && !this._island._grab && !this._agentFocus &&
                (focused === targetWindow || focused?.get_transient_for() === targetWindow),
            `Agent focus failed: expanded=${this._island.expanded} grab=${Boolean(this._island._grab)} focused=${focused?.get_title()}`);
            console.log('[Island Smoke] Agent focus PASS: stale PIDs rejected, collapse, grab release and target focus');
        } finally {
            this._renderAgents(agentState);
            this._card.selectPage(previousPage);
        }
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
        const island = this._island.actor, cardBottom = island.get_transformed_position()[1] + island.height;
        assert(captionY + captionHeight <= cardBottom, 'System history caption is clipped');
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
            const [, start, end] = this._island.material.get_theme_node().get_background_gradient();
            assert(Math.abs(start.alpha - opacity * 255 / 100) <= 1, 'Rendered start alpha differs from opacity');
            assert(Math.abs(end.alpha - opacity * 255 / 100) <= 1, 'Rendered end alpha differs from opacity');
            assert(this._island.actor.opacity === 255 && this._card.actor.opacity === 255, 'Opacity faded content');
        }
        // Frosted glass: matte drives only the backdrop blur; opacity only the tint.
        const originalMatte = this._settings.get_int('surface-matte');
        this._settings.set_int('surface-opacity', 75);
        let previousRadius = -1;
        for (const matte of [0, 25, 50, 75, 100]) {
            this._settings.set_int('surface-matte', matte);
            await this._capture(`matte-${matte}-opacity-75`);
            const radius = this._island.backdropRadius;
            assert(matte === 0 ? radius === 0 : radius > previousRadius, 'Matte did not strengthen the backdrop blur');
            assert(this._island._backdrop.visible === (matte > 0 && radius > 0), 'Backdrop visibility does not follow matte');
            const [, start] = this._island.material.get_theme_node().get_background_gradient();
            assert(Math.abs(start.alpha - 191) <= 1, 'Matte changed the tint opacity');
            previousRadius = radius;
        }
        this._settings.set_int('surface-matte', 75);
        const matteRadius = this._island.backdropRadius;
        for (const opacity of [25, 50, 75, 100]) {
            this._settings.set_int('surface-opacity', opacity);
            await this._capture(`opacity-${opacity}-matte-75`);
            assert(opacity === 100 ? !this._island._backdrop.visible : this._island.backdropRadius === matteRadius,
                'Opacity changed the blur radius');
        }
        for (const theme of [...THEME_IDS.filter(id => id !== 'graphite'), 'graphite']) {
            this._settings.set_int('surface-opacity', 75);
            this._settings.set_string('color-theme', theme);
            await this._capture(`frosted-${theme}`);
        }
        this._settings.set_int('surface-matte', originalMatte);
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
        this._card.selectPage('agents'); this._island.expand(); await delay(300);
        const sessionsView = this._card._agentsView;
        sessionsView._session([...sessionsView.rows.values()][0]); await delay(50);
        assert(sessionsView.menuCapture, 'Session menu did not capture dismissal events');
        this.disable();
        assert(sessionsView.dead && !sessionsView.menuCapture && !sessionsView.revealIdle && !sessionsView.focusIdle,
            'Disable retained the session menu or a pending focus callback');
        assert(agentWindows.windows.size === 0 && !agentWindows.created && !this._agents && !this._agentFocus,
            'Disable retained agent state or window signals');
        assert(connectionSignals.size === 0, 'Disable retained connection notifications');
        if (saved) assert(saved.date.get_parent() === saved.center, 'Calendar parent was not restored');
        assert(!this._island && !this._progressTimer, 'Disable retained actors or progress timer');
        // The shortcut is independent of tracking and releases its binding/grab
        // through repeated extension disable/enable, even with the draft open.
        const settings = this.getSettings();
        settings.set_boolean('enable-agents', false);
        settings.set_strv('island-quick-ask-shortcut', ['<Super><Alt>space']);
        for (let i = 0; i < 2; i++) {
            super.enable();
            await settle();
            for (const keyval of [Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_space])
                keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
            await delay(30);
            for (const keyval of [Clutter.KEY_space, Clutter.KEY_Alt_L, Clutter.KEY_Super_L])
                keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
            await delay(300);
            assert(this._quickAskBinding && this._card.quickAskOpen && !this._agents && !this._card._agentsView,
                'Quick Ask requires session tracking or lost its binding on re-enable');
            this.disable();
            assert(!this._quickAskBinding && !this._island, 'Disable retained Quick Ask binding or actor');
        }
        console.log('[Island Smoke] Quick Ask lifecycle PASS: tracking off, repeated enable/disable');
        console.log('[Island Smoke] PASS: themes, opacity, bounded charts, hidden redraws, scaled layout, render, idle media, narrow layout, persistent rows, outside press, Escape, rapid toggle, disable');
    }
}
