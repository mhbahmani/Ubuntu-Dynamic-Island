// Static, full-color Meteocons derivatives. No browser or runtime animation.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const root = new URL('../../extension/assets/weather/', import.meta.url);
const sources = {sun: 'clear-day', night: 'clear-night', clouds: 'partly-cloudy-day',
    'clouds-night': 'partly-cloudy-night', rain: 'rain', snow: 'snow',
    'rain-night': 'partly-cloudy-night-rain', 'snow-night': 'partly-cloudy-night-snow'};
// Square, ink-centered viewports. A square canvas maps onto the square icon
// slot without letterboxing, and centering on the visible ink keeps every
// condition balanced top-to-bottom in the notch: rain and snow drops otherwise
// hang about 9% low, while the clouds sun rides high. The side length keeps
// each family's previous rendered scale (58 for cloud scenes, 52 for sun and
// night). Bounds were measured from the rendered ink of each derivative at
// 480px; re-measure after changing the artwork or the transforms below.
const viewBoxes = {sun: '5.946 5.946 52 52', night: '6.163 5.946 52 52',
    clouds: '-1.088 -1.600 58 58', 'clouds-night': '1.208 1.060 58 58',
    rain: '3.383 6.260 58 58', snow: '3.383 6.260 58 58',
    'rain-night': '1.208 1.060 58 58', 'snow-night': '1.208 1.060 58 58'};
mkdirSync(new URL('notch/', root), {recursive: true});
for (const [name, source] of Object.entries(sources)) {
    let svg = readFileSync(new URL(`source/${source}.svg`, root), 'utf8')
        .replace(/<animate(?:Transform)?\b[^>]*\/>/g, '')
        .replace(/<animate(?:Transform)?\b[^>]*>[\s\S]*?<\/animate(?:Transform)?>/g, '');
    const hasCloud = !['sun', 'night'].includes(name);
    if (hasCloud) {
        // One cloud shape and scale for every cloud-bearing condition.
        // Shared cloud grows 5% about its center; keep sun slightly tucked behind it.
        svg = svg.replace(/<path\b[^>]*stroke="#e6effc"[^>]*\/>/,
            '<g data-part="cloud" transform="translate(.694125 3.548) scale(.99225)">$&</g>');
        if (name.endsWith('night')) svg = svg.replace(/<path\b[^>]*stroke="#72b9d5"[^>]*>[\s\S]*?<\/path>/,
            '<g data-part="moon" transform="translate(-3 -2)">$&</g>');
        if (name === 'clouds') svg = svg.replace(/(<circle[\s\S]*?)(<g data-part="cloud")/,
            '<g transform="translate(-1 -2) translate(19 24) scale(1.28) translate(-19 -24)">$1</g>$2');
    }
    svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBoxes[name]}"`);
    writeFileSync(new URL(`notch/${name}.svg`, root), svg);
}
