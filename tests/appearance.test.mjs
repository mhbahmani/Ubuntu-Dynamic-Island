import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceStyle, blurParams, backdropSlices, THEMES, MAX_BLUR_RADIUS} from '../services/appearance.js';

const stops = style => [style.match(/gradient-start: (rgba\([^)]+\))/)[1], style.match(/gradient-end: (rgba\([^)]+\))/)[1]];

test('appearance clamps background opacity without fading content', () => {
    for (const theme of Object.keys(THEMES)) {
        assert(stops(surfaceStyle(theme, 70)).every(color => color.endsWith(',0.7)')));
        assert(stops(surfaceStyle(theme, 100)).every(color => color.endsWith(',1)')));
        assert(!surfaceStyle(theme, 80).includes('opacity:'));
    }
    assert.equal(surfaceStyle('invalid', NaN), surfaceStyle('graphite', 98));
    assert(stops(surfaceStyle('ocean', 0)).every(color => color.endsWith(',0)')));
    assert(!surfaceStyle('ocean', 0).includes('NaN'));
    assert(stops(surfaceStyle('ocean', 1)).every(color => color.endsWith(',0.01)')));
    assert(stops(surfaceStyle('ocean', 0, 50)).every(color => color.endsWith(',0)')));
    assert.equal(surfaceStyle('forest', 500), surfaceStyle('forest', 100));
});

test('matte backing leaves the pure tint untouched at zero', () => {
    for (const theme of Object.keys(THEMES)) {
        for (const opacity of [70, 85, 98, 100]) {
            assert.equal(surfaceStyle(theme, opacity, 0), surfaceStyle(theme, opacity), theme);
            assert.equal(surfaceStyle(theme, opacity, -5), surfaceStyle(theme, opacity), theme);
        }
    }
});

test('full matte flattens color while preserving chosen opacity', () => {
    for (const theme of Object.keys(THEMES)) {
        for (const opacity of [70, 98, 100]) {
            const [start, end] = stops(surfaceStyle(theme, opacity, 100));
            assert(start.endsWith(`,${opacity / 100})`), start);
            assert.equal(start, end, theme); // both stops are the flat mid tone
        }
    }
    // Graphite mid tone: mean of [46,48,56] and [24,26,32].
    assert(surfaceStyle('graphite', 98, 100).includes('rgba(35,37,44,0.98)'));
});

test('every matte setting preserves the full opacity range', () => {
    for (const theme of Object.keys(THEMES))
        for (const matte of [0, 25, 60, 100])
            for (const opacity of [0, 1, 20, 50, 69, 70, 98, 100])
                for (const color of stops(surfaceStyle(theme, opacity, matte)))
                    assert(color.endsWith(`,${opacity / 100})`), color);
});

test('themes keep distinct tints and a theme-owned edge', () => {
    const tints = new Set(Object.keys(THEMES).map(theme => stops(surfaceStyle(theme, 75, 100))[0]));
    assert.equal(tints.size, Object.keys(THEMES).length);
    for (const theme of Object.keys(THEMES))
        assert(surfaceStyle(theme, 0).includes(`border-color: rgba(${THEMES[theme].edge.join(',')},0.13)`));
});

test('matte alone drives a progressively stronger blur', () => {
    assert.deepEqual(blurParams(0), {enabled: false, radius: 0, brightness: 1});
    assert.equal(blurParams(-10).enabled, false);
    assert.equal(blurParams(NaN).enabled, false);
    let previous = 0;
    for (const matte of [25, 50, 75, 100]) {
        const params = blurParams(matte, 1, 75);
        assert(params.enabled && params.radius > previous + 4, `${matte}: ${params.radius}`);
        assert(params.brightness <= 1 && params.brightness >= 0.85);
        previous = params.radius;
    }
    assert.equal(blurParams(100).radius, MAX_BLUR_RADIUS);
    assert.equal(blurParams(100, 2).radius, 2 * MAX_BLUR_RADIUS);
    assert.equal(blurParams(1).radius >= 1, true);
});

test('opacity never changes the blur, and an opaque tint switches it off', () => {
    for (const matte of [25, 75, 100]) {
        const reference = blurParams(matte, 1, 75);
        for (const opacity of [0, 25, 50, 99])
            assert.deepEqual(blurParams(matte, 1, opacity), reference);
        assert.equal(blurParams(matte, 1, 100).enabled, false);
    }
});

function insideRounded(x, y, w, h, top, bottom) {
    const corner = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-6;
    if (x < 0 || y < 0 || x > w || y > h) return false;
    if (y < top && x < top) return corner(top, top, top);
    if (y < top && x > w - top) return corner(w - top, top, top);
    if (y > h - bottom && x < bottom) return corner(bottom, h - bottom, bottom);
    if (y > h - bottom && x > w - bottom) return corner(w - bottom, h - bottom, bottom);
    return true;
}

test('backdrop slices stay inside the rounded surface without overlapping', () => {
    for (const [w, h, top, bottom] of [[440, 320, 20, 20], [880, 640, 40, 40], [170, 34, 20, 20],
        [170, 34, 0, 18], [400, 300, 0, 0], [60, 20, 20, 20], [3, 3, 20, 20]]) {
        const slices = backdropSlices(w, h, top, bottom);
        const t = Math.min(top, w / 2, h / 2), b = Math.min(bottom, w / 2, h / 2);
        let area = 0;
        for (const s of slices) {
            assert(s.width > 0 && s.height > 0 && Number.isInteger(s.x) && Number.isInteger(s.y));
            for (const [x, y] of [[s.x, s.y], [s.x + s.width, s.y], [s.x, s.y + s.height], [s.x + s.width, s.y + s.height]])
                assert(insideRounded(x, y, w, h, t, b), `${w}x${h} r${top}/${bottom}: ${JSON.stringify(s)}`);
            area += s.width * s.height;
        }
        for (let i = 0; i < slices.length; i++)
            for (let j = i + 1; j < slices.length; j++) {
                const a = slices[i], c = slices[j];
                const overlap = a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
                assert(!overlap, `${JSON.stringify(a)} overlaps ${JSON.stringify(c)}`);
            }
        assert(slices.length <= 7);
        if (h >= 200) {
            const rounded = w * h - (4 - Math.PI) * (t * t + b * b) / 2;
            assert(area / rounded > 0.985, `${w}x${h} coverage ${area / rounded}`);
        }
    }
    assert.deepEqual(backdropSlices(0, 100, 20, 20), []);
    assert.deepEqual(backdropSlices(400, 300, 0, 0), [{x: 0, y: 0, width: 400, height: 300}]);
});

import {readFileSync} from 'node:fs';
import {THEME_IDS, TEXT, BUTTON_TEXT, hexToRgb, contrast, mix, themeSwatchCss} from '../services/themes.js';
import {themeCss, generatedRegion} from '../scripts/theme-css.mjs';

const rgb = value => typeof value === 'string' ? hexToRgb(value) : value;
const hex = /^#[0-9a-f]{6}$/;

test('every theme is readable on its own tint at any opacity-backed blend', () => {
    for (const id of THEME_IDS) {
        const theme = THEMES[id];
        for (const key of ['accent', 'secondary', 'strong', 'strongHover', 'strongPressed', 'history', 'chartDown', 'chartUp', 'todayBorder', 'marker', 'focus', 'heading'])
            assert.match(theme[key], hex, `${id}.${key}`);
        assert.notEqual(theme.chartDown, theme.chartUp, `${id}: distinct network series`);
        // Check against both stops and the matte midpoint.
        for (const tint of [theme.top, theme.bottom, mix(theme.top, theme.bottom, 0.5)]) {
            assert(contrast(rgb(TEXT), tint) >= 7, `${id}: primary text`);
            assert(contrast(rgb(theme.secondary), tint) >= 4.5, `${id}: secondary text`);
            assert(contrast(rgb(theme.accent), tint) >= 4.5, `${id}: accent text`);
            assert(contrast(rgb(theme.history), tint) >= 3, `${id}: chart line`);
            assert(contrast(rgb(theme.chartDown), tint) >= 4.5, `${id}: download line and rate`);
            assert(contrast(rgb(theme.chartUp), tint) >= 4.5, `${id}: upload line and rate`);
            assert(contrast(rgb(theme.focus), tint) >= 3, `${id}: focus ring`);
            assert(contrast(rgb(theme.heading), tint) >= 4.5, `${id}: section heading`);
        }
        for (const key of ['strong', 'strongHover', 'strongPressed'])
            assert(contrast(rgb(theme[key]), rgb(BUTTON_TEXT)) >= 4.5, `${id}: text on ${key}`);
    }
});

test('themes are distinct and colorful, with graphite kept neutral', () => {
    const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    assert(THEME_IDS.length >= 10);
    assert.equal(new Set(THEME_IDS.map(id => THEMES[id].accent)).size, THEME_IDS.length);
    assert.equal(new Set(THEME_IDS.map(id => THEMES[id].label)).size, THEME_IDS.length);
    for (const id of THEME_IDS.filter(id => id !== 'graphite')) {
        assert(saturation(THEMES[id].top) >= 0.15, `${id}: tint is too grey`);
        assert(saturation(rgb(THEMES[id].accent)) >= 0.35, `${id}: accent is too dull`);
    }
    assert(saturation(THEMES.graphite.surface) < 0.1 && saturation(THEMES.graphite.edge) < 0.1);
    assert.deepEqual(THEME_IDS.slice(0, 4), ['graphite', 'ocean', 'forest', 'ember']); // keeps saved indices stable
});

test('schema choices and the stylesheet follow the theme list', () => {
    const schema = readFileSync(new URL('../schemas/org.gnome.shell.extensions.ubuntu-island.gschema.xml', import.meta.url), 'utf8');
    const key = schema.slice(schema.indexOf('<key name="color-theme"'), schema.indexOf('</key>', schema.indexOf('<key name="color-theme"')));
    assert.deepEqual([...key.matchAll(/<choice value="([^"]+)"/g)].map(m => m[1]), [...THEME_IDS]);
    const css = readFileSync(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.equal(generatedRegion(css), themeCss(), 'stylesheet.css is stale: run `node scripts/theme-css.mjs`');
    for (const id of THEME_IDS) assert(css.includes(`.ubuntu-island-theme-${id} .ubuntu-island-tab-marker`) ||
        css.includes(`.ubuntu-island-theme-${id} .ubuntu-island-tab-selected .ubuntu-island-tab-marker`), id);
});

test('generated CSS themes tabs, navigation, headings and focus rings', () => {
    const css = themeCss();
    assert(!css.includes(':hover .ubuntu-island-tab-marker'), 'no hover marker rule');
    assert(!readFileSync(new URL('../stylesheet.css', import.meta.url), 'utf8')
        .includes(':hover .ubuntu-island-tab-marker'), 'no base hover marker rule');
    for (const id of THEME_IDS) {
        const T = `.ubuntu-island-theme-${id}`;
        const {accent, focus, heading, secondary, bottom} = THEMES[id];
        assert(css.includes(`${T} .ubuntu-island-tab-slider { background-color: ${accent}; }`), `${id}: slider`);
        assert(css.includes(`${T} .ubuntu-island-tab-selected { color: ${accent}; }`), `${id}: selected icon`);
        assert(css.includes(`${T} .ubuntu-island-tab-selected .ubuntu-island-tab-marker { background-color: transparent; }`), `${id}: own marker`);
        assert(css.includes(`${T} .ubuntu-island-tab:focus .ubuntu-island-tab-marker { background-color: ${focus}; }`), `${id}: focus marker`);
        const focusedSelected = `${T} .ubuntu-island-tab-selected:focus .ubuntu-island-tab-marker { background-color: transparent; }`;
        assert(css.indexOf(focusedSelected) > css.indexOf(`${T} .ubuntu-island-tab:focus .ubuntu-island-tab-marker`),
            `${id}: only the slider marks a focused selected tab`);
        assert(css.includes(`${T} .ubuntu-island-navigation { background-color: rgba(${bottom.join(',')},0.32);`), `${id}: navigation`);
        assert(css.includes(`${T} .ubuntu-island-navigation .ubuntu-island-navigation-caption { color: ${accent}; }`), `${id}: caption`);
        assert(new RegExp(`\\${T} \\.ubuntu-island-seal:focus[^{]*\\{ box-shadow: inset 0 0 0 2px ${focus}; \\}`).test(css), `${id}: seal focus`);
        assert(css.includes(`${T} .ubuntu-island-header, ${T} .ubuntu-island-agent-heading { color: ${heading}; }`), `${id}: heading`);
        assert(!css.includes(`${T} .ubuntu-island-header, ${T} .ubuntu-island-muted`), `${id}: header left the secondary list`);
        assert(contrast(rgb(accent), bottom) >= 4.5, `${id}: caption on the bar`);
    }
    assert.equal(THEMES.graphite.heading, THEMES.graphite.secondary); // Graphite stays calm
    assert.equal(THEMES.graphite.marker, THEMES.graphite.accent);
    assert(!css.includes('#ffb38a'));
    assert.equal(css.split('{').length, css.split('}').length);
});

test('generated CSS shares network colours between chart properties and rate labels', () => {
    const css = themeCss();
    for (const id of THEME_IDS) {
        const T = `.ubuntu-island-theme-${id}`;
        const {chartDown, chartUp} = THEMES[id];
        assert(css.includes(`${T} .ubuntu-island-network-down { color: ${chartDown}; }`), `${id}: download rate`);
        assert(css.includes(`${T} .ubuntu-island-network-up { color: ${chartUp}; }`), `${id}: upload rate`);
        assert(css.includes(`${T} .ubuntu-island-history-network { -ubuntu-island-chart-down: ${chartDown}; ` +
            `-ubuntu-island-chart-up: ${chartUp}; }`), `${id}: chart colours`);
    }
});

test('preferences swatches preview every theme tint and accent', () => {
    const css = themeSwatchCss();
    for (const id of THEME_IDS) {
        const {top, bottom, accent} = THEMES[id];
        assert(css.includes(`.ubuntu-island-theme-swatch-${id} { background-image: linear-gradient(to bottom, rgb(${top.join(',')}), rgb(${bottom.join(',')}));`), id);
        assert(css.includes(`.ubuntu-island-theme-swatch-${id} .ubuntu-island-theme-swatch-accent { background-color: ${accent}; }`), id);
    }
    assert.equal(css.split('{').length, css.split('}').length);
});
