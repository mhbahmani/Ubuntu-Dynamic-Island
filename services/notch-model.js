export const NOTCH_ITEMS = ['media', 'weather', 'network', 'cpu', 'bluetooth', 'commute'];

// Tolerate stale/hand-edited settings while keeping every item exactly once.
export function notchOrder(value) {
    return [...new Set([...value.filter(id => NOTCH_ITEMS.includes(id)), ...NOTCH_ITEMS])];
}

export const ARROW_STYLES = ['classic', 'chevron'];
export const WEATHER_STYLES = ['colorful', 'minimal'];
export const ARROW_ANGLE_MIN = 40;
export const ARROW_ANGLE_MAX = 120;
export function arrowAngle(value) {
    return Math.max(ARROW_ANGLE_MIN, Math.min(ARROW_ANGLE_MAX, Number.isFinite(Number(value)) ? Number(value) : 80));
}
export function arrowSvg(style, direction, angle = 80) {
    const tangent = Math.tan(arrowAngle(angle) * Math.PI / 360);
    const halfWidth = Math.min(6, 6.5 * tangent), rise = halfWidth / tangent;
    const f = n => n.toFixed(4);
    const path = style === 'classic' ? 'M8 2.5 V13.5 M4.7 10 L8 13.5 L11.3 10'
        : `M${f(8 - halfWidth)} ${f(8 - rise / 2)} L8 ${f(8 + rise / 2)} L${f(8 + halfWidth)} ${f(8 - rise / 2)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${path}" ${direction === 'up' ? 'transform="rotate(180 8 8)"' : ''} fill="none" stroke="${direction === 'up' ? '#2eef81' : '#ff5249'}" stroke-width="${style === 'classic' ? 1.5 : 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function migrateArrowStyle(settings) {
    if (settings.get_string('pill-arrow-style') !== 'compact') return;
    if (settings.get_user_value('pill-arrow-angle') === null) settings.set_int('pill-arrow-angle', 60);
    settings.set_string('pill-arrow-style', 'chevron');
}
export function weatherSymbol(kind) {
    return ({sun: 'weather-clear-symbolic', night: 'weather-clear-night-symbolic',
        clouds: 'weather-few-clouds-symbolic', 'clouds-night': 'weather-few-clouds-night-symbolic',
        rain: 'weather-showers-symbolic', 'rain-night': 'weather-showers-symbolic',
        snow: 'weather-snow-symbolic', 'snow-night': 'weather-snow-symbolic'})[kind] ?? 'weather-few-clouds-symbolic';
}

export function commuteIndicator(state) {
    if (!state?.route) return {visible: false, text: '', description: ''};
    const data = state.data;
    const stale = Boolean(state.stale || state.status === 'error');
    const minutes = data ? Math.max(1, Math.round(data.seconds / 60)) : null;
    return {visible: true,
        text: minutes !== null ? `${stale ? '!' : data.traffic ? '' : '~'}${minutes}m` : state.status === 'loading' ? '…' : '—',
        description: `${state.route.name || `${state.route.originName || 'Start'} → ${state.route.destinationName || 'Destination'}`}: ${minutes !== null ? `${minutes} minutes, ${stale ? 'stale estimate, ' : ''}${data.traffic ? 'traffic-aware' : data.trafficUnverified ? 'traffic freshness unverified' : 'no live traffic'}` : state.error || (state.status === 'loading' ? 'updating' : 'estimate unavailable')}`,
        stale};
}
