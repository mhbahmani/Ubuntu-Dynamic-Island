// Theme palettes. Each theme is a few hand-picked seeds: the tint gradient
// (`top`, `bottom`, both dark so light text always reads) and one saturated
// `accent`. Every other token is derived here so new themes stay consistent
// and readable; tests/appearance.test.mjs checks the contrast of every theme.
// The order is the order shown in Preferences: append new themes at the end.
const SEEDS = [
    ['graphite', 'Graphite', [46, 48, 56], [24, 26, 32], '#f07a5c', {neutral: true}],
    ['ocean', 'Ocean', [20, 52, 92], [9, 25, 52], '#4fb3f0'],
    ['forest', 'Forest', [18, 66, 44], [8, 34, 24], '#4fcf8a'],
    ['ember', 'Ember', [86, 38, 24], [42, 18, 13], '#ff8a4c'],
    ['lagoon', 'Lagoon', [12, 70, 76], [6, 35, 41], '#3fd6c8'],
    ['amethyst', 'Amethyst', [62, 34, 98], [30, 16, 52], '#b68cff'],
    ['berry', 'Berry', [92, 26, 64], [46, 12, 34], '#ff6fae'],
    ['midnight', 'Midnight', [30, 36, 96], [13, 16, 50], '#8a9cff'],
    ['aurora', 'Aurora', [12, 70, 74], [44, 20, 82], '#5ee6c5'],
    ['sunset', 'Sunset', [78, 28, 82], [86, 34, 18], '#ffa45c'],
    ['mocha', 'Mocha', [76, 48, 32], [38, 23, 15], '#e3b27a'],
];

export const TEXT = '#eceef2';
export const BUTTON_TEXT = '#f6f7f9';

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
export const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = rgb => `#${rgb.map(c => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => a.map((channel, i) => clampByte(channel + (b[i] - channel) * t));

export function luminance(rgb) {
    const [r, g, b] = rgb.map(c => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]) {
    [r, g, b] = [r / 255, g / 255, b / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
    if (s === 0) return [l, l, l].map(v => clampByte(v * 255));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = t => {
        t = (t + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => clampByte(v * 255));
}

// Filled controls read as rich rather than neon: cap their saturation.
const STRONG_SATURATION = 0.62;
const withLightness = (rgb, lightness, maxSaturation = 1) => {
    const [h, s] = rgbToHsl(rgb);
    return hslToRgb([h, Math.min(s, maxSaturation), Math.max(0, Math.min(1, lightness))]);
};

// The lightest shade (≥ 5.4:1, so hover stays ≥ 4.5:1) of the accent that still carries button text.
function strongShade(accent) {
    const text = hexToRgb(BUTTON_TEXT);
    let lightness = Math.min(rgbToHsl(accent)[2], 0.5);
    let shade = withLightness(accent, lightness, STRONG_SATURATION);
    while (contrast(shade, text) < 5.4 && lightness > 0.05) {
        lightness -= 0.01;
        shade = withLightness(accent, lightness, STRONG_SATURATION);
    }
    return {shade, lightness};
}

// Lowest contrast of `rgb` against the tint stops and their matte midpoint.
const tintContrast = (rgb, top, bottom) =>
    Math.min(...[top, bottom, mix(top, bottom, 0.5)].map(tint => contrast(rgb, tint)));

// Mix `from` toward `toward` starting at `t`, moving further until the result
// reaches `ratio` against the tint (both targets are light, so this converges).
function mixUntil(from, toward, t, ratio, top, bottom) {
    let color = mix(from, toward, t);
    while (tintContrast(color, top, bottom) < ratio && t < 1) {
        t = Math.min(1, t + 0.02);
        color = mix(from, toward, t);
    }
    return color;
}

function derive([id, label, top, bottom, accentHex, options = {}]) {
    const accent = hexToRgb(accentHex);
    const white = [255, 255, 255];
    const text = hexToRgb(TEXT);
    const {shade: strong, lightness} = strongShade(accent);
    const secondary = rgbToHex(mix(mix(text, accent, options.neutral ? 0 : 0.3), bottom, 0.18));
    const [hue, saturation, accentLightness] = rgbToHsl(accent);
    const download = hslToRgb([(hue + 150 / 360) % 1, saturation, accentLightness]);
    return Object.freeze({
        id, label, top, bottom, accent: accentHex,
        // Light, accent-tinted overlays for cards, borders and the panel edge.
        // Graphite keeps neutral surfaces; the accent only marks controls.
        edge: options.neutral ? [232, 236, 246] : mix(accent, white, 0.55),
        surface: options.neutral ? [235, 239, 255] : mix(accent, white, 0.4),
        // Secondary text leans toward the accent, dimmed toward the tint.
        secondary,
        strong: rgbToHex(strong),
        strongHover: rgbToHex(withLightness(strong, lightness + 0.035)),
        strongPressed: rgbToHex(withLightness(strong, lightness - 0.05)),
        history: rgbToHex(mix(accent, white, 0.18)),
        // Paired chart lines and rate text: light tints, with download rotated
        // 150 degrees from the accent at the same starting lightness.
        chartDown: rgbToHex(mixUntil(download, white, 0.25, 4.5, top, bottom)),
        chartUp: rgbToHex(mixUntil(accent, white, 0.25, 4.5, top, bottom)),
        todayBorder: rgbToHex(mix(strong, accent, 0.55)),
        marker: accentHex,
        // Keyboard focus rings: a light accent tint (non-text UI, >= 3:1).
        focus: rgbToHex(mixUntil(accent, white, 0.35, 3, top, bottom)),
        // Section headings lean toward the accent from primary text (>= 4.5:1);
        // Graphite keeps calm neutral headings.
        heading: options.neutral ? secondary : rgbToHex(mixUntil(accent, text, 0.55, 4.5, top, bottom)),
    });
}

export const THEMES = Object.freeze(Object.fromEntries(SEEDS.map(seed => [seed[0], derive(seed)])));
export const THEME_IDS = Object.freeze(SEEDS.map(seed => seed[0]));
export const DEFAULT_THEME = 'graphite';
export const themeAccent = theme => (THEMES[theme] ?? THEMES[DEFAULT_THEME]).accent;

// GTK CSS for the swatches in Preferences: a chip painted with the theme's
// tint gradient and edge, holding a dot of its accent.
export function themeSwatchCss() {
    const rgb = channels => `rgb(${channels.join(',')})`;
    return [
        '.ubuntu-island-theme-swatch { min-width: 40px; min-height: 24px; border-radius: 7px; }',
        '.ubuntu-island-theme-swatch-accent { min-width: 9px; min-height: 9px; border-radius: 999px; margin-right: 6px; }',
        ...THEME_IDS.map(id => {
            const theme = THEMES[id];
            return `.ubuntu-island-theme-swatch-${id} { background-image: linear-gradient(to bottom, ${rgb(theme.top)}, ${rgb(theme.bottom)}); ` +
                `box-shadow: inset 0 0 0 1px rgba(${theme.edge.join(',')},0.28); } ` +
                `.ubuntu-island-theme-swatch-${id} .ubuntu-island-theme-swatch-accent { background-color: ${theme.accent}; }`;
        }),
    ].join('\n');
}
