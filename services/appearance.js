// Fixed palettes keep preference values out of CSS interpolation. `top` and
// `bottom` are the tint gradient, `edge` the hairline border tone. All four
// stay dark and slightly desaturated so text reads on any wallpaper.
export const THEMES = Object.freeze({
    graphite: {top: [50, 52, 58], bottom: [27, 29, 34], edge: [232, 236, 246], accent: '#cc624d'},
    ocean: {top: [33, 50, 69], bottom: [17, 27, 40], edge: [176, 206, 236], accent: '#7fb3d5'},
    forest: {top: [37, 54, 47], bottom: [20, 32, 28], edge: [186, 222, 198], accent: '#8db596'},
    ember: {top: [61, 45, 38], bottom: [33, 25, 22], edge: [245, 214, 196], accent: '#dd9b72'},
});

export const themeAccent = theme => (THEMES[theme] ?? THEMES.graphite).accent;

const percent = (value, fallback) =>
    Math.max(0, Math.min(100, Number.isFinite(value) ? value : fallback));

// Style for the tint layer only (never the content). Opacity is always the
// final tint alpha. Matte flattens the glossy gradient toward its midpoint as
// part of the frosted treatment; it must never override transparency.
export function surfaceStyle(theme, opacity, matte = 0) {
    const palette = THEMES[theme] ?? THEMES.graphite;
    const alpha = percent(opacity, 98) / 100;
    const flatten = percent(matte, 0) / 100;
    const mean = palette.top.map((channel, index) => (channel + palette.bottom[index]) / 2);
    const stop = channels => channels.map((channel, index) =>
        Math.round(flatten * mean[index] + (1 - flatten) * channel)).join(',');
    return `background-color: transparent; background-gradient-start: rgba(${stop(palette.top)},${alpha}); ` +
        `background-gradient-end: rgba(${stop(palette.bottom)},${alpha}); ` +
        `border-color: rgba(${palette.edge.join(',')},0.13);`;
}

// Matte drives the frosted-glass strength: the backdrop blur radius (logical
// pixels, scaled for HiDPI) and a gentle dimming of what is behind. Opacity
// never changes the radius; a fully opaque tint hides the blur, so the effect
// is switched off there instead of being computed and painted over.
export const MAX_BLUR_RADIUS = 40;
export function blurParams(matte, scale = 1, opacity = 98) {
    const strength = percent(matte, 0) / 100;
    const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (strength <= 0 || percent(opacity, 98) >= 100) return {enabled: false, radius: 0, brightness: 1};
    return {
        enabled: true,
        radius: Math.max(1, Math.round(MAX_BLUR_RADIUS * strength ** 0.8 * factor)),
        brightness: Math.round((1 - 0.12 * strength) * 1000) / 1000,
    };
}

// GNOME 46's background blur paints axis-aligned rectangles. Approximate the
// rounded surface with non-overlapping slices whose corners lie on or inside
// each arc, so blur never leaks past the rounded edge. `steps` rows per
// corner band; the middle slice spans the full width.
export function backdropSlices(width, height, topRadius = 0, bottomRadius = 0, steps = 3) {
    const w = Math.max(0, Math.floor(width)), h = Math.max(0, Math.floor(height));
    if (!w || !h) return [];
    const limit = Math.min(w, h) / 2;
    let top = Math.max(0, Math.min(limit, Number.isFinite(topRadius) ? topRadius : 0));
    let bottom = Math.max(0, Math.min(limit, Number.isFinite(bottomRadius) ? bottomRadius : 0));
    const rows = radius => {
        const result = [];
        if (radius <= 0) return result;
        for (let k = 0; k < steps; k++) {
            const y0 = Math.round(radius * (1 - Math.cos(k * Math.PI / (2 * steps))));
            const y1 = Math.round(radius * (1 - Math.cos((k + 1) * Math.PI / (2 * steps))));
            if (y1 <= y0) continue;
            const dy = radius - y0;
            const inset = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)) - 1e-9);
            if (w - 2 * inset > 0) result.push({y0, y1, inset});
        }
        return result;
    };
    const topRows = rows(top), bottomRows = rows(bottom);
    const topEdge = topRows.length ? topRows[topRows.length - 1].y1 : Math.ceil(top);
    const bottomEdge = bottomRows.length ? bottomRows[bottomRows.length - 1].y1 : Math.ceil(bottom);
    const slices = topRows.map(({y0, y1, inset}) => ({x: inset, y: y0, width: w - 2 * inset, height: y1 - y0}));
    if (h - topEdge - bottomEdge > 0) slices.push({x: 0, y: topEdge, width: w, height: h - topEdge - bottomEdge});
    for (const {y0, y1, inset} of bottomRows.slice().reverse())
        slices.push({x: inset, y: h - y1, width: w - 2 * inset, height: y1 - y0});
    return slices;
}
