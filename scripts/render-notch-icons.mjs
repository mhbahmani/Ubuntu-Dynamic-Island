// Static, full-color Meteocons derivatives. No browser or runtime animation.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const root = new URL('../assets/weather/', import.meta.url);
const sources = {sun: 'clear-day', night: 'clear-night', clouds: 'partly-cloudy-day',
    'clouds-night': 'partly-cloudy-night', rain: 'rain', snow: 'snow',
    'rain-night': 'partly-cloudy-night-rain', 'snow-night': 'partly-cloudy-night-snow'};
mkdirSync(new URL('notch/', root), {recursive: true});
for (const [name, source] of Object.entries(sources)) {
    let svg = readFileSync(new URL(`source/${source}.svg`, root), 'utf8')
        .replace(/<animate(?:Transform)?\b[^>]*\/>/g, '')
        .replace(/<animate(?:Transform)?\b[^>]*>[\s\S]*?<\/animate(?:Transform)?>/g, '')
        .replace(/viewBox="[^"]*"/, 'viewBox="6 8 52 48"');
    const hasCloud = !['sun', 'night'].includes(name);
    if (hasCloud) {
        // One viewport, cloud shape and scale for every cloud-bearing condition.
        // 0.945 is 5% larger than the previous 0.9 daytime cloud.
        svg = svg.replace('viewBox="6 8 52 48"', 'viewBox="0 4 58 52"');
        svg = svg.replace(/<path\b[^>]*stroke="#e6effc"[^>]*\/>/,
            '<g data-part="cloud" transform="translate(2.1825 5.06) scale(.945)">$&</g>');
        if (name.endsWith('night')) svg = svg.replace(/<path\b[^>]*stroke="#72b9d5"[^>]*>[\s\S]*?<\/path>/,
            '<g data-part="moon" transform="translate(-3 -2)">$&</g>');
        if (name === 'clouds') svg = svg.replace(/(<circle[\s\S]*?)(<g data-part="cloud")/,
            '<g transform="translate(-2 -3) translate(19 24) scale(1.28) translate(-19 -24)">$1</g>$2');
    }
    writeFileSync(new URL(`notch/${name}.svg`, root), svg);
}
