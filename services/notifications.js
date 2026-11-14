import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {plainText, orderNotifications, unseenCount, URGENCY_CRITICAL} from './notifications-model.js';

// Mirrors the Shell message tray. Notifications stay owned by their sources;
// only references and plain-text copies for the current snapshot are kept.
export class NotificationsService {
    constructor(onChange, onBanner) {
        this._onChange = onChange;
        this._onBanner = onBanner;
        this._ids = new Map();
        this._nextId = 1;
        this._seenId = 0;
        this._silenced = new Set();
        this._emitId = 0;
    }

    start() {
        const tray = Main.messageTray;
        tray.connectObject(
            'source-added', (_tray, source) => this._watchSource(source),
            'source-removed', (_tray, source) => source.disconnectObject(this),
            this);
        for (const source of tray.getSources()) this._watchSource(source);
        // Do Not Disturb is GNOME's global banner switch.
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._desktop.connectObject('changed::show-banners', () => {
            if (!this._dnd) this._silenced.clear();
            this._emit();
        }, this);
        this._emit();
    }

    stop() {
        if (this._emitId) GLib.Source.remove(this._emitId);
        this._emitId = 0;
        Main.messageTray.disconnectObject(this);
        for (const source of Main.messageTray.getSources()) source.disconnectObject(this);
        for (const notification of this._ids.keys()) notification.disconnectObject(this);
        this._ids.clear();
        this._silenced.clear();
        this._desktop?.disconnectObject(this);
        this._desktop = null;
    }

    get _dnd() {
        return this._desktop ? !this._desktop.get_boolean('show-banners') : false;
    }

    setDoNotDisturb(enabled) {
        this._desktop?.set_boolean('show-banners', !enabled);
    }

    // Everything listed now counts as seen; later arrivals are new.
    markSeen() {
        if (this._seenId === this._nextId - 1) return;
        this._seenId = this._nextId - 1;
        this._emit();
    }

    activate(id) {
        this._find(id)?.activate();
    }

    invoke(id, index) {
        this._find(id)?.actions[index]?.activate();
    }

    dismiss(ids) {
        for (const id of ids)
            this._find(id)?.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
    }

    clear() {
        for (const notification of [...this._ids.keys()])
            notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
    }

    _watchSource(source) {
        source.connectObject(
            'notification-added', (_source, notification) => this._add(notification),
            'notification-removed', (_source, notification) => this._remove(notification),
            'notification-request-banner', (_source, notification) => this._banner(notification),
            this);
        for (const notification of source.notifications) this._add(notification);
    }

    _add(notification) {
        if (this._ids.has(notification)) return;
        this._ids.set(notification, this._nextId++);
        notification.connectObject('notify', () => this._queueEmit(),
            'action-added', () => this._queueEmit(), 'action-removed', () => this._queueEmit(), this);
        this._queueEmit();
    }

    _remove(notification) {
        if (!this._ids.delete(notification)) return;
        notification.disconnectObject(this);
        this._queueEmit();
    }

    _banner(notification) {
        const item = this._item(notification);
        if (!item) return;
        if (this._dnd && !item.critical && !this._silenced.has(item.id)) {
            this._silenced.add(item.id);
            this._queueEmit();
        }
        this._onBanner?.({...item, showBanners: Boolean(notification.source?.policy?.showBanners)});
    }

    _find(id) {
        for (const [notification, value] of this._ids)
            if (value === id) return notification;
        return null;
    }

    _item(notification) {
        const id = this._ids.get(notification);
        if (!id) return null;
        const source = notification.source;
        const app = source?.app ?? null;
        return {
            id,
            app: plainText(source?.title),
            appKey: app?.get_id() ?? plainText(source?.title),
            // Prefer the application's own logo; the message image may be an
            // avatar or a symbolic status icon.
            icon: app?.get_icon() ?? source?.icon ?? notification.gicon ?? null,
            title: plainText(notification.title),
            body: plainText(notification.body, notification.useBodyMarkup),
            time: notification.datetime?.to_unix() ?? 0,
            critical: notification.urgency === URGENCY_CRITICAL,
            actions: notification.actions.map(action => plainText(action.label)),
        };
    }

    // Property updates arrive in bursts (title, body, datetime): emit once.
    _queueEmit() {
        if (this._emitId) return;
        this._emitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._emitId = 0;
            this._emit();
            return GLib.SOURCE_REMOVE;
        });
    }

    _emit() {
        const items = orderNotifications([...this._ids.keys()].map(notification => this._item(notification)));
        this._onChange({items, count: items.length, seenId: this._seenId, unseen: unseenCount(items, this._seenId),
            dnd: this._dnd, silenced: this._silenced.size});
    }
}
