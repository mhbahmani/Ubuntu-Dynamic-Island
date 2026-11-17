// Pure presentation rules, shared by the Shell UI and the Node regression suite.
export function containsPoint(x, y, left, top, width, height) {
    return x >= left && y >= top && x < left + width && y < top + height;
}

// MPRIS titles can be empty (VLC and other local players skip xesam:title for
// untagged files), but those players usually still expose xesam:url with a
// file:// path. The file name beats showing the player name; non-file URLs
// (browsers) carry no usable basename and fall through to @fallback.
// Side a newly selected page enters from, following the tab order: moving to
// a later tab brings content in from the right (1), an earlier one from the
// left (-1). Unknown or unchanged pages do not move (0).
export function pageDirection(order, from, to) {
    const a = order.indexOf(from), b = order.indexOf(to);
    if (a < 0 || b < 0 || a === b) return 0;
    return b > a ? 1 : -1;
}

export function mediaTitle(title, url, fallback = '') {
    const trimmed = String(title ?? '').trim();
    if (trimmed) return trimmed;
    const uri = String(url ?? '').trim();
    if (!uri.startsWith('file:')) return fallback;
    try {
        const stem = decodeURIComponent(uri.split('/').pop() ?? '')
            .replace(/\.[A-Za-z0-9]{1,5}$/, '');
        return stem || fallback;
    } catch {
        return fallback;
    }
}

export function selectPlayer(players, preferred = null) {
    const titled = player => Boolean(player.title?.trim());
    // A metadata-less registration stays hidden unless it is actually
    // playing: local video players often expose MPRIS with no title, while
    // idle browsers register with empty metadata.
    const eligible = players.filter(player =>
        player.status === 'Playing' || (player.status === 'Paused' && titled(player)));
    const playing = eligible.filter(player => player.status === 'Playing');
    const pool = playing.length ? playing : eligible;
    return pool.find(player => player.name === preferred) ??
        pool.find(titled) ?? pool[0] ?? null;
}

export function layoutSignature({media, audio, bluetooth}) {
    return JSON.stringify([
        Boolean(media?.available),
        Boolean(audio?.available), audio?.outputs?.map(output => output.id) ?? [],
        Boolean(bluetooth?.available), Boolean(bluetooth?.powered),
        Boolean(bluetooth?.error),
        bluetooth?.devices?.map(device => device.path) ?? [],
    ]);
}
