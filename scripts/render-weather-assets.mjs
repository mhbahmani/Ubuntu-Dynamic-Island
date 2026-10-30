// Development only. npm install --prefix /tmp/island-weather-assets playwright
// PLAYWRIGHT_MODULE=/tmp/island-weather-assets/node_modules/playwright/index.mjs node scripts/render-weather-assets.mjs
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const folder = resolve('assets/weather');
const temporary = await mkdtemp(join(tmpdir(), 'island-weather-frames-'));
const browser = await chromium.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true});
const page = await browser.newPage({viewport: {width: 192, height: 192}, deviceScaleFactor: 1});
const manifest = {version: 1, tile: 192, columns: 8, frames: 48, scenes: {}};
try {
    for (const [kind, source] of Object.entries({sun: 'clear-day', clouds: 'partly-cloudy-day', rain: 'rain', snow: 'snow', night: 'clear-night', 'clouds-night': 'partly-cloudy-night', 'rain-night': 'partly-cloudy-night-rain', 'snow-night': 'partly-cloudy-night-snow'})) {
        let svg = await readFile(join(folder, 'source', `${source}.svg`), 'utf8');
        // Eight identical sun rays repeat after 1/8 of a rotation. Snowflake
        // rotation is retimed from 9 to 8 seconds so its symmetric pose loops
        // with the authored 4-second fall. Source files remain unmodified.
        if (kind.startsWith('snow')) svg = svg.replaceAll('dur="9s"', 'dur="8s"');
        // Keep the moon stationary in precipitation scenes so their short loops
        // remain seamless without accelerating the authored moon movement.
        if (kind === 'rain-night' || kind === 'snow-night')
            svg = svg.replace(/<animateTransform\b[^>]*dur="10s"[^>]*\/>/g, '');
        const duration = {sun: 5.625, clouds: 5.625, rain: 0.7, snow: 4, night: 10, 'clouds-night': 10, 'rain-night': 0.7, 'snow-night': 4}[kind];
        if (duration > 60) throw Error(`Cycle too long: ${kind}`);
        manifest.scenes[kind] = {duration, source};
        await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:192px;height:192px;display:block}</style>${svg}`);
        await page.evaluate(() => document.querySelector('svg').pauseAnimations());
        for (let frame = 0; frame < 48; frame++) {
            await page.evaluate(time => document.querySelector('svg').setCurrentTime(time), frame * duration / 48);
            await page.screenshot({path: join(temporary, `${kind}-${frame}.png`), omitBackground: true});
        }
        const result = spawnSync('python3', ['-c', `from PIL import Image
from pathlib import Path
import sys
root,kind,dest=sys.argv[1:]
out=Image.new('RGBA',(1536,1152))
for i in range(48):
 im=Image.open(Path(root)/f'{kind}-{i}.png').convert('RGBA')
 out.paste(im,((i%8)*192,(i//8)*192))
out.save(Path(dest)/f'{kind}.png',optimize=True)`, temporary, kind, folder], {stdio: 'inherit'});
        if (result.status) throw Error('Atlas packing failed');
        console.log(`${kind}: ${duration}s, 48 frames`);
    }
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally { await browser.close(); }
