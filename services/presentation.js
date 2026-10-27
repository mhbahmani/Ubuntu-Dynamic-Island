// Pure presentation rules, shared by the Shell UI and the Node regression suite.
export function containsPoint(x, y, left, top, width, height) {
    return x >= left && y >= top && x < left + width && y < top + height;
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
