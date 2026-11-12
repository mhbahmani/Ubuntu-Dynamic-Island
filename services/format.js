// Pure helpers shared by the UI and services; testable with Node.

// Binary rates in a four-character slot. At the largest supported unit,
// saturate at 999G; the accessible description retains the full rate.
export function compactRate(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—';
    const units = ['B', 'K', 'M', 'G'];
    let value = bytesPerSecond, unit = 0;
    while (Math.round(value) >= 1000 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const tenth = Math.round(value * 10) / 10;
    const number = unit > 0 && tenth < 10
        ? tenth.toFixed(1) : String(Math.min(999, Math.round(value)));
    return `${number}${units[unit]}`;
}

export function hashUri(uri) {
    // FNV-1a 32-bit: deterministic cache-file names without pulling in GLib.
    let hash = 0x811c9dc5;
    for (let i = 0; i < uri.length; i++) {
        hash ^= uri.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function clampFraction(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// Interpolates the playback position between MPRIS Position/Seeked updates.
export function estimatePositionSec(baseUs, baseMonotonicSec, nowMonotonicSec, playing) {
    if (!Number.isFinite(baseUs) || baseUs < 0) return null;
    const baseSec = baseUs / 1e6;
    if (!playing) return baseSec;
    return baseSec + Math.max(0, nowMonotonicSec - baseMonotonicSec);
}
