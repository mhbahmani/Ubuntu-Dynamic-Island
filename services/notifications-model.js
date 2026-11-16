// Pure notification helpers; testable with Node.

export const PEEK_MS = 4000;
export const MAX_ROWS = 30;
export const URGENCY_CRITICAL = 3;
export const LAYOUTS = ['compact', 'grouped'];

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

export function plainText(text, markup = false) {
    let value = String(text ?? '');
    if (markup) {
        value = value.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
            if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        });
    }
    return value.replace(/\s+/g, ' ').trim();
}

export function notificationAge(time, now) {
    const minutes = Math.floor(Math.max(0, now - time) / 60);
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'Yesterday' : `${days} d`;
}

// Critical notifications stay first, as GNOME keeps them on screen.
export function orderNotifications(items) {
    return [...items].sort((a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical)) || b.time - a.time || b.id - a.id);
}

export function notificationCount(count) {
    if (!count) return 'No notifications';
    return count === 1 ? '1 notification' : `${count} notifications`;
}

export function startOfDay(date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return Math.floor(day.getTime() / 1000);
}

// Ordered items -> pinned critical, Today and Earlier. Headings appear only
// when older notifications exist; a lone Today heading adds nothing.
export function notificationSections(items, todayStart) {
    const pinned = [], today = [], earlier = [];
    for (const item of items)
        (item.critical ? pinned : item.time >= todayStart ? today : earlier).push(item);
    return [
        {id: 'pinned', title: '', items: pinned},
        {id: 'today', title: earlier.length ? 'Today' : '', items: today},
        // Day headings only separate days: a list from a single day has none.
        {id: 'earlier', title: today.length || pinned.length ? 'Earlier' : '', items: earlier},
    ].filter(section => section.items.length);
}

export function filterNotifications(items, filter, todayStart) {
    return filter === 'today' ? items.filter(item => item.critical || item.time >= todayStart) : items;
}

// Ordered items -> one group per app, in the order of each app's first item.
export function groupNotifications(items) {
    const groups = new Map();
    for (const item of items) {
        const key = item.appKey || item.app || 'notification';
        let group = groups.get(key);
        if (!group) {
            group = {key, app: item.app, icon: item.icon, items: [], time: item.time, critical: false};
            groups.set(key, group);
        }
        group.items.push(item);
        group.time = Math.max(group.time, item.time);
        group.critical ||= Boolean(item.critical);
    }
    return [...groups.values()];
}

export function groupPreview(group) {
    return group.items.slice(0, 2).map(item => item.title || item.body).filter(Boolean).join(' · ');
}

export function unseenCount(items, seenId) {
    return items.filter(item => item.id > seenId).length;
}

// Mirrors GNOME banners: critical notifications ignore Do Not Disturb.
export function shouldPeek({enabled, visible, locked, critical, showBanners}) {
    return Boolean(enabled && visible && !locked && (critical || showBanners));
}
