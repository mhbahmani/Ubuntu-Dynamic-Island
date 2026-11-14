import {AgentsService} from './services/agents.js';
import {CalendarEventsService} from './services/calendar-events.js';
import {eventQueryRanges, upcomingEvents, validateMeetUri} from './services/calendar-events-model.js';
import {AgentWindows} from './services/agent-windows.js';
import {launchAgent, initializeAgentSettings} from './services/agent-launch.js';
import {AGENTS, AGENT_STATES, agentNotificationNeeded} from './services/agents-model.js';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {LyricsService} from './services/lyrics.js';
import {migrateArrowStyle, migrateOfflineMode} from './services/notch-model.js';
import {migrateCalendarSettings, migrateNotchDates, todayDay} from './services/calendar-model.js';
import {CommuteService} from './services/commute.js';
import {WeatherService} from './services/weather.js';
import {NotificationsService} from './services/notifications.js';
import {PEEK_MS, shouldPeek} from './services/notifications-model.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {IslandSurface, IslandState} from './ui/island.js';
import {IslandBackdrop} from './ui/backdrop.js';
import {Pill} from './ui/pill.js';
import {Card} from './ui/card.js';
import {SystemMonitor} from './services/system.js';
import {ConnectivityService} from './services/connectivity.js';
import {MediaService} from './services/media.js';
import {BluetoothService} from './services/bluetooth.js';
import {AudioService} from './services/audio.js';
import {ArtLoader} from './services/art.js';
import {surfaceStyle} from './services/appearance.js';
import {layoutSignature} from './services/presentation.js';

const QUICK_ASK_SHORTCUT = 'island-quick-ask-shortcut';
const ISLAND_SHORTCUTS = ['island-toggle-shortcut', 'island-next-tab-shortcut', 'island-previous-tab-shortcut'];

export default class UbuntuIsland extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._enabled = true;
        this._settings = this.getSettings();
        migrateArrowStyle(this._settings);
        migrateOfflineMode(this._settings);
        migrateCalendarSettings(this._settings);
        migrateNotchDates(this._settings);
        initializeAgentSettings(this._settings);
        this._states = {};
        this._progressTimer = 0;
        this._settingsIds = [];
        this._layoutSignature = '';
        this._pillMinimum = -1;

        if (this._settings.get_boolean('move-clock')) this._moveCalendar();

        this._pill = new Pill(() => this._island?.toggle(), () => this._togglePillTitle(), () => this._renderPill(), () => this._openUpcomingEvent());
        this._card = new Card(this._settings, {
            agentOpen: session => this._openAgent(session),
            agentWindow: session => this._agentWindows?.resolve(session),
            agentVisibility: active => { this._agentWindows?.setActive(active); this._agents?.setTitlesVisible?.(active); },
            agentExpire: () => this._expireAgents(),
            agentAsk: input => this._askAgent(input),
            closeQuickAsk: () => this._leaveAgents(),
            agentControl: value => this._agentControl(value),
            calendarRangeChanged: () => this._syncCalendarEvents(),
            calendarOpen: (day,uri) => this._openCalendar(day,uri),
            calendarFocusReady: () => this._island?.state === IslandState.EXPANDED,
            mediaCommand: method => this._media?.command(method),
            selectPlayer: id => this._media?.select(id),
            mediaProperty: (key, value) => this._media?.setProperty(key, value),
            raisePlayer: () => this._media?.raise(),
            playTrack: id => this._media?.playTrack(id),
            mediaViewChanged: () => { this._syncMediaViews(); this._syncProgressTimer(); },
            retryLyrics: () => { this._lyrics?.cancel(); this._syncMediaViews(); },
            seek: seconds => this._media?.seek(seconds),
            setVolume: value => this._audio?.setVolume(value),
            toggleMute: () => this._audio?.toggleMute(),
            selectOutput: id => this._audio?.selectOutput(id),
            btToggle: device => this._bluetooth?.toggle(device),
            btPower: () => this._bluetooth?.setPowered(!this._states.bluetooth?.powered),
            preferences: page => { if (page) this._settings.set_string('preferences-page', page); this._openPreferencesLive(); },
            commuteNext: () => this._commute?.next(),
            commuteSwap: () => this._commute?.swap(),
            commuteRefresh: () => this._commute?.refresh(),
            commuteProvider: id => this._commute?.selectProvider(id),
            commuteFallback: enabled => this._settings.set_boolean('commute-fallback', enabled),
            commuteUseSavedStart: () => this._commute?.useSavedStart(),
            togglePillTitle: () => this._togglePillTitle(),
            relayout: () => this._island?.relayout(),
            weatherRefresh: () => this._weather?.refresh(),
            notificationsActivate: id => { this._island?.collapse(); this._notifications?.activate(id); },
            notificationsInvoke: (id, index) => { this._island?.collapse(); this._notifications?.invoke(id, index); },
            notificationsDismiss: ids => this._notifications?.dismiss(ids),
            notificationsClear: () => this._notifications?.clear(),
            notificationsDoNotDisturb: enabled => this._notifications?.setDoNotDisturb(enabled),
            pageChanged: () => { this._syncWeather(); this._syncMediaViews(); this._syncProgressTimer(); this._syncCalendarEvents(); this._syncNotificationsSeen(); },
        });
        this._island = new IslandSurface({
            settings: this._settings,
            pill: this._pill.actor,
            card: this._card.actor,
            backdrop: new IslandBackdrop(),
            onBeforeExpand: () => {
                if (this._card.quickAskOpen) return;
                // Opening during a notification peek shows that notification.
                if (this._pill.peeking && this._card._pages.has('notifications')) this._card.selectPage('notifications', false);
                else this._card.selectExpansionPage();
            },
            onSwitchTab: direction => this._card.cyclePage(direction),
            onEscape: () => !this._card.quickAskOpen && this._card._page === 'agents' && this._card._agentsView.handleEscape(),
            onStateChange: () => { if (this._island?.expanded) this._pill.endPeek(false); this._syncProgressTimer(); this._renderPill(); this._syncWeather(); this._syncMediaViews(); this._syncCalendarEvents(); this._syncNotificationsSeen(); },
        });
        this._island.setHoverEnabled(
            this._settings.get_boolean('hover-open'),
            this._settings.get_int('hover-open-delay'),
            this._settings.get_int('hover-close-delay'));
        this._card.actor.connect('notify::mapped', () => { this._syncWeather(); this._syncMediaViews(); this._syncProgressTimer(); });
        this._island.actor.connect('notify::mapped', () => { this._syncWeather(); this._syncMediaViews(); this._syncProgressTimer(); this._syncCalendarEvents(); });
        this._calendarEvents = new CalendarEventsService(this.path,state => this._renderCalendarEvents(state));
        this._calendarSessionSignal = Main.sessionMode.connect('updated', () => this._syncCalendarEvents());
        this._watchSettings();
        this._bindQuickAsk();
        this._bindIslandShortcuts();
        this._applyAppearance();
        this._syncCalendarEvents();

        // Model events drive isolated UI updates; no UI code in the services.
        if (this._settings.get_boolean('enable-media')) {
            this._art = new ArtLoader();
            this._media = new MediaService(state => this._renderMedia(state), state => this._card?._mediaTools?.renderQueue(state));
            this._lyrics = new LyricsService(state => this._card?._mediaTools?.renderLyrics(state));
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

        if (this._settings.get_boolean('enable-weather')) {
            this._weather = new WeatherService(this._settings, state => {
                if (!this._enabled) return;
                this._states.weather = state;
                this._card._weatherView?.render(state);
                this._renderPill();
            });
            this._settingsIds.push(this._settings.connect('changed::weather-units', () =>
                this._card._weatherView?.render(this._states.weather)));
        }

        if (this._settings.get_boolean('enable-commute'))
            this._commute = new CommuteService(this._settings, state => {
                if (!this._enabled) return;
                this._states.commute = state;
                this._card._commuteView?.render(state);
                this._renderPill();
            });
        if (this._settings.get_boolean('enable-agents')) {
            this._agentWindows = new AgentWindows(() => this._card?._agentsView?.render(this._states.agents));
            this._agentWindows.setActive(Boolean(this._card._agentsView?.actor.mapped));
            this._agents = new AgentsService(this.path, state => this._renderAgents(state));
            this._agents.setTitlesVisible(Boolean(this._card._agentsView?.actor.mapped));
            this._agents.start();
        }
        if (this._settings.get_boolean('enable-notifications')) {
            this._notifications = new NotificationsService(state => this._renderNotifications(state),
                item => this._peekNotification(item));
            this._notifications.start();
        }
        this._connectivity = new ConnectivityService(state => this._renderConnectivity(state));
        this._connectivity.start();
        this._island.show();
        this._renderPill();
        this._syncWeather();
        this._system?.start();
        this._media?.start();
        this._bluetooth?.start();
        this._audio?.start();
    }

    // Preferences open beside the island instead of closing it, so changes
    // are visible in real time. The island suspends its input grab while the
    // settings window exists (the grab would block that window) and resumes
    // normal outside-click/Escape dismissal once it closes.
    _openPreferencesLive() {
        this._island?.suspendGrab();
        if (this._prefsWindow) {
            this._prefsWindow.activate(global.get_current_time());
            return;
        }
        if (this._prefsWatch) return; // A launch is already pending.
        this._watchPreferencesWindow();
        try {
            Promise.resolve(this.openPreferences()).catch(error => {
                if (!this._enabled) return;
                console.warn(`[Ubuntu Island] preferences: ${error.message}`);
                this._endPreferencesWatch();
            });
        } catch (error) {
            this._endPreferencesWatch();
            console.warn(`[Ubuntu Island] preferences: ${error.message}`);
        }
    }

    _watchPreferencesWindow() {
        const watch = {created: 0, unmanaged: 0, timeout: 0, candidates: new Map()};
        this._prefsWatch = watch;
        const inspect = window => {
            if (this._prefsWatch !== watch || this._prefsWindow) return;
            // Titles can be unset at window-created. Wait for their updates,
            // and never capture unrelated Settings or extension windows.
            if (window.get_title() !== this.metadata.name) return;
            this._prefsWindow = window;
            if (watch.timeout) GLib.Source.remove(watch.timeout);
            watch.timeout = 0;
            watch.unmanaged = window.connect('unmanaged', () => this._endPreferencesWatch());
        };
        const observe = window => {
            if (watch.candidates.has(window)) return;
            const signals = [window.connect('notify::title', () => inspect(window))];
            signals.push(window.connect('unmanaged', () => {
                for (const id of signals) window.disconnect(id);
                watch.candidates.delete(window);
            }));
            watch.candidates.set(window, signals);
            inspect(window);
        };
        watch.created = global.display.connect('window-created', (display, window) => observe(window));
        watch.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            watch.timeout = 0;
            if (this._prefsWatch === watch && !this._prefsWindow) this._endPreferencesWatch();
            return GLib.SOURCE_REMOVE;
        });
        for (const actor of global.get_window_actors()) observe(actor.meta_window);
    }

    _endPreferencesWatch() {
        this._disposePreferencesWatch();
        this._island?.resumeGrab();
    }

    _disposePreferencesWatch() {
        const watch = this._prefsWatch;
        const window = this._prefsWindow;
        this._prefsWatch = null;
        this._prefsWindow = null;
        if (!watch) return;
        if (watch.created) global.display.disconnect(watch.created);
        if (watch.timeout) GLib.Source.remove(watch.timeout);
        if (window && watch.unmanaged) window.disconnect(watch.unmanaged);
        for (const [candidate, signals] of watch.candidates)
            for (const id of signals) candidate.disconnect(id);
        watch.candidates.clear();
    }

    _watchSettings() {
        const watch = (key, handler) =>
            this._settingsIds.push(this._settings.connect(`changed::${key}`, handler));
        watch(QUICK_ASK_SHORTCUT, () => this._bindQuickAsk());
        for (const key of ISLAND_SHORTCUTS) watch(key, () => this._bindIslandShortcuts());
        watch('pill-show-title', () => {
            this._renderPill();
            this._card.setPillTitleVisible(this._settings.get_boolean('pill-show-title'));
        });
        for (const key of ['pill-title-mode', 'pill-title-characters', 'disable-animations', 'pill-show-weather', 'pill-show-agents', 'pill-show-notifications', 'pill-show-network', 'pill-show-commute', 'pill-offline-mode', 'weather-units', 'pill-order', 'pill-arrow-style', 'pill-weather-style', 'pill-arrow-angle'])
            watch(key, () => { this._renderPill(); this._syncWeather(); });
        watch('color-theme', () => this._applyAppearance());
        for (const key of ['pill-show-date', 'pill-date-calendars', 'pill-date-order', 'pill-date-formats', 'pill-date-digits', 'pill-date-short-months', 'calendar-use-calendar-language', 'pill-show-time', 'pill-time-24h', 'pill-time-seconds'])
            watch(key, () => this._renderPill());
        for (const key of ['calendar-events-enabled','calendar-event-sources','pill-show-event','pill-event-show-title','calendar-event-lead-minutes'])
            watch(key, () => { this._syncCalendarEvents(); this._updateUpcomingEvent(); });
        watch('surface-opacity', () => this._applyAppearance());
        watch('surface-matte', () => this._applyAppearance());
        watch('pill-width', () => this._island?.applyDimensions());
        watch('expanded-width', () => this._island?.applyDimensions());
        watch('move-clock', () => {
            if (this._settings.get_boolean('move-clock')) this._moveCalendar();
            else this._restoreCalendar();
        });
        const syncHover = () => this._island?.setHoverEnabled(
            this._settings.get_boolean('hover-open'),
            this._settings.get_int('hover-open-delay'),
            this._settings.get_int('hover-close-delay'));
        watch('hover-open', syncHover);
        watch('hover-open-delay', syncHover);
        watch('hover-close-delay', syncHover);
        // Calendar owns its live module toggle in Card. Other module toggles
        // and the metrics interval take effect after a disable/enable cycle.
    }

    _renderNotifications(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.notifications = state;
        this._card._notificationsView?.render(state);
        this._card.setTabIcon('notifications', state.dnd ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic');
        this._renderPill();
    }

    // Notifications listed while the tab was open count as seen once it closes.
    _syncNotificationsSeen() {
        const visible = Boolean(this._island?.expanded && this._card?.actor.mapped && !this._card.quickAskOpen &&
            this._card._page === 'notifications');
        if (this._notificationsVisible && !visible) this._notifications?.markSeen();
        this._notificationsVisible = visible;
    }

    _peekNotification(item) {
        if (!this._enabled || !shouldPeek({
            enabled: this._settings.get_boolean('notifications-peek'),
            visible: Boolean(this._island?.actor.mapped && !this._island.expanded),
            locked: Main.sessionMode.isLocked,
            critical: item.critical,
            showBanners: item.showBanners,
        })) return;
        this._pill.peek(item, PEEK_MS, !this._settings.get_boolean('disable-animations'));
    }

    _togglePillTitle() {
        this._settings.set_boolean('pill-show-title', !this._settings.get_boolean('pill-show-title'));
    }

    _bindQuickAsk() {
        if (this._quickAskBinding) Main.wm.removeKeybinding(QUICK_ASK_SHORTCUT);
        this._quickAskBinding = false;
        if (!this._settings.get_strv(QUICK_ASK_SHORTCUT).length) return;
        const action = Main.wm.addKeybinding(QUICK_ASK_SHORTCUT, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP,
            () => this._openQuickAsk());
        this._quickAskBinding = action !== Meta.KeyBindingAction.NONE;
        if (!this._quickAskBinding)
            Main.notify('Ubuntu Island', 'Quick Ask shortcut could not be registered. Choose another combination in Agents preferences.');
    }

    _bindIslandShortcuts() {
        for (const key of this._islandBindings ?? []) Main.wm.removeKeybinding(key);
        this._islandBindings = [];
        for (const [index, key] of ISLAND_SHORTCUTS.entries()) {
            if (!this._settings.get_strv(key).length) continue;
            const action = Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP, () => {
                    if (!this._canUseIslandShortcut()) return;
                    this._island._cancelHoverTimers();
                    if (index === 0) this._island.toggle();
                    else { this._island.expand(); this._card.cyclePage(index === 1 ? 1 : -1); }
                });
            if (action !== Meta.KeyBindingAction.NONE) this._islandBindings.push(key);
            else Main.notify('Ubuntu Island', 'An Island shortcut is unavailable. Choose another combination in Appearance settings.');
        }
    }

    _canUseIslandShortcut() {
        return this._enabled && this._island?.actor.mapped && !this._prefsWatch && !Main.sessionMode.isLocked &&
            (Main.actionMode === Shell.ActionMode.NORMAL || Boolean(this._island._grab));
    }

    _openQuickAsk() {
        if (!this._canUseIslandShortcut()) return;
        this._island._cancelHoverTimers();
        this._card.showQuickAsk();
        this._island.expand();
        if (this._island.state === 'expanded') this._card._quickAsk.focus();
    }

    _applyAppearance() {
        this._card?.updateMediaTint();
        const theme = this._settings.get_string('color-theme');
        const opacity = this._settings.get_int('surface-opacity');
        const matte = this._settings.get_int('surface-matte');
        this._island.setAppearance(surfaceStyle(theme, opacity, matte), matte, opacity);
        const classes = this._card.actor.get_style_class_name().split(/\s+/)
            .filter(name => !name.startsWith('ubuntu-island-theme-'));
        this._card.actor.set_style_class_name([...classes, `ubuntu-island-theme-${theme}`].join(' '));
    }

    _renderPill() {
        if (!this._enabled) return;
        const presentation = this._pill.render({
            media: this._states.media,
            system: this._states.system,
            connection: this._states.connection,
            offlineMode: this._settings.get_string('pill-offline-mode'),
            bluetooth: this._states.bluetooth,
            expanded: this._island?.expanded ?? false,
            showMetrics: this._settings.get_boolean('enable-metrics'),
            showTitle: this._settings.get_boolean('pill-show-title'),
            showDate: this._settings.get_boolean('pill-show-date'),
            showTime: this._settings.get_boolean('pill-show-time'),
            timeOptions: {hour24: this._settings.get_boolean('pill-time-24h'), seconds: this._settings.get_boolean('pill-time-seconds')},
            dateOptions: {
                calendarLanguage: this._settings.get_boolean('calendar-use-calendar-language'),
                calendars: this._settings.get_strv('pill-date-calendars'),
                order: this._settings.get_strv('pill-date-order'),
                formats: this._settings.get_value('pill-date-formats').deepUnpack(),
                digits: this._settings.get_value('pill-date-digits').deepUnpack(),
                shortMonths: this._settings.get_strv('pill-date-short-months'),
            },
            titleMode: this._settings.get_string('pill-title-mode'),
            titleCharacters: this._settings.get_int('pill-title-characters'),
            animations: !this._settings.get_boolean('disable-animations'),
            weather: this._states.weather,
            showWeather: this._settings.get_boolean('pill-show-weather'),
            showNetwork: this._settings.get_boolean('pill-show-network'),
            agents: this._states.agents,
            showAgents: this._settings.get_boolean('pill-show-agents'),
            notifications: this._states.notifications,
            showNotifications: this._settings.get_boolean('pill-show-notifications'),
            event: this._eventIndicator,
            commute: this._states.commute,
            showCommute: this._settings.get_boolean('pill-show-commute'),
            units: this._settings.get_string('weather-units'),
            order: this._settings.get_strv('pill-order'),
            arrowStyle: this._settings.get_string('pill-arrow-style'),
            arrowAngle: this._settings.get_int('pill-arrow-angle'),
            weatherStyle: this._settings.get_string('pill-weather-style'),
        });
        this._island?.setConnectionEdge(presentation.connectionEdge);
        const minimum = this._pill.actor._islandMinimumWidth();
        if (minimum !== this._pillMinimum) {
            this._pillMinimum = minimum;
            this._island?.applyDimensions();
        }
    }

    // Service updates repaint parts of the card: keep the frosted backdrop whole.
    _renderMedia(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.media = state;
        this._card.renderMedia(state);
        this._syncMediaViews();
        this._renderPill();
        const artUrl = state?.available ? String(state.artUrl ?? '') : '';
        const remote = /^https?:/i.test(artUrl);
        if (artUrl !== this._artUrl && artUrl && (!remote || this._settings.get_boolean('enable-remote-art'))) {
            this._artUrl = artUrl;
            this._card.renderArt(null);
            this._art?.load(artUrl, 192, content => {
                if (this._enabled) this._card.renderArt(content);
            });
        } else if (!artUrl || (remote && !this._settings.get_boolean('enable-remote-art'))) {
            this._artUrl = '';
            this._art?.cancel();
            this._card.renderArt(null);
        }
        this._layoutIfChanged();
        this._syncProgressTimer();
    }

    _syncMediaViews() {
        const active = Boolean(this._enabled && this._card?.actor.mapped && this._island?.expanded &&
            !this._card.quickAskOpen && this._card?._page === 'media' && this._states?.media?.available);
        const mode = active ? this._card._mediaTools?.mode : null;
        this._media?.setQueueActive?.(mode === 'queue');
        if (mode === 'lyrics') this._lyrics?.load(this._states.media);
        else this._lyrics?.cancel();
    }

    _syncWeather() {
        const active = Boolean(this._island?.expanded && !this._card?.quickAskOpen && this._card?._page === 'weather' && this._card.actor.mapped);
        const compact = Boolean(this._island?.actor.mapped && !this._island.expanded &&
            this._settings.get_boolean('pill-show-weather'));
        this._weather?.setActive(active || compact);
        this._commute?.setActive(Boolean(this._island?.actor.mapped && (
            (this._island.expanded && !this._card?.quickAskOpen && this._card?._page === 'commute' && this._card.actor.mapped) ||
            (!this._island.expanded && this._settings.get_boolean('pill-show-commute')))));
        this._card?._weatherView?.scene.setActive(active);
    }

    _syncCalendarEvents(refresh = false) {
        if (!this._calendarEvents || !this._enabled) return;
        const enabled = this._settings.get_boolean('calendar-events-enabled');
        const sources = this._settings.get_strv('calendar-event-sources');
        const visible = this._island?.actor.mapped && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        const calendar = visible && this._island.expanded && !this._card.quickAskOpen && this._card._page === 'calendar';
        const notch = visible && !this._island.expanded && this._settings.get_boolean('pill-show-event');
        if (!enabled || !sources.length) {
            this._calendarEvents.stop(); this._stopCalendarClock();
            this._renderCalendarEvents({status:!enabled ? 'disabled' : 'no-selection',
                occurrences:[],coverage:[],sources:[],incomplete:true});
            return;
        }
        if (!calendar && !notch) {
            // Hidden only: keep the shown snapshot and let the idle reader
            // expire on its own, so reopening is instant and needs no query.
            this._calendarEvents.suspend(); this._stopCalendarClock();
            return;
        }
        const day = todayDay(), ranges = [];
        if (calendar) ranges.push(this._card._calendarView.eventRange());
        if (notch) ranges.push({startDay:day,endDayExclusive:day + 7});
        this._calendarEvents.watch({catalog:false,sources,ranges:eventQueryRanges(ranges),timezone:GLib.TimeZone.new_local().get_identifier()},{refresh});
        if (!this._calendarClock) {
            this._calendarClock = Main.panel.statusArea.dateMenu._clock;
            this._calendarClockIds = ['notify::clock','notify::timezone'].map(signal => this._calendarClock.connect(signal, () => {
                const now = Date.now();
                const refresh = signal === 'notify::timezone' || Math.abs(now - (this._calendarTick || now)) > 90000;
                this._calendarTick = now; this._syncCalendarEvents(refresh); this._updateUpcomingEvent();
            }));
            this._calendarTick = Date.now();
        }
    }
    _renderCalendarEvents(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.calendarEvents = state;
        this._card?._calendarView?.setEvents(state); this._updateUpcomingEvent();
    }
    _updateUpcomingEvent() {
        if (this._calendarDeadline) GLib.Source.remove(this._calendarDeadline);
        this._calendarDeadline = 0; this._eventIndicator = null;
        if (!this._enabled) return;
        const state = this._states.calendarEvents, now = Date.now();
        const lead = this._settings.get_int('calendar-event-lead-minutes');
        const minutes = [5,15,30,60].includes(lead) ? lead : 15;
        const active = this._settings.get_boolean('calendar-events-enabled') && this._settings.get_boolean('pill-show-event') &&
            this._island?.actor.mapped && !this._island.expanded && !Main.sessionMode.isLocked;
        if (active && state) {
            const covered = state.coverage?.some(range => range.startMs <= now && range.endMs >= now + minutes * 60000);
            const next = upcomingEvents(state,{nowMs:now,leadMinutes:minutes,covered});
            if (next) {
                const event = next.occurrences[0], count = next.occurrences.length;
                const when = next.ongoing ? 'now' : `in ${Math.ceil((event.startMs - now) / 60000)} min`;
                const title = this._settings.get_boolean('pill-event-show-title');
                const text = count > 1 ? `${count} events ${when}` : title && event.title ? `${event.title} · ${when}` : `Event ${when}`;
                this._eventIndicator = {text,day:todayDay(new Date(next.ongoing ? now : event.startMs)),id:count === 1 ? event.id : null};
            }
            const boundaries = state.occurrences.filter(event => !event.allDay).flatMap(event => [event.startMs - minutes * 60000,event.startMs,event.endMs])
                .filter(value => value > now);
            if (boundaries.length && this._calendarClock) this._calendarDeadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                Math.max(10,Math.min(...boundaries) - now + 10), () => {
                    this._calendarDeadline = 0; this._updateUpcomingEvent(); return GLib.SOURCE_REMOVE;
                });
        }
        this._renderPill();
    }
    _stopCalendarClock() {
        if (this._calendarDeadline) GLib.Source.remove(this._calendarDeadline);
        this._calendarDeadline = 0;
        for (const id of this._calendarClockIds || []) this._calendarClock.disconnect(id);
        this._calendarClockIds = []; this._calendarClock = null;
    }
    _openUpcomingEvent() {
        const event = this._eventIndicator;
        if (!event) return;
        if (!this._card._calendarView) { void this._openCalendar(event.day).catch(() => Main.notify('Ubuntu Island','Could not open the desktop calendar')); return; }
        this._card.selectPage('calendar'); this._island.expand(); this._card.selectPage('calendar');
        this._card._calendarView.showEvents(event.day,event.id);
    }
    async _openCalendar(day, uri = null) {
        if (uri && !validateMeetUri(uri)) throw Error('Invalid meeting link');
        await new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {resolve(); return GLib.SOURCE_REMOVE;}));
        if (!this._enabled) return;
        this._island.suspendGrab();
        try {
            if (uri) await new Promise((resolve,reject) => Gio.AppInfo.launch_default_for_uri_async(uri,null,null, (_s,r) => {
                try { Gio.AppInfo.launch_default_for_uri_finish(r); resolve(); } catch (e) { reject(e); }
            }));
            else {
                // GNOME Calendar 46 uses EDS's translated strptime format,
                // not ISO-8601. Match that domain and use a four-digit year.
                const date = GLib.DateTime.new_from_unix_utc(day * 86400 + 12 * 3600);
                const format = GLib.dgettext('evolution-data-server','%m/%d/%Y %H:%M:%S');
                Gio.Subprocess.new(['gnome-calendar','--date',date.format(format)],Gio.SubprocessFlags.NONE);
            }
            this._island.collapse();
        } finally { this._island?.resumeGrab(); }
    }

    _renderSystem(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.system = state;
        this._card.renderSystem(state);
        this._renderPill();
    }

    _renderConnectivity(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.connection = state;
        this._renderPill();
    }

    _renderAudio(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.audio = state;
        this._card.renderAudio(state);
        this._layoutIfChanged();
    }

    _renderBluetooth(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        this._states.bluetooth = state;
        this._card.renderBluetooth(state);
        this._renderPill();
        this._layoutIfChanged();
    }

    // Sections can appear or vanish while the card is open (player quits,
    // output list changes); the island height follows the new content.
    _layoutIfChanged() {
        const signature = layoutSignature(this._states);
        if (signature === this._layoutSignature) return;
        this._layoutSignature = signature;
        this._island?.relayout();
    }

    // One-second UI clock while the card is open and a player is active.
    _syncProgressTimer() {
        if (!this._enabled) return;
        const needed = Boolean(this._island?.expanded && !this._card?.quickAskOpen && this._card?.actor.mapped && this._card?._page === 'media' && [null, 'lyrics'].includes(this._card._mediaTools.mode) && this._states.media?.available);
        if (needed && !this._progressTimer) {
            const tick = () => {
                if (!this._island?.expanded || this._card?.quickAskOpen || !this._card?.actor.mapped || this._card?._page !== 'media' || ![null, 'lyrics'].includes(this._card._mediaTools.mode) || !this._states.media?.available) {
                    this._progressTimer = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._card.renderProgress(this._media?.positionSec() ?? null);
                this._island?.invalidateBackdrop();
                return GLib.SOURCE_CONTINUE;
            };
            this._progressTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tick);
            tick();
        } else if (!needed && this._progressTimer) {
            GLib.Source.remove(this._progressTimer);
            this._progressTimer = 0;
        }
    }

    _renderAgents(state) {
        this._island?.invalidateBackdrop();
        if (!this._enabled) return;
        const previous = this._states.agents?.sessions || [];
        if (this._settings.get_boolean('agents-notify') && !Main.sessionMode.isLocked) {
            for (const session of state.sessions || []) {
                const old = previous.find(s => s.id === session.id);
                if (agentNotificationNeeded(old, session))
                    Main.notify(`Ubuntu Island · ${AGENT_STATES[session.state]}`, `${AGENTS[session.provider]} · ${session.label}`);
            }
        }
        this._states.agents = state;
        this._card?._agentsView?.render(state);
        this._renderPill();
    }

    _agentControl(value) {
        if (!this._agents) return Promise.reject(new Error('Observer unavailable. Re-enable Agents to reconnect.'));
        return this._agents.send(value);
    }

    _expireAgents() {
        if (!this._states.agents?.connected) return;
        const before = Date.now() - this._settings.get_int('agents-inactive-minutes') * 60000;
        const state = this._states.agents;
        // Update immediately; the broker applies the same cutoff to its stored
        // rows and Undo entries. Later activity is newer than this fixed cutoff.
        this._renderAgents({...state, sessions:state.sessions.filter(session => session.updated >= before)});
        void this._agents?.send({control:'expire', before}).catch(() => {});
    }

    async _openAgent(session) {
        const window = await this._agentWindows?.resolveForActivation(session);
        const current = this._states.agents?.sessions.find(row => row.id === session.id);
        if (this._enabled && current && window && this._agentWindows?.resolve(current) === window)
            this._activateAgent(current, window);
    }

    _askAgent(input) {
        const result = launchAgent(this._settings, input);
        this._leaveAgents();
        return result;
    }

    _leaveAgents() {
        if (this._agentFocus) GLib.Source.remove(this._agentFocus);
        this._agentFocus = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._agentFocus = 0;
            if (this._enabled) this._island.collapse();
            return GLib.SOURCE_REMOVE;
        });
    }

    _activateAgent(session, window) {
        // Wait until the click release finishes before releasing the modal grab.
        if (this._agentFocus) GLib.Source.remove(this._agentFocus);
        this._agentFocus = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._agentFocus = 0;
            if (!this._enabled || this._agentWindows?.resolve(session) !== window) return GLib.SOURCE_REMOVE;
            this._island.collapse();
            try { this._agentWindows.activate(window); }
            catch (error) { this._card._agentsView.message.text = error.message; }
            return GLib.SOURCE_REMOVE;
        });
    }

    _moveCalendar() {
        // GNOME 46-specific private panel API. Keep calendar/notifications usable.
        const date = Main.panel.statusArea.dateMenu?.container;
        const center = Main.panel._centerBox;
        const right = Main.panel._rightBox;
        if (!date || !center || !right || date.get_parent() !== center) return;
        const index = center.get_children().indexOf(date);
        this._dateRestore = {date, center, index};
        center.remove_child(date);
        right.insert_child_at_index(date, 0);
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
        for (const key of this._islandBindings ?? []) Main.wm.removeKeybinding(key);
        this._islandBindings = [];
        if (this._quickAskBinding) Main.wm.removeKeybinding(QUICK_ASK_SHORTCUT);
        this._quickAskBinding = false;
        if (this._progressTimer) GLib.Source.remove(this._progressTimer);
        this._progressTimer = 0;
        this._disposePreferencesWatch();
        for (const id of this._settingsIds ?? []) this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._agentFocus) GLib.Source.remove(this._agentFocus);
        this._agentFocus = 0;
        this._agents?.stop(); this._agents = null;
        this._notifications?.stop(); this._notifications = null;
        this._calendarEvents?.stop(); this._calendarEvents = null; this._stopCalendarClock();
        if (this._calendarSessionSignal) Main.sessionMode.disconnect(this._calendarSessionSignal);
        this._calendarSessionSignal = 0;
        this._agentWindows?.stop(); this._agentWindows = null;
        this._connectivity?.stop();
        this._connectivity = null;
        this._system?.stop();
        this._media?.stop();
        this._lyrics?.stop();
        this._lyrics = null;
        this._bluetooth?.stop();
        this._audio?.stop();
        this._art?.destroy();
        this._commute?.stop();
        this._commute = null;
        this._weather?.stop();
        this._weather = null;
        this._system = this._media = this._bluetooth = this._audio = this._art = null;
        this._card?._weatherView?.scene.destroy();
        this._island?.destroy();
        this._island = null;
        this._card = null;
        this._pill = null;
        this._states = null;
        this._restoreCalendar();
        this._settings = null;
        this._artUrl = null;
    }
}
