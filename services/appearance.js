// Fixed palettes keep preference values out of CSS interpolation.
export const THEMES = Object.freeze({
    graphite: {top: [48, 50, 56], bottom: [29, 31, 36]},
    ocean: {top: [30, 47, 65], bottom: [20, 30, 44]},
    forest: {top: [36, 53, 47], bottom: [23, 35, 31]},
    ember: {top: [57, 43, 37], bottom: [35, 27, 24]},
});

// Opacity is always the final background alpha. Matte only flattens the
// gradient toward the palette midpoint; it must never override transparency.
export function surfaceStyle(theme, opacity, matte = 0) {
    const palette = THEMES[theme] ?? THEMES.graphite;
    const alpha = Math.max(0, Math.min(100, Number.isFinite(opacity) ? opacity : 98)) / 100;
    const flatten = Math.max(0, Math.min(100, Number.isFinite(matte) ? matte : 0)) / 100;
    const mean = palette.top.map((channel, index) => (channel + palette.bottom[index]) / 2);
    const stop = channels => channels.map((channel, index) =>
        Math.round(flatten * mean[index] + (1 - flatten) * channel)).join(',');
    return `background-color: transparent; background-gradient-start: rgba(${stop(palette.top)},${alpha}); ` +
        `background-gradient-end: rgba(${stop(palette.bottom)},${alpha});`;
}
