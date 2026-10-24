import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SystemMonitor} from './services/system.js';
import {MediaService} from './services/media.js';
import {BluetoothService} from './services/bluetooth.js';
import {AudioService} from './services/audio.js';

const icon = (name, size = 17) => new St.Icon({icon_name: name, icon_size: size});
const label = (text, css = 'ubuntu-island-muted') =>
    new St.Label({text, style_class: css, y_align: Clutter.ActorAlign.CENTER});
const row = (css = 'ubuntu-island-row') => new St.BoxLayout({style_class: css, vertical: false});
const column = (css = '') => new St.BoxLayout({style_class: css, vertical: true});
function button(name, tooltip, action) {
    const b = new St.Button({
        style_class: 'ubuntu-island-control', can_focus: true, reactive: true,
        child: icon(name, 18), accessible_name: tooltip,
    });
    b.connect('clicked', action);
    return b;
}
function divider() { return new St.Widget({style_class: 'ubuntu-island-separator'}); }
function pct(value) { return value == null ? '—' : `${Math.round(value)}%`; }

export default class UbuntuIsland extends Extension {
    enable() {
        this._dateRestore = null;
        this._moveCalendar();
        this._indicator = new PanelMenu.Button(0.5, 'Ubuntu Island', false);
        this._indicator.add_style_class_name('ubuntu-island-indicator');
        const pill = row('ubuntu-island-pill');
        this._compactIcon = icon('audio-x-generic-symbolic', 15);
        this._compactText = label('Island', 'ubuntu-island-title');
        pill.add_child(this._compactIcon);
        pill.add_child(this._compactText);
        pill.add_child(icon('bluetooth-symbolic', 13));
        this._indicator.add_child(pill);
        this._pill = pill;
        this._buildMenu();
        this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open) pill.add_style_class_name('ubuntu-island-pill-open');
            else pill.remove_style_class_name('ubuntu-island-pill-open');
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'center');

        this._system = new SystemMonitor(state => this._renderSystem(state));
        this._media = new MediaService(state => this._renderMedia(state));
        this._bluetooth = new BluetoothService(state => this._renderBluetooth(state));
        this._audio = new AudioService(state => this._renderAudio(state));
        this._system.start();
        this._media.start();
        this._bluetooth.start();
        this._audio.start();
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

    _buildMenu() {
        const menu = this._indicator.menu;
        menu.actor.add_style_class_name('ubuntu-island-menu');
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_style_class_name('ubuntu-island-popup-item');
        const root = column('ubuntu-island-root');
        item.add_child(root);
        menu.addMenuItem(item);

        // Music
        root.add_child(label('NOW PLAYING', 'ubuntu-island-header'));
        const music = row();
        this._cover = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 68,
            style_class: 'ubuntu-island-cover'});
        music.add_child(this._cover);
        const musicDetails = column();
        this._track = label('No media player detected', 'ubuntu-island-title');
        this._artist = label('Open an MPRIS-compatible player');
        musicDetails.add_child(this._track);
        musicDetails.add_child(this._artist);
        const controls = row();
        this._previous = button('media-skip-backward-symbolic', 'Previous track', () => this._media?.command('Previous'));
        this._play = button('media-playback-start-symbolic', 'Play or pause', () => this._media?.command('PlayPause'));
        this._next = button('media-skip-forward-symbolic', 'Next track', () => this._media?.command('Next'));
        controls.add_child(this._previous);
        controls.add_child(this._play);
        controls.add_child(this._next);
        musicDetails.add_child(controls);
        music.add_child(musicDetails);
        root.add_child(music);
        root.add_child(divider());

        // System metrics
        root.add_child(label('SYSTEM', 'ubuntu-island-header'));
        const metrics = row();
        const metric = (name) => {
            const box = column('ubuntu-island-metric');
            box.x_expand = true;
            box.add_child(label(name));
            const value = label('—', 'ubuntu-island-title');
            box.add_child(value);
            metrics.add_child(box);
            return value;
        };
        this._cpu = metric('CPU');
        this._ram = metric('RAM');
        this._down = metric('↓ Download');
        this._up = metric('↑ Upload');
        root.add_child(metrics);
        this._interface = label('Network: detecting…');
        root.add_child(this._interface);
        root.add_child(divider());

        // Sound
        root.add_child(label('SOUND', 'ubuntu-island-header'));
        const volumeRow = row('ubuntu-island-volume');
        volumeRow.add_child(icon('audio-volume-high-symbolic', 17));
        this._slider = new Slider.Slider(0.5);
        this._slider.x_expand = true;
        this._slider.accessible_name = 'Output volume';
        this._updatingVolume = false;
        this._draggingVolume = false;
        this._slider.connect('drag-begin', () => { this._draggingVolume = true; });
        this._slider.connect('drag-end', () => { this._draggingVolume = false; });
        this._slider.connect('notify::value', () => {
            if (!this._updatingVolume) this._audio?.setVolume(this._slider.value);
        });
        volumeRow.add_child(this._slider);
        this._volume = label('—');
        volumeRow.add_child(this._volume);
        root.add_child(volumeRow);
        root.add_child(label('OUTPUT DEVICES', 'ubuntu-island-header'));
        this._outputs = column();
        root.add_child(this._outputs);
        root.add_child(divider());

        // Bluetooth (paired devices only)
        const btHeading = row();
        btHeading.add_child(label('BLUETOOTH', 'ubuntu-island-header'));
        btHeading.add_child(button('emblem-system-symbolic', 'Open Bluetooth Settings', () => {
            Util.spawn(['gnome-control-center', 'bluetooth']);
        }));
        root.add_child(btHeading);
        this._btStatus = label('Detecting Bluetooth…');
        root.add_child(this._btStatus);
        this._devices = column();
        root.add_child(this._devices);
    }

    _renderMedia(state) {
        if (!this._indicator) return;
        this._track.text = state.available ? String(state.title) : 'No media player detected';
        this._artist.text = state.available ? String(state.artist) : 'Open an MPRIS-compatible player';
        this._compactText.text = state.available ? String(state.title).slice(0, 18) : 'Island';
        this._compactIcon.icon_name = state.available ? 'media-playback-start-symbolic' : 'audio-x-generic-symbolic';
        this._play.child.icon_name = state.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.reactive = Boolean(state.available && state.canControl);
        this._previous.reactive = Boolean(state.available && state.canPrevious);
        this._next.reactive = Boolean(state.available && state.canNext);
        // File-based art is rendered locally; remote HTTP art requires a future async cache.
        const uri = state.artUrl || '';
        if (uri.startsWith('file://')) {
            this._cover.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(uri)});
        } else {
            this._cover.gicon = new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
        }
    }

    _renderSystem(state) {
        if (!this._indicator) return;
        this._cpu.text = pct(state.cpu);
        this._ram.text = pct(state.memory);
        this._down.text = state.rx;
        this._up.text = state.tx;
        this._interface.text = `Network: ${state.iface}`;
    }

    _renderAudio(state) {
        if (!this._indicator) return;
        this._volume.text = state.available ? `${Math.round(state.volume * 100)}%` : '—';
        if (!this._draggingVolume) {
            this._updatingVolume = true;
            this._slider.value = state.volume;
            this._updatingVolume = false;
        }
        this._outputs.destroy_all_children();
        if (!state.sinks.length) this._outputs.add_child(label('No output devices'));
        for (const sink of state.sinks.slice(0, 6)) {
            const output = new St.Button({
                style_class: 'ubuntu-island-control', can_focus: true,
                x_expand: true, accessible_name: `Use ${sink.name}`,
                child: label(`${sink.selected ? '✓ ' : ''}${sink.name}`),
            });
            output.connect('clicked', () => this._audio.selectSink(sink.id));
            this._outputs.add_child(output);
        }
    }

    _renderBluetooth(state) {
        if (!this._indicator) return;
        this._btStatus.text = !state.available ? 'Bluetooth service unavailable'
            : !state.powered ? 'Bluetooth is powered off'
                : `${state.devices.filter(d => d.connected).length} connected · ${state.devices.length} paired`;
        this._devices.destroy_all_children();
        for (const device of state.devices) {
            const deviceRow = row('ubuntu-island-device');
            const name = label(device.battery == null ? device.name : `${device.name} (${device.battery}%)`);
            name.x_expand = true;
            deviceRow.add_child(name);
            deviceRow.add_child(button(
                device.connected ? 'network-offline-symbolic' : 'network-transmit-receive-symbolic',
                `${device.connected ? 'Disconnect' : 'Connect'} ${device.name}`,
                () => this._bluetooth.toggle(device)));
            this._devices.add_child(deviceRow);
        }
        if (state.available && state.devices.length === 0)
            this._devices.add_child(label('Pair devices using Bluetooth Settings'));
    }

    disable() {
        // Guard against late D-Bus callbacks and clean up before destroying actors.
        this._system?.stop();
        this._media?.stop();
        this._bluetooth?.stop();
        this._audio?.stop();
        this._system = this._media = this._bluetooth = this._audio = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._restoreCalendar();
    }
}
