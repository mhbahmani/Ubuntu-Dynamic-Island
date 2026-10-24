import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {IslandSurface} from './island.js';
import {Pill} from './pill.js';
import {Card} from './card.js';
import {SystemMonitor} from './services/system.js';
import {MediaService} from './services/media.js';
import {BluetoothService} from './services/bluetooth.js';
import {AudioService} from './services/audio.js';
import {ArtLoader} from './services/art.js';

export default class UbuntuIsland extends Extension {
    enable() {
        this._enabled = true;
        this._settings = this.getSettings();
        this._states = {};
        this._progressTimer = 0;
        this._settingsIds = [];
        this._layoutSignature = '';

        if (this._settings.get_boolean('move-clock')) this._moveCalendar();

        this._pill = new Pill(() => this._island?.toggle());
        this._card = new Card(this._settings, {
            mediaCommand: method => this._media?.command(method),
            seek: seconds => this._media?.seek(seconds),
            setVolume: value => this._audio?.setVolume(value),
            toggleMute: () => this._audio?.toggleMute(),
            selectOutput: id => this._audio?.selectOutput(id),
            btToggle: device => this._bluetooth?.toggle(device),
            btPower: () => this._bluetooth?.setPowered(!this._states.bluetooth?.powered),
        });
        this._island = new IslandSurface({
            settings: this._settings,
            pill: this._pill.actor,
            card: this._card.actor,
            onStateChange: () => this._syncProgressTimer(),
        });
        this._island.setHoverEnabled(
            this._settings.get_boolean('hover-open'),
            this._settings.get_int('hover-open-delay'),
            this._settings.get_int('hover-close-delay'));
        this._watchSettings();

        // Model events drive isolated UI updates; no UI code in the services.
        if (this._settings.get_boolean('enable-media')) {
            this._art = new ArtLoader();
            this._media = new MediaService(state => this._renderMedia(state));
        }
        if (this._settings.get_boolean('enable-metrics')) {
            this._system = new SystemMonitor(
                state => this._renderSystem(state),
                this._settings.get_int('metrics-interval'));
        }
        if (this._settings.get_boolean('enable-audio'))
            this._audio = new AudioService(state => this._renderAudio(state));
        if (this._settings.get_boolean('enable-bluetooth'))
            this._bluetooth = new BluetoothService(state => this._renderBluetooth(state));

        this._island.show();
        this._renderPill();
        this._system?.start();
        this._media?.start();
        this._bluetooth?.start();
        this._audio?.start();
    }

    _watchSettings() {
        const watch = (key, handler) =>
            this._settingsIds.push(this._settings.connect(`changed::${key}`, handler));
        watch('pill-width', () => this._island?.applyDimensions());
        watch('expanded-width', () => this._island?.applyDimensions());
        const syncHover = () => this._island?.setHoverEnabled(
            this._settings.get_boolean('hover-open'),
            this._settings.get_int('hover-open-delay'),
            this._settings.get_int('hover-close-delay'));
        watch('hover-open', syncHover);
        watch('hover-open-delay', syncHover);
        watch('hover-close-delay', syncHover);
        // Module toggles, the metrics interval, and move-clock changes take
        // effect after a disable/enable cycle.
    }

    _renderPill() {
        if (!this._enabled) return;
        this._pill.render({
            media: this._states.media,
            system: this._states.system,
            bluetooth: this._states.bluetooth,
            expanded: this._island?.expanded ?? false,
            showMetrics: this._settings.get_boolean('enable-metrics'),
            pillWidth: this._settings.get_int('pill-width'),
        });
    }

    _renderMedia(state) {
        if (!this._enabled) return;
        this._states.media = state;
        this._card.renderMedia(state);
        this._renderPill();
        const artUrl = state?.available ? String(state.artUrl ?? '') : '';
        const remote = /^https?:/i.test(artUrl);
        if (artUrl && (!remote || this._settings.get_boolean('enable-remote-art'))) {
            this._art?.load(artUrl, 64, content => {
                if (this._enabled) this._card.renderArt(content);
            });
        } else {
            this._art?.cancel();
            this._card.renderArt(null);
        }
        this._layoutIfChanged({media: Boolean(state?.available)});
        this._syncProgressTimer();
    }

    _renderSystem(state) {
        if (!this._enabled) return;
        this._states.system = state;
        this._card.renderSystem(state);
        this._renderPill();
    }

    _renderAudio(state) {
        if (!this._enabled) return;
        this._states.audio = state;
        this._card.renderAudio(state);
        this._layoutIfChanged({outputs: state?.outputs?.length ?? 0});
    }

    _renderBluetooth(state) {
        if (!this._enabled) return;
        this._states.bluetooth = state;
        this._card.renderBluetooth(state);
        this._renderPill();
        this._layoutIfChanged({devices: state?.devices?.length ?? 0});
    }

    // Sections can appear or vanish while the card is open (player quits,
    // output list changes); the island height follows the new content.
    _layoutIfChanged(parts) {
        const signature = JSON.stringify(parts);
        if (signature === this._layoutSignature) return;
        this._layoutSignature = signature;
        this._island?.relayout();
    }

    // One-second UI clock while the card is open and a player is active.
    _syncProgressTimer() {
        if (!this._enabled) return;
        const needed = Boolean(this._island?.expanded && this._states.media?.available);
        if (needed && !this._progressTimer) {
            const tick = () => {
                if (!this._island?.expanded || !this._states.media?.available) {
                    this._progressTimer = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._card.renderProgress(this._media?.positionSec() ?? null);
                return GLib.SOURCE_CONTINUE;
            };
            this._progressTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tick);
            tick();
        } else if (!needed && this._progressTimer) {
            GLib.Source.remove(this._progressTimer);
            this._progressTimer = 0;
        }
    }

    _moveCalendar() {
        // GNOME 46-specific private panel API. Keep calendar/notifications usable.
        const date = Main.panel.statusArea.dateMenu?.container;
        const center = Main.panel._centerBox;
        const right = Main.panel._rightBox;
        if (!date || !center || !right || date.get_parent() !== center) return;
        const index = center.get_children().indexOf(date);
        center.remove_child(date);
        right.insert_child_at_index(date, 0);
        this._dateRestore = {date, center, index};
    }

    _restoreCalendar() {
        const saved = this._dateRestore;
        this._dateRestore = null;
        if (!saved) return;
        const parent = saved.date.get_parent();
        if (parent) parent.remove_child(saved.date);
        saved.center.insert_child_at_index(saved.date, Math.min(saved.index, saved.center.get_n_children()));
    }

    disable() {
        // Guard against late async callbacks before destroying any actor.
        this._enabled = false;
        if (this._progressTimer) GLib.Source.remove(this._progressTimer);
        this._progressTimer = 0;
        for (const id of this._settingsIds) this._settings.disconnect(id);
        this._settingsIds = [];
        this._system?.stop();
        this._media?.stop();
        this._bluetooth?.stop();
        this._audio?.stop();
        this._art?.destroy();
        this._system = this._media = this._bluetooth = this._audio = this._art = null;
        this._island?.destroy();
        this._island = null;
        this._card = null;
        this._pill = null;
        this._states = null;
        this._restoreCalendar();
        this._settings = null;
    }
}
