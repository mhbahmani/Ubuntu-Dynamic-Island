// Runs only in the temporary Shell created by tests/smoke.py.
import UbuntuIsland from './implementation.js';
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
        super.enable();
        this._smoke().catch(error => console.error(`[Island Smoke] FAIL ${error.stack}`));
    }

    async _capture(name) {
        await delay(300);
        const file = Gio.File.new_for_path(`${GLib.getenv('ISLAND_SMOKE_OUTPUT')}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        try { await new Shell.Screenshot().screenshot(false, stream); }
        finally { stream.close(null); }
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
        this._renderSystem({cpu: 24, memory: 48, iface: 'wlan0', rx: '2.4 MB/s', tx: '128 KB/s'});
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
        await this._capture('playing-pill');
        this._island.expand();
        assert(this._island.state === 'expanded', 'Could not expand');
        this._card.renderProgress(72);
        await this._capture('expanded');
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
        this._card.selectPage('media');

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
        console.log('[Island Smoke] PASS: render, idle media, narrow layout, persistent rows, outside press, Escape, rapid toggle, disable');
    }
}
