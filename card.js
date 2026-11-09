import {AgentsView} from './agents-view.js';
import {MediaTools, textControl} from './media-tools.js';
import {CommuteView} from './commute-view.js';
import {WeatherView} from './weather-view.js';
import {HistoryChart} from './charts.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {icon, label, row, column, button, pct, setEnabled, notchToggle} from './widgets.js';
import {formatTime, clampFraction} from './services/format.js';
import {formatCapacity} from './services/proc.js';

// Expanded island content, split into sections. Each section renders its own
// empty state, tolerates a missing service snapshot (module disabled or
// service gone), and the media section disappears entirely when no player
// exists — the card simply starts with the next section.
export class Card {
    constructor(settings, actions) {
        this._settings = settings;
        this._actions = actions;
        this._canSeek = false;
        this._lengthSec = null;
        this._sectionCount = 0;
        this._pages = new Map();
        this._tabs = new Map();
        this._page = null;
        this._manualPage = false;
        this._outputRows = new Map();
        this._deviceRows = new Map();

        this.actor = column('ubuntu-island-container');
        this._scroll = new St.ScrollView({style_class: 'ubuntu-island-scroll', overlay_scrollbars: true, x_expand: true, y_expand: true});
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.actor.add_child(this._scroll);
        this.actor._islandPreferredHeight = width => {
            if (this._page === 'commute')
                this._commuteView.fit(width - this._body.get_theme_node().get_horizontal_padding());
            return 260 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        };
        this._body = column('ubuntu-island-card');
        this._scroll.set_child(this._body);
        this.actor.reactive = true;
        this.actor.x_align = Clutter.ActorAlign.CENTER;
        this.actor.y_align = Clutter.ActorAlign.START;

        if (settings.get_boolean('enable-media')) this._buildMedia();
        if (settings.get_boolean('enable-metrics')) this._buildMetrics();
        if (settings.get_boolean('enable-audio')) this._buildAudio();
        if (settings.get_boolean('enable-bluetooth')) this._buildBluetooth();
        if (settings.get_boolean('enable-weather'))
            this._weatherView = new WeatherView(this._section('WEATHER'), settings, actions);
        this._weatherView?.setViewport(this._scroll);
        if (settings.get_boolean('enable-commute'))
            this._commuteView = new CommuteView(this._section('COMMUTE'), actions, this._scroll);
        if (settings.get_boolean('enable-agents'))
            this._agentsView = new AgentsView(this._section('AGENTS'), settings, actions);
        this.setPillTitleVisible(settings.get_boolean('pill-show-title'));
        this._empty = column('ubuntu-island-empty');
        this._empty.add_child(label(this._sectionCount ? 'Nothing playing' : 'Your island, your way', 'ubuntu-island-track'));
        this._empty.add_child(label(this._sectionCount ? 'Start a track in your music app.' : 'Enable modules in Island preferences.'));
        this._body.add_child(this._empty);
        this._buildNavigation();
        this._syncPages();
        // Hiding the card mid-hover never delivers a leave-event on Wayland,
        // so hover highlights survive into the next expand and read as a
        // second, different selection indicator. Clear them at unmap.
        this.actor.connect('notify::mapped', () => {
            if (!this.actor.mapped) this._clearHover(this.actor);
        });
    }

    _clearHover(actor) {
        actor.remove_style_pseudo_class?.('hover');
        for (let child = actor.get_first_child(); child; child = child.get_next_sibling())
            this._clearHover(child);
    }

    setPillTitleVisible(visible) {
        if (!this._pillTitle) return;
        this._pillTitle.child.icon_name = visible
            ? 'view-reveal-symbolic' : 'view-conceal-symbolic';
        this._pillTitle.set_style_class_name(`ubuntu-island-title-toggle${visible ? '' : ' ubuntu-island-title-hidden'}`);
        this._pillTitle.accessible_name = visible
            ? 'Hide the track name in the notch' : 'Show the track name in the notch';
    }

    // Shared heading and content spacing for each module.
    _section(title) {
        this._sectionCount++;
        const box = column('ubuntu-island-section-box');
        const header = row('ubuntu-island-section-heading');
        const heading = label(title, 'ubuntu-island-header');
        heading.x_expand = true;
        header.add_child(heading);
        box.add_child(header);
        const content = column('ubuntu-island-section');
        box.add_child(content);
        this._body.add_child(box);
        const id = {'NOW PLAYING': 'media', SYSTEM: 'system', SOUND: 'audio', BLUETOOTH: 'bluetooth', WEATHER: 'weather', COMMUTE: 'commute', AGENTS: 'agents'}[title];
        const page = {box, header, content, available: true};
        this._pages.set(id, page);
        const setVisible = visible => {
            page.available = visible;
            this._syncPages();
        };
        return {box, header, content, setVisible};
    }

    _buildNavigation() {
        const navigation = row('ubuntu-island-navigation');
        const items = [
            ['media', 'audio-x-generic-symbolic', 'Now playing'],
            ['system', 'org.gnome.SystemMonitor-symbolic', 'System'],
            ['audio', 'audio-volume-high-symbolic', 'Sound'],
            ['bluetooth', 'bluetooth-symbolic', 'Bluetooth'],
            ['weather', 'weather-clear-symbolic', 'Weather'],
            ['commute', 'find-location-symbolic', 'Commute'],
            ['agents', 'system-run-symbolic', 'Agents'],
        ];
        for (const [id, glyph, title] of items) {
            if (!this._pages.has(id)) continue;
            const tab = button(glyph, title, () => this.selectPage(id), 15, 'ubuntu-island-tab');
            // Keep the glyph centered on the same axis as the caption and
            // preferences icon; the selection marker must not shift it upward.
            const face = new St.Widget({style_class: 'ubuntu-island-tab-face',
                layout_manager: new Clutter.BinLayout()});
            const glyphActor = icon(glyph, 15);
            glyphActor.x_align = Clutter.ActorAlign.CENTER;
            glyphActor.y_align = Clutter.ActorAlign.CENTER;
            face.add_child(glyphActor);
            face.add_child(new St.Widget({style_class: 'ubuntu-island-tab-marker',
                x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END}));
            tab.set_child(face);
            tab.accessible_role = Atk.Role.PAGE_TAB;
            navigation.add_child(tab);
            this._tabs.set(id, tab);
        }
        const spacer = new St.Widget({x_expand: true});
        this._pageCaption = label('', 'ubuntu-island-source');
        navigation.add_child(this._pageCaption);
        navigation.add_child(spacer);
        navigation.add_child(button('emblem-system-symbolic', 'Island preferences',
            () => this._actions.preferences(), 14, 'ubuntu-island-tab'));
        this.actor.add_child(navigation);
    }

    selectExpansionPage() {
        const preferred = this._settings.get_string('expand-tab');
        if (preferred === 'last') return;
        // A fixed-tab choice should not be overridden by a player appearing later.
        this._manualPage = true;
        // selectPage already preserves the last available page if the target is absent.
        this.selectPage(preferred);
    }

    selectPage(id) {
        if (!this._pages.get(id)?.available) return;
        this._manualPage = true;
        this._page = id;
        this._syncPages();
        this._actions.relayout?.();
    }

    _syncPages() {
        if (!this._pages.get(this._page)?.available)
            this._page = [...this._pages].find(([, page]) => page.available)?.[0] ?? null;
        for (const [id, page] of this._pages) {
            page.box.visible = page.available && id === this._page;
            const tab = this._tabs.get(id);
            if (!tab) continue;
            tab.visible = page.available;
            if (id === this._page) {
                tab.add_style_pseudo_class('checked');
                tab.add_style_class_name('ubuntu-island-tab-selected');
                tab.add_accessible_state(Atk.StateType.SELECTED);
            } else {
                tab.remove_style_pseudo_class('checked');
                tab.remove_style_class_name('ubuntu-island-tab-selected');
                tab.remove_accessible_state(Atk.StateType.SELECTED);
            }
        }
        if (this._pageCaption)
            this._pageCaption.text = {media: 'Now playing', system: 'System', audio: 'Sound', bluetooth: 'Bluetooth', weather: 'Weather', commute: 'Commute', agents: 'Agents'}[this._page] ?? '';
        this._body.set_style_class_name(`ubuntu-island-card${this._page === 'media' ? ' ubuntu-island-card-media' : this._page === 'system' ? ' ubuntu-island-card-system' : this._page === 'weather' ? ' ubuntu-island-card-weather' : this._page === 'commute' ? ' ubuntu-island-card-commute' : this._page === 'agents' ? ' ubuntu-island-card-agents' : ''}`);
        if (this._pages.has('agents')) this.actor.add_style_class_name('ubuntu-island-with-agents');
        this.updateMediaTint();
        if (this._empty) this._empty.visible = !this._page;
        if (this._page !== 'media' && this._mediaTools?.mode)
            this._mediaTools.show(null);
        this._actions.pageChanged?.(this._page);
    }

    _buildMedia() {
        this._mediaSection = this._section('NOW PLAYING');
        this._mediaSection.header.hide();
        const content = column('ubuntu-island-media-main');
        this._mediaSection.content.add_child(content);

        const music = row('ubuntu-island-media-row');
        this._cover = new St.Bin({
            style_class: 'ubuntu-island-cover',
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cover.set_child(icon('audio-x-generic-symbolic', 28));
        music.add_child(this._cover);

        const details = column('ubuntu-island-media-details');
        details.x_expand = true;
        const sourceRow = row('ubuntu-island-media-source-row');
        this._source = label('PLAYER', 'ubuntu-island-source');
        this._playerPicker = new St.Button({style_class: 'ubuntu-island-player-picker', can_focus: true, reactive: true, track_hover: true, x_expand: true});
        const sourceFace = row('ubuntu-island-media-source-row');
        sourceFace.x_expand = true;
        this._source.x_expand = true;
        sourceFace.add_child(this._source);
        sourceFace.add_child(icon('pan-down-symbolic', 10));
        this._playerPicker.set_child(sourceFace);
        this._playerPicker.connect('clicked', () => this._mediaTools.show('players', this._playerPicker));
        sourceRow.add_child(this._playerPicker);
        details.add_child(sourceRow);
        this._track = label('', 'ubuntu-island-track');
        this._artist = label('', 'ubuntu-island-artist');
        const titleRow = row('ubuntu-island-title-row');
        this._track.x_expand = true;
        titleRow.add_child(this._track);
        details.add_child(titleRow);
        details.add_child(this._artist);
        const controls = row('ubuntu-island-transport');
        this._shuffle = button('media-playlist-shuffle-symbolic', 'Shuffle', () => this._actions.mediaProperty('Shuffle', !this._mediaState.shuffle), 14, 'ubuntu-island-media-mode');
        controls.add_child(this._shuffle);
        this._previous = button('media-skip-backward-symbolic', 'Previous track',
            () => this._actions.mediaCommand('Previous'), 16, 'ubuntu-island-ghost');
        this._play = new St.Button({
            style_class: 'ubuntu-island-seal', can_focus: true, reactive: true, track_hover: true,
            accessible_name: 'Play or pause',
        });
        this._play.set_child(icon('media-playback-start-symbolic', 15));
        this._play.connect('clicked', () => this._actions.mediaCommand('PlayPause'));
        this._next = button('media-skip-forward-symbolic', 'Next track',
            () => this._actions.mediaCommand('Next'), 16, 'ubuntu-island-ghost');
        controls.add_child(this._previous);
        controls.add_child(this._play);
        controls.add_child(this._next);
        this._repeat = button('media-playlist-repeat-symbolic', 'Repeat', () => {
            const order = ['None', 'Playlist', 'Track'];
            this._actions.mediaProperty('LoopStatus', order[(order.indexOf(this._mediaState.loopStatus) + 1) % order.length]);
        }, 14, 'ubuntu-island-media-mode');
        controls.add_child(this._repeat);
        // Quick control for the collapsed notch: hide the track name and keep
        // just the play state icon (middle-clicking the notch does the same).
        this._pillTitle = button('view-reveal-symbolic',
            'Hide the track name in the notch',
            () => this._actions.togglePillTitle?.(), 14, 'ubuntu-island-title-toggle');
        sourceRow.add_child(this._pillTitle);
        details.add_child(controls);
        music.add_child(details);
        content.add_child(music);

        const progress = row('ubuntu-island-progress-row');
        this._elapsed = label('0:00', 'ubuntu-island-time');
        this._progressTrack = new Slider.Slider(0);
        this._progressTrack.x_expand = true;
        this._progressTrack.accessible_name = 'Track position';
        this._updatingProgress = false;
        this._draggingProgress = false;
        this._progressTrack.connect('drag-begin', () => {
            this._draggingProgress = true;
            this._seekIdentity = this._mediaIdentity;
        });
        this._progressTrack.connect('drag-end', () => {
            this._draggingProgress = false;
            if (this._canSeek && this._lengthSec && this._seekIdentity === this._mediaIdentity) {
                this._elapsed.text = formatTime(this._progressTrack.value * this._lengthSec);
                this._actions.seek(this._progressTrack.value * this._lengthSec);
            } else this.renderProgress(this._mediaState?.positionSec);
        });
        this._progressTrack.connect('notify::value', () => {
            if (this._updatingProgress || !this._canSeek || !this._lengthSec) return;
            if (this._draggingProgress && this._seekIdentity !== this._mediaIdentity) return;
            const target = this._progressTrack.value * this._lengthSec;
            this._elapsed.text = formatTime(target);
            this._mediaTools?.progress(target);
            if (!this._draggingProgress) this._actions.seek(target);
        });
        progress.add_child(this._elapsed);
        progress.add_child(this._progressTrack);
        this._total = label('–:––', 'ubuntu-island-time');
        progress.add_child(this._total);
        content.add_child(progress);
        const tools = row('ubuntu-island-media-toolbar');
        const addTool = (glyph, title, mode) => {
            const control = button(glyph, title, () => this._mediaTools.show(mode, control), 15, 'ubuntu-island-media-mode');
            tools.add_child(control);
            return control;
        };
        this._lyricsButton = addTool('media-view-subtitles-symbolic', 'Lyrics', 'lyrics');
        this._queueButton = addTool('view-list-bullet-symbolic', 'Up next', 'queue');
        this._soundButton = addTool('audio-volume-high-symbolic', 'Volume and sound output', 'sound');
        this._soundButton.visible = this._settings.get_boolean('enable-audio');
        tools.add_child(new St.Widget({x_expand: true}));
        this._seekBack = textControl('−10s', () => this._seekOffset(-10), 'ubuntu-island-media-seek');
        this._seekForward = textControl('+10s', () => this._seekOffset(10), 'ubuntu-island-media-seek');
        this._seekBack.x_expand = this._seekForward.x_expand = false;
        this._seekBack.accessible_name = 'Seek backward ten seconds';
        this._seekForward.accessible_name = 'Seek forward ten seconds';
        tools.add_child(this._seekBack);
        tools.add_child(this._seekForward);
        this._openPlayer = button('focus-windows-symbolic', 'Open player', () => this._actions.raisePlayer(), 15, 'ubuntu-island-media-mode');
        tools.add_child(this._openPlayer);
        content.add_child(tools);
        this._mediaError = label('', 'ubuntu-island-error');
        this._mediaError.hide();
        this._mediaTools = new MediaTools(this, this._mediaSection.content, content, this._actions);
        this._mediaSection.content.add_child(this._mediaError);

        // Hidden until a player shows up.
        this._mediaSection.setVisible(false);
    }

    _buildMetrics() {
        const section = this._section('SYSTEM');
        section.box.add_style_class_name('ubuntu-island-system-section');
        section.content.add_style_class_name('ubuntu-island-system-content');
        const metrics = row('ubuntu-island-metrics');
        const tile = name => {
            const box = column('ubuntu-island-metric ubuntu-island-history-tile');
            box.x_expand = true;
            const heading = row('ubuntu-island-metric-heading');
            const title = label(name, 'ubuntu-island-metric-name', false);
            title.x_expand = true;
            heading.add_child(title);
            const value = label('—', 'ubuntu-island-metric-value', false);
            value.x_align = Clutter.ActorAlign.END;
            heading.add_child(value);
            // Honor enlarged text: keep the name and secondary value together,
            // moving only the percentage below when one line cannot fit.
            const fit = () => {
                if (heading.width <= 0) return;
                const needed = title.get_preferred_width(-1)[1] + value.get_preferred_width(-1)[1]
                    + heading.get_theme_node().get_length('spacing');
                const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                // Child minimum widths can already exceed the scroll viewport.
                // Use the fixed card width, not that oversized child allocation.
                const available = (this.actor.width
                    - this._body.get_theme_node().get_horizontal_padding()
                    - metrics.get_theme_node().get_length('spacing')) / 2
                    - box.get_theme_node().get_horizontal_padding() - 2 * scale;
                heading.vertical = needed > available;
            };
            heading.connect('notify::width', fit);
            box.add_child(heading);
            const chart = new HistoryChart();
            box.add_child(chart.actor);
            metrics.add_child(box);
            return {value, title, chart, fit};
        };
        this._cpu = tile('CPU');
        this._ram = tile('MEMORY');
        section.content.add_child(metrics);
        const network = column('ubuntu-island-metric ubuntu-island-history-tile');
        const rates = row('ubuntu-island-network-rates');
        this._rx = label('↓ —', 'ubuntu-island-network-down');
        this._rx.x_expand = true;
        this._tx = label('↑ —', 'ubuntu-island-network-up');
        rates.add_child(this._rx);
        rates.add_child(this._tx);
        rates.add_child(notchToggle(this._settings, 'pill-show-network', 'network rates'));
        network.add_child(rates);
        this._networkChart = new HistoryChart(true);
        network.add_child(this._networkChart.actor);
        section.content.add_child(network);
        this._iface = label('Network: detecting…', 'ubuntu-island-source');
        section.content.add_child(this._iface);
    }

    _buildAudio() {
        const section = this._section('SOUND');
        const volumeRow = row('ubuntu-island-volume');
        this._mute = button('audio-volume-high-symbolic', 'Mute or unmute output',
            () => this._actions.toggleMute(), 16, 'ubuntu-island-ghost');
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
        section.content.add_child(volumeRow);

        this._outputs = column('ubuntu-island-outputs');
        this._outputStatus = label('Detecting audio outputs…');
        section.content.add_child(this._outputStatus);
        section.content.add_child(this._outputs);
    }

    _buildBluetooth() {
        const section = this._section('BLUETOOTH');
        const heading = section.header;
        this._power = button('bluetooth-disabled-symbolic', 'Toggle Bluetooth power',
            () => this._actions.btPower(), 15, 'ubuntu-island-ghost');
        this._power.visible = false;
        heading.add_child(this._power);
        heading.add_child(button('emblem-system-symbolic', 'Open Bluetooth Settings',
            () => Util.spawn(['gnome-control-center', 'bluetooth']), 15, 'ubuntu-island-ghost'));
        this._btStatus = label('Detecting Bluetooth…');
        section.content.add_child(this._btStatus);
        this._btError = label('', 'ubuntu-island-error');
        this._btError.hide();
        section.content.add_child(this._btError);
        this._devices = column('ubuntu-island-devices');
        section.content.add_child(this._devices);
    }

    renderMedia(state) {
        if (!this._mediaSection) return;
        const available = Boolean(state?.available);
        const wasAvailable = this._pages.get('media').available;
        if (available && !wasAvailable && !this._manualPage) this._page = 'media';
        // With no player the whole section is gone, not an empty placeholder.
        this._mediaSection.setVisible(available);
        if (!available) {
            if (this._mediaTools?.mode) this._mediaTools.show(null);
            return;
        }
        this._mediaState = state;
        this._mediaIdentity = JSON.stringify([state.playerId || state.playerName,
            state.trackRevision ?? state.trackId ?? '', state.title]);
        this._track.text = String(state.title ?? 'Unknown title');
        this._artist.text = String(state.artist ?? '');
        this._artist.visible = Boolean(this._artist.text);
        this._source.text = String(state.playerName || 'Player');
        if (this._playerPicker) this._playerPicker.accessible_name = `Choose player, ${state.playerName}${state.pinned ? ', pinned' : ', automatic'}`;
        if (this._shuffle) {
            this._shuffle.visible = typeof state.shuffle === 'boolean';
            this._repeat.visible = state.loopStatus != null;
            this._mediaTools._checked(this._shuffle, state.shuffle);
            this._mediaTools._checked(this._repeat, state.loopStatus && state.loopStatus !== 'None');
            this._shuffle.accessible_name = state.shuffle ? 'Turn shuffle off' : 'Turn shuffle on';
            this._repeat.child.icon_name = state.loopStatus === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
            this._repeat.accessible_name = `Repeat: ${{None: 'off', Playlist: 'all', Track: 'one'}[state.loopStatus] || 'unavailable'}`;
            setEnabled(this._shuffle, state.canControl && !state.pending?.includes('Shuffle'));
            setEnabled(this._repeat, state.canControl && !state.pending?.includes('LoopStatus'));
            this._openPlayer.visible = Boolean(state.canRaise);
            this._seekBack.visible = this._seekForward.visible = Boolean(state.canSeek && state.lengthSec);
            this._mediaError.text = state.error || '';
            this._mediaError.visible = Boolean(state.error);
            this._mediaTools.renderMedia(state);
        }
        this._play.child.icon_name = state.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.accessible_name = state.status === 'Playing' ? 'Pause' : 'Play';
        setEnabled(this._play, state.canPlayPause ?? state.canControl);
        setEnabled(this._previous, state.canPrevious);
        setEnabled(this._next, state.canNext);
        this._canSeek = Boolean(state.canSeek);
        this._lengthSec = Number.isFinite(state.lengthSec) && state.lengthSec > 0 ? state.lengthSec : null;
        // Render the position from this update, not a zero placeholder that
        // remains visible until the next progress timer tick.
        this.renderProgress(state.positionSec);
    }

    _seekOffset(seconds) {
        if (!this._canSeek || !this._lengthSec) return;
        const target = Math.max(0, Math.min(this._lengthSec, this._progressTrack.value * this._lengthSec + seconds));
        this.renderProgress(target);
        this._actions.seek(target);
    }

    renderArt(content) {
        this._mediaAccent = content?._islandAccent;
        this.updateMediaTint();
        this._cover?.set_child(content
            ? new St.Widget({content, style_class: 'ubuntu-island-artwork',
                content_gravity: Clutter.ContentGravity.RESIZE_ASPECT})
            : icon('audio-x-generic-symbolic', 28));
    }

    updateMediaTint() {
        const accent = this._mediaAccent;
        const rgb = Array.isArray(accent) && accent.length === 3 ? accent.map(v => Math.max(0, Math.min(255, Math.round(v)))) : [120, 135, 158];
        const alpha = 0.15 * this._settings.get_int('surface-opacity') / 100;
        this._scroll.set_style(this._page === 'media' ? `border-radius: 19px 19px 0 0; background-gradient-direction: horizontal; background-gradient-start: rgba(${rgb.join(',')},${alpha}); background-gradient-end: rgba(${rgb.join(',')},0);` : '');
    }

    renderProgress(positionSec) {
        if (!this._progressTrack) return;
        const total = this._lengthSec;
        const position = Number.isFinite(positionSec) ? Math.max(0, Math.min(total ?? Infinity, positionSec)) : null;
        const draggingCurrent = this._draggingProgress && this._seekIdentity === this._mediaIdentity;
        const displayed = draggingCurrent && total ? clampFraction(this._progressTrack.value) * total : position ?? 0;
        this._elapsed.text = formatTime(displayed);
        this._mediaTools?.progress(displayed);
        this._total.text = formatTime(total);
        const fraction = total && position != null ? clampFraction(position / total) : 0;
        // Keep the thumb under the pointer while a seek is being dragged.
        if (!draggingCurrent) {
            this._updatingProgress = true;
            this._progressTrack.value = fraction;
            this._updatingProgress = false;
        }
        setEnabled(this._progressTrack, this._canSeek && total);
    }

    renderSystem(state) {
        if (!this._cpu || !state) return;
        // Percentages stay the primary figures; load and used memory ride
        // along on the heading line without redundant words.
        this._cpu.value.text = pct(state.cpu);
        const load = Number.isFinite(state.loadAvg) ? state.loadAvg.toFixed(2) : '';
        const used = state.memoryUsed == null ? '' : formatCapacity(state.memoryUsed);
        this._cpu.title.clutter_text.set_markup(`CPU <span size="smaller" weight="normal">${load}</span>`);
        this._ram.title.clutter_text.set_markup(`MEMORY <span size="smaller" weight="normal">${used}</span>`);
        this._ram.value.text = pct(state.memory);
        this._cpu.fit();
        this._ram.fit();
        this._cpu.value.accessible_name = state.cpu == null
            ? 'CPU usage unavailable' : `CPU usage ${Math.round(state.cpu)} percent`;
        this._cpu.title.accessible_name = state.loadAvg == null
            ? 'Load average unavailable' : `1-minute load average ${state.loadAvg.toFixed(2)}`;
        this._ram.title.accessible_name = state.memoryUsed == null
            ? 'Memory usage unavailable' : `Memory used ${formatCapacity(state.memoryUsed)}`;
        this._rx.text = `↓ ${state.rx ?? '—'}`;
        this._tx.text = `↑ ${state.tx ?? '—'}`;
        this._cpu.chart.push(state.cpu);
        this._ram.chart.push(state.memory);
        if (this._networkIface !== state.iface) this._networkChart.clear();
        this._networkIface = state.iface;
        this._networkChart.push(state.rxBytes, state.txBytes);
        this._rx.accessible_name = `Download ${state.rx ?? 'unavailable'}`;
        this._tx.accessible_name = `Upload ${state.tx ?? 'unavailable'}`;
        this._iface.text = `${state.iface ?? 'Network unavailable'} · ${60 * this._settings.get_int('metrics-interval')}s history`;

    }

    renderAudio(state) {
        this._mediaTools?.renderAudio(state);
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
        setEnabled(this._mute, state.available);
        setEnabled(this._slider, state.available);
        this._mute.accessible_name = state.muted ? 'Unmute output' : 'Mute output';
        const outputs = state.available ? state.outputs ?? [] : [];
        this._outputStatus.text = !state.available ? 'Sound output unavailable'
            : outputs.length ? '' : 'No output devices found';
        this._outputStatus.visible = Boolean(this._outputStatus.text);
        const ids = new Set(outputs.map(output => output.id));
        for (const [id, item] of this._outputRows) {
            if (!ids.has(id)) { item.destroy(); this._outputRows.delete(id); }
        }
        for (const [index, output] of outputs.entries()) {
            let item = this._outputRows.get(output.id);
            if (!item) {
                item = new St.Button({can_focus: true, reactive: true, track_hover: true, x_expand: true});
                const content = row('ubuntu-island-output-row');
                content.x_expand = true;
                content.add_child(icon('audio-speakers-symbolic', 16));
                const text = label('', 'ubuntu-island-output-label');
                text.x_expand = true;
                content.add_child(text);
                const check = icon('object-select-symbolic', 16);
                content.add_child(check);
                item.set_child(content);
                item._name = text;
                item._check = check;
                item.connect('clicked', () => this._actions.selectOutput(output.id));
                this._outputs.add_child(item);
                this._outputRows.set(output.id, item);
            }
            item.set_style_class_name(
                `ubuntu-island-output${output.active ? ' ubuntu-island-output-active' : ''}`);
            item._name.text = String(output.name ?? 'Audio output');
            item._check.opacity = output.active ? 255 : 0;
            item.accessible_name = `${output.active ? 'Active output:' : 'Switch to'} ${output.name}`;
            if (this._outputs.get_child_at_index(index) !== item)
                this._outputs.set_child_at_index(item, index);
        }
    }

    renderBluetooth(state) {
        if (!this._btStatus || !state) return;
        const devices = state.devices ?? [];
        const connected = devices.filter(d => d.connected).length;
        this._btStatus.text = !state.available ? 'Bluetooth service unavailable'
            : !state.hasAdapter ? 'No Bluetooth adapter found'
            : !state.powered ? 'Bluetooth is off · turn it on to connect'
            : !devices.length ? 'No paired devices · open Bluetooth Settings'
            : `${connected} connected · ${devices.length} paired`;
        this._power.visible = Boolean(state.available && state.hasAdapter);
        this._power.child.icon_name = state.powered
            ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        this._power.accessible_name = state.powered ? 'Turn Bluetooth off' : 'Turn Bluetooth on';
        setEnabled(this._power, !state.powerPending);
        this._btError.text = state.error ?? '';
        this._btError.visible = Boolean(state.error);
        const visibleDevices = state.powered ? devices : [];
        const paths = new Set(visibleDevices.map(device => device.path));
        for (const [path, item] of this._deviceRows) {
            if (!paths.has(path)) { item.destroy(); this._deviceRows.delete(path); }
        }
        for (const [index, device] of visibleDevices.entries()) {
            let item = this._deviceRows.get(device.path);
            if (!item) {
                item = new St.Button({can_focus: true, reactive: true, track_hover: true, x_expand: true});
                const content = row('ubuntu-island-device');
                content.x_expand = true;
                content.add_child(icon('bluetooth-symbolic', 16));
                const details = column();
                details.x_expand = true;
                item._name = label('', 'ubuntu-island-device-name');
                item._status = label('', 'ubuntu-island-device-status');
                details.add_child(item._name);
                details.add_child(item._status);
                content.add_child(details);
                item._action = label('', 'ubuntu-island-device-action');
                content.add_child(item._action);
                item.set_child(content);
                item.connect('clicked', () => this._actions.btToggle(item._device));
                this._devices.add_child(item);
                this._deviceRows.set(device.path, item);
            }
            item._device = device;
            item.set_style_class_name('ubuntu-island-device-button');
            item._name.text = String(device.name ?? 'Bluetooth device');
            item._status.text = `${device.connected ? 'Connected' : 'Not connected'}${device.battery == null ? '' : ` · ${device.battery}% battery`}`;
            item._action.text = device.pending ? 'Working…' : device.connected ? 'Disconnect' : 'Connect';
            item.accessible_name = `${item._action.text} ${device.name}, ${item._status.text}`;
            setEnabled(item, !device.pending);
            if (this._devices.get_child_at_index(index) !== item)
                this._devices.set_child_at_index(item, index);
        }
    }
}
