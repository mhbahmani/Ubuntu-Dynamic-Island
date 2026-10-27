// Fixed palettes keep preference values out of CSS interpolation.
export const THEMES = Object.freeze({
    graphite: {top: [48, 50, 56], bottom: [29, 31, 36]},
    ocean: {top: [30, 47, 65], bottom: [20, 30, 44]},
    forest: {top: [36, 53, 47], bottom: [23, 35, 31]},
    ember: {top: [57, 43, 37], bottom: [35, 27, 24]},
});

// `opacity` is the transparency of the theme tint; `matte` adds a solid
// backing layer in the palette's mid tone on top of that tint. The two are
// folded into one gradient: at matte 100% the surface becomes the flat mid
// tone regardless of opacity, so the island reads as a frosted panel instead
// of clear glass. Text and controls paint fully opaque above it.
export function surfaceStyle(theme, opacity, matte = 0) {
    const palette = THEMES[theme] ?? THEMES.graphite;
    const alpha = Math.max(0, Math.min(100, Number.isFinite(opacity) ? opacity : 98)) / 100;
    const flatten = Math.max(0, Math.min(100, Number.isFinite(matte) ? matte : 0)) / 100;
    // Composite of tint(alpha) + matte layer(flatten): out = matte*mid +
    // (1-matte)*alpha*stop over (1-(1-alpha)*(1-matte)) background bleed.
    const alphaEff = flatten <= 0 ? alpha : flatten >= 1 ? 1 : 1 - (1 - alpha) * (1 - flatten);
    const mean = palette.top.map((channel, index) => (channel + palette.bottom[index]) / 2);
    const stop = channels => alphaEff === 0 ? channels.join(',') : channels
        .map((channel, index) =>
            Math.round((flatten * mean[index] + (1 - flatten) * alpha * channel) / alphaEff))
        .join(',');
    return `background-gradient-start: rgba(${stop(palette.top)},${alphaEff}); ` +
        `background-gradient-end: rgba(${stop(palette.bottom)},${alphaEff});`;
}
