// Parse only timestamped text, never markup. Bound records before making actors.
export function parseLyrics(record) {
    if (record?.instrumental) return {message: 'Instrumental track', lines: []};
    const lines = [];
    const source = String(record?.syncedLyrics || '').slice(0, 64000);
    for (const line of source.split('\n').slice(0, 600)) {
        const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
        const text = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 500);
        for (const stamp of stamps) {
            if (Number(stamp[2]) >= 60) continue;
            lines.push({time: Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`), text});
        }
        if (lines.length >= 600) break;
    }
    if (lines.length) return {synced: true, lines: lines.slice(0, 600).sort((a, b) => a.time - b.time)};
    const plain = String(record?.plainLyrics || '').slice(0, 64000).split('\n').slice(0, 600)
        .map(text => ({time: null, text: text.slice(0, 500)}));
    return {synced: false, lines: plain.some(line => line.text.trim()) ? plain : [], message: 'Lyrics not found for this track.'};
}

export function lyricsKey(track) {
    return JSON.stringify([track?.title, track?.artist, track?.album, Math.round(track?.lengthSec || 0)]);
}

export function lyricsUrl(track) {
    if (!track?.title?.trim() || !track?.artist?.trim()) return null;
    const fields = {track_name: track.title.slice(0, 500), artist_name: track.artist.slice(0, 500)};
    if (track.album) fields.album_name = track.album.slice(0, 500);
    if (track.lengthSec >= 1 && track.lengthSec <= 3600) fields.duration = Math.round(track.lengthSec);
    return `https://lrclib.net/api/get?${Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
