# Weather artwork

Premade animated [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius,
MIT licensed; see [LICENSE](source/LICENSE). Bundled from `@bybas/weather-icons@2.0.0`:
`https://cdn.jsdelivr.net/npm/@bybas/weather-icons@2.0.0/production/fill/all/`.
The eight original SVG files are retained in `source/` unchanged. No runtime
artwork downloads or animation engine are required.

The PNGs are 8 × 6 atlases of 192px transparent tiles (48 frames each).
`manifest.json` records the source and loop duration. Sun rotation is sampled
across one identical-ray cycle. Snowflake rotation is retimed from 9 to 8 seconds
only during rendering to match the four-second falling loop. The moon is held stationary in rain-night and snow-night to preserve seamless
short precipitation loops; cloudy-night retains the authored moon movement.
Other motion is from the upstream artwork. The scene uses one selected atlas at a time.

Regenerate from the repository root using Chrome, Node, Python/Pillow and
Playwright (development dependencies only):

```sh
npm install --prefix /tmp/island-weather-assets playwright
PLAYWRIGHT_MODULE=/tmp/island-weather-assets/node_modules/playwright/index.mjs node scripts/render-weather-assets.mjs
```

Set `CHROME` if Chrome is not at `/usr/bin/google-chrome`. Rendering uses the
bundled SVGs offline. Runtime changes must keep frame counts and durations in
`weather-scene.js` consistent with this manifest.

`notch/` contains static full-color SVG derivatives of these same MIT assets.
Clouds remain pale blue/white beside the yellow sun; rain, snow and night scenes
retain their own colors. Animation tags are removed and the viewBox is cropped
for small icons. All cloud-bearing icons share the same cloud transform. The
daytime sun is enlarged and the night moon shifted left/up so each remains
visible. The common cloud scale is 0.99225 (another 5% increase), centered consistently
across conditions. The sun is shifted slightly right/down behind the cloud. Each
icon is cropped to a square viewBox centered on its rendered ink, so rain drops
hanging below the cloud no longer push the icon low inside the notch slot.
Regenerate with `node scripts/render-notch-icons.mjs`.
