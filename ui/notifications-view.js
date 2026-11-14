import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {Switch} from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {icon, label, row, column, button} from './widgets.js';
import {notificationAge, notificationCount, notificationSections, filterNotifications,
    groupNotifications, groupPreview, startOfDay, MAX_ROWS} from '../services/notifications-model.js';

const FALLBACK_ICON = 'preferences-system-notifications-symbolic';
const DELETE_KEYS = [Clutter.KEY_Delete, Clutter.KEY_KP_Delete, Clutter.KEY_BackSpace];

function chip(text, action, toggle = false) {
    const control = new St.Button({style_class: 'ubuntu-island-notification-chip', label: text,
        can_focus: true, reactive: true, track_hover: true, toggle_mode: toggle});
    control.connect('clicked', action);
    return control;
}

// Recent Shell notifications as a compact list or grouped by app. Entries are
// reused by key so focus survives updates; rendering waits until visible.
export class NotificationsView {
    constructor(section, settings, actions) {
        this._settings = settings;
        this._actions = actions;
        this._entries = new Map();
        this._expanded = new Set();
        this._filter = 'all';
        this._state = {items: [], count: 0, seenId: 0, unseen: 0, dnd: false, silenced: 0};
        this.actor = section.box;
        this._header = section.header;
        this._header.get_first_child().hide();
        this._buildToolbar();
        this._list = column('ubuntu-island-notification-list');
        section.content.add_child(this._list);
        this._buildEmpty(section.content);
        const layoutId = settings.connect('changed::notifications-layout', () => this.render());
        const focusId = global.stage.connect('notify::key-focus', () => this._syncActive());
        this.actor.connect('destroy', () => {
            settings.disconnect(layoutId);
            global.stage.disconnect(focusId);
        });
        this.actor.connect('notify::mapped', () => { if (this.actor.mapped) this._render(); });
    }

    get _grouped() {
        return this._settings.get_string('notifications-layout') === 'grouped';
    }

    _buildToolbar() {
        this._newChip = label('', 'ubuntu-island-notification-new', false);
        this._header.add_child(this._newChip);
        this._filters = row('ubuntu-island-notification-filters');
        this._filterButtons = new Map(['all', 'today'].map(id => {
            const control = chip(id === 'all' ? 'All' : 'Today', () => { this._filter = id; this._render(); }, true);
            this._filters.add_child(control);
            return [id, control];
        }));
        this._header.add_child(this._filters);
        const spacer = new St.Widget({x_expand: true});
        this._header.add_child(spacer);
        this._silencedLabel = label('', 'ubuntu-island-device-status', false);
        this._header.add_child(this._silencedLabel);
        this._layoutButton = button('view-list-symbolic', '', () => this._settings.set_string('notifications-layout',
            this._grouped ? 'compact' : 'grouped'), 15, 'ubuntu-island-ghost');
        this._header.add_child(this._layoutButton);
        this._dndButton = button(FALLBACK_ICON, '', () => this._actions.notificationsDoNotDisturb(!this._state.dnd),
            15, 'ubuntu-island-ghost ubuntu-island-notification-dnd');
        this._header.add_child(this._dndButton);
        this._clear = chip('Clear', () => this._actions.notificationsClear());
        this._header.add_child(this._clear);
    }

    _buildEmpty(parent) {
        this._empty = column('ubuntu-island-notification-empty');
        this._empty.x_align = Clutter.ActorAlign.CENTER;
        this._emptyIcon = icon('emblem-ok-symbolic', 24);
        this._emptyIcon.x_align = Clutter.ActorAlign.CENTER;
        this._emptyTitle = label('', 'ubuntu-island-device-name');
        this._emptyBody = label('', 'ubuntu-island-device-status');
        for (const actor of [this._emptyTitle, this._emptyBody]) actor.x_align = Clutter.ActorAlign.CENTER;
        this._emptySwitch = new Switch(false);
        this._emptyDnd = new St.Button({style_class: 'ubuntu-island-device-button ubuntu-island-notification-dnd-row',
            can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.CENTER});
        const face = row('ubuntu-island-device');
        face.add_child(icon('weather-clear-night-symbolic', 16));
        face.add_child(label('Do Not Disturb', 'ubuntu-island-device-name'));
        face.add_child(this._emptySwitch);
        this._emptyDnd.set_child(face);
        this._emptyDnd.connect('clicked', () => this._actions.notificationsDoNotDisturb(!this._state.dnd));
        this._emptySilenced = label('', 'ubuntu-island-device-status');
        this._emptySilenced.x_align = Clutter.ActorAlign.CENTER;
        for (const actor of [this._emptyIcon, this._emptyTitle, this._emptyBody, this._emptyDnd, this._emptySilenced])
            this._empty.add_child(actor);
        parent.add_child(this._empty);
    }

    render(state) {
        if (state) this._state = state;
        if (this.actor.mapped) this._render();
    }

    _render() {
        const {items, count, unseen, dnd, silenced} = this._state;
        const now = Math.floor(Date.now() / 1000), todayStart = startOfDay(Date.now());
        const grouped = this._grouped;
        const visible = grouped ? filterNotifications(items, this._filter, todayStart) : items;
        const plan = grouped ? this._groupedPlan(visible) : this._compactPlan(visible, todayStart);
        const focusIndex = this._focusedIndex();
        const keys = new Set(plan.map(entry => entry.key));
        for (const [key, entry] of this._entries) {
            if (keys.has(key)) continue;
            entry.destroy();
            this._entries.delete(key);
        }
        const groups = new Set(plan.filter(entry => entry.kind === 'group').map(entry => entry.group.key));
        for (const key of this._expanded) if (!groups.has(key)) this._expanded.delete(key);
        for (const [index, spec] of plan.entries()) {
            let entry = this._entries.get(spec.key);
            if (!entry) {
                entry = spec.kind === 'heading' ? this._createHeading() : this._createCard(spec.key);
                this._list.add_child(entry);
                this._entries.set(spec.key, entry);
            }
            if (spec.kind === 'heading') entry.text = spec.title;
            else if (spec.kind === 'group') this._fillGroup(entry, spec.group, now);
            else this._fillItem(entry, spec.item, now, spec.child);
            if (this._list.get_child_at_index(index) !== entry) this._list.set_child_at_index(entry, index);
        }

        const empty = !visible.length;
        this._header.visible = Boolean(count);
        this._newChip.text = `${unseen} new`;
        this._newChip.visible = unseen > 0;
        this._filters.visible = grouped;
        for (const [id, control] of this._filterButtons) control.checked = id === this._filter;
        this._layoutButton.child.icon_name = grouped ? 'view-list-symbolic' : 'view-grid-symbolic';
        this._layoutButton.accessible_name = grouped ? 'Show as a list' : 'Group by app';
        this._dndButton.child.icon_name = dnd ? 'notifications-disabled-symbolic' : FALLBACK_ICON;
        this._dndButton.checked = dnd;
        this._dndButton.accessible_name = `Do Not Disturb, ${dnd ? 'on' : 'off'}`;
        this._silencedLabel.text = `${silenced} silenced`;
        this._silencedLabel.visible = dnd && silenced > 0;
        this._clear.accessible_name = `Clear all, ${notificationCount(count)}`;
        this._clear.visible = Boolean(count);

        this._empty.visible = empty;
        const filtered = Boolean(count) && empty;
        this._emptyIcon.icon_name = dnd ? 'notifications-disabled-symbolic' : 'emblem-ok-symbolic';
        this._emptyTitle.text = filtered ? 'Nothing today' : 'You’re all caught up';
        this._emptyBody.text = filtered ? 'Earlier notifications are under All.' : 'New notifications appear here.';
        this._emptyDnd.visible = !count;
        this._emptySwitch.state = dnd;
        this._emptyDnd.accessible_name = `Do Not Disturb, ${dnd ? 'on' : 'off'}`;
        this._emptySilenced.text = `${silenced} silenced while on`;
        this._emptySilenced.visible = !count && dnd && silenced > 0;
        this._restoreFocus(focusIndex);
        this._syncActive();
    }

    _compactPlan(items, todayStart) {
        const plan = [];
        for (const section of notificationSections(items.slice(0, MAX_ROWS), todayStart)) {
            if (section.title) plan.push({kind: 'heading', key: `h:${section.id}`, title: section.title});
            for (const item of section.items) plan.push({kind: 'item', key: `n:${item.id}`, item});
        }
        return plan;
    }

    _groupedPlan(items) {
        const plan = [];
        for (const group of groupNotifications(items)) {
            if (group.items.length === 1) {
                plan.push({kind: 'item', key: `n:${group.items[0].id}`, item: group.items[0]});
                continue;
            }
            plan.push({kind: 'group', key: `g:${group.key}`, group});
            if (this._expanded.has(group.key))
                for (const item of group.items.slice(0, MAX_ROWS))
                    plan.push({kind: 'item', key: `n:${item.id}`, item, child: true});
        }
        return plan;
    }

    _createHeading() {
        return label('', 'ubuntu-island-notification-section');
    }

    // Entry: card (open button with an overlaid dismiss) and an action row,
    // plus a stack shelf for collapsed groups.
    _createCard(key) {
        const entry = column('ubuntu-island-notification');
        entry.track_hover = true;
        entry.reactive = true;
        const card = column('ubuntu-island-device-button ubuntu-island-notification-card');
        card.track_hover = true;
        card.reactive = true;
        const top = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        const open = new St.Button({style_class: 'ubuntu-island-notification-open', can_focus: true,
            reactive: true, track_hover: true, x_expand: true});
        const content = row('ubuntu-island-device');
        content.x_expand = true;
        entry._icon = icon(FALLBACK_ICON, 24);
        entry._icon.y_align = Clutter.ActorAlign.START;
        content.add_child(entry._icon);
        const details = column('ubuntu-island-notification-details');
        details.x_expand = true;
        const heading = row('ubuntu-island-notification-heading');
        entry._title = label('', 'ubuntu-island-device-name');
        entry._title.x_expand = true;
        entry._count = label('', 'ubuntu-island-notification-count', false);
        entry._dot = new St.Widget({style_class: 'ubuntu-island-notification-dot', y_align: Clutter.ActorAlign.CENTER});
        entry._age = label('', 'ubuntu-island-device-status', false);
        entry._chevron = icon('pan-down-symbolic', 12);
        for (const actor of [entry._title, entry._count, entry._dot, entry._age, entry._chevron]) heading.add_child(actor);
        entry._body = label('', 'ubuntu-island-device-status');
        details.add_child(heading);
        details.add_child(entry._body);
        content.add_child(details);
        open.set_child(content);
        open.connect('clicked', () => entry._open());
        open.connect('key-press-event', (_actor, event) => {
            if (!DELETE_KEYS.includes(event.get_key_symbol())) return Clutter.EVENT_PROPAGATE;
            entry._dismiss();
            return Clutter.EVENT_STOP;
        });
        entry._dismissButton = button('window-close-symbolic', '', () => entry._dismiss(), 12,
            'ubuntu-island-ghost ubuntu-island-notification-dismiss');
        // BinLayout honours alignment only for expanding children.
        entry._dismissButton.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START, opacity: 0});
        top.add_child(open);
        top.add_child(entry._dismissButton);
        card.add_child(top);
        entry._actionRow = row('ubuntu-island-notification-actions');
        entry._actionRow.hide();
        card.add_child(entry._actionRow);
        entry.add_child(card);
        entry._shelf = new St.Widget({style_class: 'ubuntu-island-notification-shelf', x_expand: true});
        entry.add_child(entry._shelf);
        entry._card = card;
        entry._openButton = open;
        entry._key = key;
        entry.connect('notify::hover', () => this._syncActive());
        return entry;
    }

    _fillCommon(entry, {title, body, icon: gicon, time, unseen, critical}, now) {
        if (gicon) entry._icon.gicon = gicon;
        else entry._icon.icon_name = FALLBACK_ICON;
        entry._title.text = title;
        entry._body.text = body;
        entry._body.visible = Boolean(body);
        entry._age.text = notificationAge(time, now);
        entry._dot.visible = unseen;
        if (critical) entry._card.add_style_class_name('ubuntu-island-notification-critical');
        else entry._card.remove_style_class_name('ubuntu-island-notification-critical');
    }

    _fillItem(entry, item, now, child = false) {
        const title = item.title || item.app || 'Notification';
        const body = item.title ? item.body : '';
        this._fillCommon(entry, {title, body, icon: item.icon, time: item.time,
            unseen: item.id > this._state.seenId, critical: item.critical}, now);
        entry._count.hide();
        entry._chevron.hide();
        entry._shelf.hide();
        if (child) entry.add_style_class_name('ubuntu-island-notification-child');
        else entry.remove_style_class_name('ubuntu-island-notification-child');
        entry._open = () => this._actions.notificationsActivate(item.id);
        entry._dismiss = () => this._actions.notificationsDismiss([item.id]);
        const labels = item.actions ?? [];
        if (entry._labels?.join('\n') !== labels.join('\n')) {
            entry._labels = labels;
            entry._actionRow.destroy_all_children();
            labels.forEach((text, index) =>
                entry._actionRow.add_child(chip(text, () => this._actions.notificationsInvoke(item.id, index))));
        }
        const summary = [item.app, title, body, entry._age.text, entry._dot.visible ? 'new' : ''].filter(Boolean).join(', ');
        entry._openButton.accessible_name = `Open notification: ${summary}`;
        entry._dismissButton.accessible_name = `Dismiss notification: ${title}`;
    }

    _fillGroup(entry, group, now) {
        const expanded = this._expanded.has(group.key);
        this._fillCommon(entry, {title: group.app || 'Notifications', body: groupPreview(group), icon: group.icon,
            time: group.time, unseen: group.items.some(item => item.id > this._state.seenId), critical: group.critical}, now);
        entry._count.text = String(group.items.length);
        entry._count.show();
        entry._chevron.icon_name = expanded ? 'pan-up-symbolic' : 'pan-down-symbolic';
        entry._chevron.show();
        entry._shelf.visible = !expanded;
        entry.remove_style_class_name('ubuntu-island-notification-child');
        entry._labels = [];
        entry._actionRow.destroy_all_children();
        entry._open = () => {
            if (expanded) this._expanded.delete(group.key);
            else this._expanded.add(group.key);
            this._render();
        };
        const ids = group.items.map(item => item.id);
        entry._dismiss = () => { this._expanded.delete(group.key); this._actions.notificationsDismiss(ids); };
        entry._openButton.accessible_name = `${expanded ? 'Collapse' : 'Expand'} ${group.app}, ${notificationCount(ids.length)}: ${entry._body.text}`;
        entry._dismissButton.accessible_name = `Dismiss all from ${group.app}`;
    }

    // Dismiss and actions appear on hover or keyboard focus; the age gives
    // way to the dismiss button so the row keeps its layout.
    _syncActive() {
        if (!this.actor.mapped) return;
        const focus = global.stage.get_key_focus();
        for (const entry of this._entries.values()) {
            if (!entry._card) continue;
            const active = entry.hover || Boolean(focus && entry.contains(focus));
            entry._dismissButton.opacity = active ? 255 : 0;
            entry._dismissButton.reactive = active;
            entry._age.opacity = active ? 0 : 255;
            entry._actionRow.visible = active && entry._actionRow.get_n_children() > 0;
        }
    }

    _focusedIndex() {
        const focus = global.stage.get_key_focus();
        if (!focus || !this._list.contains(focus)) return -1;
        return this._cards().findIndex(entry => entry.contains(focus));
    }

    _cards() {
        return this._list.get_children().filter(entry => entry._openButton);
    }

    _restoreFocus(index) {
        if (index < 0 || !this.actor.mapped) return;
        const focus = global.stage.get_key_focus();
        if (focus && this.actor.contains(focus) && focus.mapped) return;
        const cards = this._cards();
        const target = cards[Math.min(index, cards.length - 1)]?._openButton ??
            (this._emptyDnd.visible ? this._emptyDnd : this._layoutButton);
        target.grab_key_focus();
    }
}
