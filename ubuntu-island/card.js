import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {icon, label, row, column, button, divider, pct, clip} from './widgets.js';
import {formatTime, clampFraction} from './services/format.js';

const METRIC_BAR_WIDTH = 72;

// Expanded island content. Every section renders its own empty state and
// tolerates a missing service snapshot (module disabled or service gone).
export class Card {
    constructor(settings, actions) {
        this._settings = settings;
        this._actions = actions;
        this._canSeek = false;
        this._lengthSec = null;

        this.actor = column('ubuntu-island-card');
        this.actor.reactive = true; // the open card swallows stray clicks like a panel popup
        this.actor.x_align = Clutter.ActorAlign.FILL;
        this.actor.y_align = Clutter.ActorAlign.FILL;

        if (settings.get_boolean('enable-media')) this._buildMedia();
        if (settings.get_boolean('enable-metrics')) this._buildMetrics();
        if (settings.get_boolean('enable-audio')) this._buildAudio();
        if (settings.get_boolean('enable-bluetooth')) this._buildBluetooth();
    }

    _buildMedia() {
        this.actor.add_child(label('NOW PLAYING', 'ubuntu-island-header'));
        const music = row();
        this._cover = new St.Bin({
            style_class: 'ubuntu-island-cover',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cover.set_child(icon('audio-x-generic-symbolic', 30));
        music.add_child(this._cover);

        const details = column();
        this._track = label('No media player detected', 'ubuntu-island-title');
        this._artist = label('Open an MPRIS-compatible player');
        details.add_child(this._track);
        details.add_child(this._artist);
        const controls = row();
        this._previous = button('media-skip-backward-symbolic', 'Previous track',
            () => this._actions.mediaCommand('Previous'));
        this._play = button('media-playback-start-symbolic', 'Play or pause',
            () => this._actions.mediaCommand('PlayPause'));
        this._next = button('media-skip-forward-symbolic', 'Next track',
            () => this._actions.mediaCommand('Next'));
        controls.add_child(this._previous);
        controls.add_child(this._play);
        controls.add_child(this._next);
        details.add_child(controls);
        music.add_child(details);
        this.actor.add_child(music);

        const progress = row('ubuntu-island-progress-row');
        this._elapsed = label('0:00', 'ubuntu-island-time');
        this._progressTrack = new St.Widget({
            style_class: 'ubuntu-island-progress-track', reactive: true, x_expand: true,
        });
        this._progressFill = new St.Widget({style_class: 'ubuntu-island-progress-fill'});
        this._progressTrack.add_child(this._progressFill);
        this._progressTrack.connect('button-press-event', (actor, event) => {
            if (!this._canSeek || !this._lengthSec) return Clutter.EVENT_PROPAGATE;
            const [trackX] = actor.get_transformed_position();
            const [pointerX] = event.get_coords();
            const fraction = clampFraction((pointerX - trackX) / Math.max(1, actor.width));
            const seconds = fraction * this._lengthSec;
            this._actions.seek(seconds);
            this.renderProgress(seconds);
            return Clutter.EVENT_STOP;
        });
        progress.add_child(this._elapsed);
        progress.add_child(this._progressTrack);
        this._total = label('–:––', 'ubuntu-island-time');
        progress.add_child(this._total);
        this.actor.add_child(progress);
        this.actor.add_child(divider());
    }

    _buildMetrics() {
        this.actor.add_child(label('SYSTEM', 'ubuntu-island-header'));
        const metrics = row('ubuntu-island-metrics');
        const tile = (name, withBar) => {
            const box = column('ubuntu-island-metric');
            box.x_expand = true;
            box.add_child(label(name));
            const value = label('—', 'ubuntu-island-metric-value');
            box.add_child(value);
            let bar = null;
            if (withBar) {
                const track = new St.Widget({style_class: 'ubuntu-island-metric-bar'});
                bar = new St.Widget({style_class: 'ubuntu-island-metric-bar-fill'});
                track.add_child(bar);
                box.add_child(track);
            }
            metrics.add_child(box);
            return {value, bar};
        };
        this._cpu = tile('CPU', true);
        this._ram = tile('RAM', true);
        this._rx = tile('↓ RX', false);
        this._tx = tile('↑ TX', false);
        this.actor.add_child(metrics);
        this._iface = label('Network: detecting…');
        this.actor.add_child(this._iface);
        this.actor.add_child(divider());
    }

    _buildAudio() {
        this.actor.add_child(label('SOUND', 'ubuntu-island-header'));
        const volumeRow = row('ubuntu-island-volume');
        this._mute = button('audio-volume-high-symbolic', 'Mute or unmute output',
            () => this._actions.toggleMute());
        volumeRow.add_child(this._mute);
        this._slider = new Slider.Slider(0.5);
        this._slider.x_expand = true;
        this._slider.accessible_name = 'Output volume';
        this._updatingVolume = false;
        this._draggingVolume = false;
        this._slider.connect('drag-begin', () => {
            this._draggingVolume = true;
        });
        this._slider.connect('drag-end', () => {
            this._draggingVolume = false;
        });
        this._slider.connect('notify::value', () => {
            if (!this._updatingVolume) this._actions.setVolume(this._slider.value);
        });
        volumeRow.add_child(this._slider);
        this._volume = label('—', 'ubuntu-island-metric-value');
        volumeRow.add_child(this._volume);
        this.actor.add_child(volumeRow);

        this.actor.add_child(label('OUTPUT DEVICES', 'ubuntu-island-header'));
        this._outputs = column();
        this.actor.add_child(this._outputs);
        this.actor.add_child(divider());
    }

    _buildBluetooth() {
        const heading = row();
        heading.add_child(label('BLUETOOTH', 'ubuntu-island-header'));
        heading.add_child(new St.Widget({x_expand: true}));
        this._power = button('bluetooth-disabled-symbolic', 'Toggle Bluetooth power',
            () => this._actions.btPower());
        this._power.visible = false;
        heading.add_child(this._power);
        heading.add_child(button('emblem-system-symbolic', 'Open Bluetooth Settings',
            () => Util.spawn(['gnome-control-center', 'bluetooth'])));
        this.actor.add_child(heading);
        this._btStatus = label('Detecting Bluetooth…');
        this.actor.add_child(this._btStatus);
        this._devices = column();
        this.actor.add_child(this._devices);
    }

    renderProgress(positionSec) {
        if (!this._progressTrack) return;
        const total = this._lengthSec;
        const position = Number.isFinite(positionSec) ? Math.max(0, positionSec) : null;
        this._elapsed.text = formatTime(position ?? 0);
        this._total.text = formatTime(total);
        const fraction = total && position != null ? clampFraction(position / total) : 0;
        // The track is x_expand inside the fixed-width card, so its live width
        // is the reference for the fill once the card has been allocated.
        this._progressFill.width = Math.round(fraction * Math.max(1, this._progressTrack.width));
        this._progressTrack.reactive = Boolean(this._canSeek && total);
    }

    renderMedia(state) {
        if (!this._track) return;
        const available = Boolean(state?.available);
        this._track.text = available ? clip(String(state.title ?? ''), 48) : 'No media player detected';
        this._artist.text = available ? clip(String(state.artist ?? ''), 64) : 'Open an MPRIS-compatible player';
        this._play.child.icon_name = state?.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.reactive = available && Boolean(state.canControl);
        this._previous.reactive = available && Boolean(state.canPrevious);
        this._next.reactive = available && Boolean(state.canNext);
        this._canSeek = available && Boolean(state.canSeek);
        this._lengthSec = Number(state?.lengthSec) > 0 ? Number(state.lengthSec) : null;
        this.renderProgress(null);
        if (!available) this.renderArt(null);
    }

    renderArt(content) {
        this._cover?.set_child(content
            ? new St.Widget({content, style_class: 'ubuntu-island-artwork'})
            : icon('audio-x-generic-symbolic', 30));
    }

    renderProgress(positionSec) {
        if (!this._progressTrack) return;
        const total = this._lengthSec;
        const position = Number.isFinite(positionSec) ? Math.max(0, positionSec) : null;
        this._elapsed.text = formatTime(position ?? 0);
        this._total.text = formatTime(total);
        const fraction = total && position != null ? clampFraction(position / total) : 0;
        this._progressFill.width = Math.round(fraction * this._trackWidth);
        this._progressTrack.reactive = Boolean(this._canSeek && total);
    }

    renderSystem(state) {
        if (!this._cpu || !state) return;
        this._cpu.value.text = pct(state.cpu);
        this._ram.value.text = pct(state.memory);
        this._rx.value.text = state.rx ?? '—';
        this._tx.value.text = state.tx ?? '—';
        this._cpu.bar.width = Math.round(clampFraction((state.cpu ?? 0) / 100) * METRIC_BAR_WIDTH);
        this._ram.bar.width = Math.round(clampFraction((state.memory ?? 0) / 100) * METRIC_BAR_WIDTH);
        this._iface.text = `Network: ${state.iface ?? 'unavailable'}`;
    }

    renderAudio(state) {
        if (!this._slider || !state) return;
        const level = state.muted ? 0 : state.volume;
        this._volume.text = state.available ? `${Math.round(level * 100)}%` : '—';
        if (!this._draggingVolume) {
            this._updatingVolume = true;
            this._slider.value = Math.max(0, Math.min(1, level));
            this._updatingVolume = false;
        }
        this._mute.child.icon_name = !state.available || state.muted || level === 0
            ? 'audio-volume-muted-symbolic'
            : level < 0.33 ? 'audio-volume-low-symbolic'
            : level < 0.66 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
        this._outputs.destroy_all_children();
        if (!state.available) {
            this._outputs.add_child(label('Sound server not available'));
            return;
        }
        if (!state.outputs.length) this._outputs.add_child(label('No output devices found'));
        for (const output of state.outputs) {
            const item = new St.Button({
                style_class: `ubuntu-island-output${output.active ? ' ubuntu-island-output-active' : ''}`,
                can_focus: true,
                x_expand: true,
                accessible_name: `Switch to ${output.name}`,
                child: label(`${output.active ? '● ' : '○ '}${clip(String(output.name ?? ''), 44)}`),
            });
            item.connect('clicked', () => this._actions.selectOutput(output.id));
            this._outputs.add_child(item);
        }
    }

    renderBluetooth(state) {
        if (!this._btStatus || !state) return;
        const connected = state.devices.filter(d => d.connected).length;
        this._btStatus.text = !state.available ? 'Bluetooth service unavailable'
            : !state.hasAdapter ? 'No Bluetooth adapter found'
            : !state.powered ? 'Bluetooth is powered off'
                : `${connected} connected · ${state.devices.length} paired`;
        this._power.visible = Boolean(state.available && state.hasAdapter);
        this._power.child.icon_name = state.powered
            ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        this._devices.destroy_all_children();
        if (state.available && state.powered && state.devices.length === 0)
            this._devices.add_child(label('Pair devices using Bluetooth Settings'));
        for (const device of state.devices) {
            const deviceRow = row('ubuntu-island-device');
            const nameText = clip(String(device.name ?? ''), 34);
            const name = label(device.battery == null ? nameText : `${nameText} · ${device.battery}%`);
            name.x_expand = true;
            deviceRow.add_child(name);
            deviceRow.add_child(button(
                device.connected ? 'network-offline-symbolic' : 'network-transmit-receive-symbolic',
                `${device.connected ? 'Disconnect' : 'Connect'} ${device.name}`,
                () => this._actions.btToggle(device)));
            this._devices.add_child(deviceRow);
        }
    }
}
