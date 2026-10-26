// Pure presentation rules, shared by the Shell UI and the Node regression suite.
export function containsPoint(x, y, left, top, width, height) {
    return x >= left && y >= top && x < left + width && y < top + height;
}

export function selectPlayer(players, preferred = null) {
    const eligible = players.filter(player =>
        (player.status === 'Playing' || player.status === 'Paused') &&
        Boolean(player.title?.trim()));
    return eligible.find(player => player.status === 'Playing') ??
        eligible.find(player => player.name === preferred) ?? eligible[0] ?? null;
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
