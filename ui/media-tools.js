import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {row, column, label, button, setEnabled} from './widgets.js';

export function textControl(text, action, css = 'ubuntu-island-media-text-button') {
    const control = new St.Button({style_class: css, can_focus: true, reactive: true,
        track_hover: true, x_expand: true, child: label(text, '', true), accessible_name: text});
    control.child.x_expand = true;
    control.child.x_align = Clutter.ActorAlign.START;
    control.connect('clicked', action);
    return control;
}

function wrapped(text, css) {
    const item = label(text, css, false);
    item.clutter_text.line_wrap = true;
    item.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    item.x_expand = true;
    return item;
}

// Secondary views share the media viewport; the module navigation never moves.
export class MediaTools {
    constructor(card, content, main, actions) {
        this.card = card;
        this.main = main;
        this.actions = actions;
        this.mode = null;
        this.playerRows = new Map();
        this.queueRows = new Map();
        this.panel = column('ubuntu-island-media-panel');
        content.add_child(this.panel);
        const heading = row('ubuntu-island-media-panel-heading');
        this.back = button('go-previous-symbolic', 'Back to playback', () => this.show(null), 16, 'ubuntu-island-ghost');
        heading.add_child(this.back);
        this.title = label('', 'ubuntu-island-track');
        this.title.x_expand = true;
        heading.add_child(this.title);
        this.panel.add_child(heading);
        this.views = new Map();
        for (const mode of ['players', 'sound', 'lyrics', 'queue']) {
            const view = column('ubuntu-island-media-panel-body');
            this.views.set(mode, view);
            this.panel.add_child(view);
        }
        this.automatic = textControl('Automatic · follow playing apps', () => actions.selectPlayer(null));
        this.views.get('players').add_child(this.automatic);

        const volume = row('ubuntu-island-volume');
        this.mute = button('audio-volume-high-symbolic', 'Mute output', () => actions.toggleMute(), 16, 'ubuntu-island-ghost');
        volume.add_child(this.mute);
        this.volume = new Slider.Slider(0);
        this.volume.x_expand = true;
        this.volume.accessible_name = 'System volume';
        this.volume.connect('drag-begin', () => { this.draggingVolume = true; });
        this.volume.connect('drag-end', () => { this.draggingVolume = false; });
        this.volume.connect('notify::value', () => {
            if (!this.updatingVolume) {
                this.level.text = `${Math.round(this.volume.value * 100)}%`;
                actions.setVolume(this.volume.value);
            }
        });
        volume.add_child(this.volume);
        this.level = label('', 'ubuntu-island-time');
        volume.add_child(this.level);
        const sound = this.views.get('sound');
        sound.add_child(volume);
        this.output = wrapped('', 'ubuntu-island-artist');
        sound.add_child(this.output);
        sound.add_child(textControl('Choose sound output →', () => { this.show(null); card.selectPage('audio'); }));

        const lyrics = this.views.get('lyrics');
        this.lyricsStatus = wrapped('Find lyrics on LRCLIB', 'ubuntu-island-artist');
        lyrics.add_child(this.lyricsStatus);
        this.lyricLines = [-1, 0, 1].map((_, i) => {
            const item = wrapped('', i === 1 ? 'ubuntu-island-lyric-current' : 'ubuntu-island-lyric-context');
            lyrics.add_child(item);
            return item;
        });
        this.fullLyrics = wrapped('', 'ubuntu-island-lyrics-text');
        lyrics.add_child(this.fullLyrics);
        this.lyricsToggle = textControl('Show all lyrics', () => {
            this.allLyrics = !this.allLyrics;
            this.renderLyrics(this.lyricsState);
        });
        lyrics.add_child(this.lyricsToggle);
        this.retry = textControl('Try again', () => actions.retryLyrics());
        lyrics.add_child(this.retry);
        this.lyricsCredit = label('Lyrics from LRCLIB', 'ubuntu-island-media-credit');
        lyrics.add_child(this.lyricsCredit);
        this.queueStatus = wrapped('', 'ubuntu-island-artist');
        this.views.get('queue').add_child(this.queueStatus);
        this.panel.hide();
    }

    show(mode, opener = null) {
        if (mode) this.opener = opener;
        this.mode = mode;
        this.main.visible = !mode;
        this.panel.visible = Boolean(mode);
        this.title.text = {players: 'Choose player', sound: 'Sound', lyrics: 'Lyrics', queue: 'Up next'}[mode] || '';
        for (const [key, view] of this.views) view.visible = key === mode;
        const adjustment = this.card._scroll.vscroll.adjustment;
        adjustment.value = adjustment.lower;
        this.actions.mediaViewChanged?.();
        this.actions.relayout?.();
        if (mode) this.back.grab_key_focus();
        else if (this.opener?.mapped) this.opener.grab_key_focus();
    }

    renderMedia(state) {
        this.state = state;
        const players = state.players ?? [];
        this._checked(this.automatic, !state.pinned);
        this.automatic.child.text = `${state.pinned ? '' : '✓  '}Automatic · follow playing apps`;
        this._rows(this.playerRows, this.views.get('players'), players.map(player => ({
            id: player.id, text: `${player.name} · ${player.status === 'Playing' ? 'Playing' : 'Paused'}`,
            selected: state.pinned === player.id, enabled: true,
        })), id => this.actions.selectPlayer(id));
    }

    _checked(control, selected) {
        control.accessible_role = Atk.Role.TOGGLE_BUTTON;
        if (selected) {
            control.add_style_pseudo_class('checked');
            control.add_accessible_state(Atk.StateType.CHECKED);
        } else {
            control.remove_style_pseudo_class('checked');
            control.remove_accessible_state(Atk.StateType.CHECKED);
        }
    }

    _rows(rows, parent, entries, activate) {
        const ids = new Set(entries.map(entry => entry.id));
        for (const [id, control] of rows) if (!ids.has(id)) {
            if (control.has_key_focus()) this.back.grab_key_focus();
            control.destroy(); rows.delete(id);
        }
        entries.forEach((entry, index) => {
            let control = rows.get(entry.id);
            if (!control) {
                control = textControl('', () => activate(entry.id));
                rows.set(entry.id, control);
                parent.add_child(control);
            }
            control.child.text = `${entry.selected ? '✓  ' : ''}${entry.text}`;
            control.accessible_name = entry.text;
            this._checked(control, entry.selected);
            setEnabled(control, entry.enabled);
            parent.set_child_at_index(control, index + 1);
        });
    }

    renderAudio(state) {
        const available = Boolean(state?.available);
        const level = state?.muted ? 0 : state?.volume || 0;
        this.updatingVolume = true;
        if (!this.draggingVolume) this.volume.value = level;
        this.updatingVolume = false;
        this.level.text = available ? `${Math.round(level * 100)}%` : '—';
        this.output.text = available ? state.outputs?.find(o => o.active)?.name || 'Current system output' : 'Sound output unavailable';
        this.mute.child.icon_name = state?.muted || !level ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
        this.mute.accessible_name = state?.muted ? 'Unmute output' : 'Mute output';
        setEnabled(this.mute, available);
        setEnabled(this.volume, available);
    }

    renderQueue(state) {
        this.queueStatus.text = state?.message || '';
        this._rows(this.queueRows, this.views.get('queue'), (state?.tracks ?? []).map(track => ({
            id: track.id, text: `${track.title}${track.artist ? ` — ${track.artist}` : ''}`,
            selected: false, enabled: track.canPlay,
        })), id => this.actions.playTrack(id));
    }

    renderLyrics(state) {
        this.lyricsState = state;
        const lines = state?.lines || [];
        this.lyricsStatus.text = lines.length ? (state.synced ? 'Synced lyrics' : 'Lyrics') : state?.message || 'Finding lyrics…';
        this.lyricsStatus.visible = !lines.length;
        this.lyricsCredit.text = state?.synced ? 'Synced lyrics · LRCLIB' : 'Lyrics from LRCLIB';
        this.fullLyrics.text = lines.map(line => line.text).join('\n');
        this.fullLyrics.visible = Boolean(lines.length && (!state.synced || this.allLyrics));
        this.lyricsToggle.visible = Boolean(lines.length && state.synced);
        this.lyricsToggle.child.text = this.allLyrics ? 'Show current line' : 'Show all lyrics';
        this.lyricsToggle.accessible_name = this.lyricsToggle.child.text;
        this.retry.visible = Boolean(state?.retry);
        this.lyricLines.forEach(item => { item.visible = Boolean(lines.length && state.synced && !this.allLyrics); });
        this._lyricIndex = null;
        this.progress(this.position || 0);
    }

    progress(position) {
        this.position = position;
        if (this.mode !== 'lyrics' || !this.lyricsState?.synced || this.allLyrics) return;
        const lines = this.lyricsState.lines;
        let index = -1;
        for (let i = 0; i < lines.length && lines[i].time <= position; i++) index = i;
        if (index === this._lyricIndex) return;
        this._lyricIndex = index;
        this.lyricLines.forEach((item, i) => { item.text = lines[index + i - 1]?.text || (i === 1 ? '♪' : ''); });
    }
}
