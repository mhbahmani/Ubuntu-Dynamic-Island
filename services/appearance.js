// Fixed palettes keep preference values out of CSS interpolation.
export const THEMES = Object.freeze({
    graphite: {top: [48, 50, 56], bottom: [29, 31, 36]},
    ocean: {top: [30, 47, 65], bottom: [20, 30, 44]},
    forest: {top: [36, 53, 47], bottom: [23, 35, 31]},
    ember: {top: [57, 43, 37], bottom: [35, 27, 24]},
});

export function surfaceStyle(theme, opacity) {
    const palette = THEMES[theme] ?? THEMES.graphite;
    const alpha = Math.max(70, Math.min(100, Number.isFinite(opacity) ? opacity : 98)) / 100;
    return `background-gradient-start: rgba(${palette.top.join(',')},${alpha}); ` +
        `background-gradient-end: rgba(${palette.bottom.join(',')},${alpha});`;
}
