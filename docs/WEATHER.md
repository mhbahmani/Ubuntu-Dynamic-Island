# Weather (v11)

Weather data and a bounded native animated scene, retaining the existing matte
style. Motion is optional and independent of weather fetching.

## Local preview (no installation/logout)

Run `make preview` from the repository root for an interactive nested
GNOME window with sample weather, or use `make preview-live` for real weather. It opens the
actual Weather tab automatically with an example Tehran location. Preferences
apply inside the private preview only. Close and rerun after editing code.

## Motion preview

Use `make preview-sun-day`, `make preview-clouds-day`, `make preview-rain-day`,
`make preview-snow-day`, `make preview-night`, `make preview-clouds-night`,
`make preview-rain-night`, or `make preview-snow-night` for animated samples. These shortcuts
bypass power saver inside the preview only and accept `PREVIEW_ARGS` as usual.

```sh
make preview PREVIEW_ARGS="--scene rain --ignore-power-saver"
make preview PREVIEW_ARGS="--scene snow --ignore-power-saver"
make preview PREVIEW_ARGS="--scene sun --motion subtle"
```

Scenes: sun, clouds, rain, snow, night, clouds-night, rain-night, snow-night. The preview defaults to Live; the extension
uses Subtle by default. Preferences → Weather motion selects Off (static), Subtle
(four seconds on entry), or Live (while visible). Night uses Open-Meteo's `is_day`
or the MET Norway symbol suffix for all conditions when available; missing
day/night information does not claim astronomical accuracy.
The sun's small movement is decorative, not a calculated solar trajectory.

The weather surface layers bundled Meteocons artwork behind live text, with a
large current temperature and four horizontal forecast columns. The layout takes
inspiration from [Apple Weather](https://support.apple.com/guide/weather-mac/welcome/mac)
and [CARROT Weather](https://www.meetcarrot.com/weather/presskit.html).

The premade SVG animations are rendered into PNG atlases at development time.
Runtime selects frames from one texture every 84 ms (under 12 updates/second),
with no procedural drawing, video, webview, blur or extra weather polling.
Each atlas has 48 frames and consumes about 6.75 MiB decoded, excluding driver
and temporary decoder overhead. Only the selected condition is loaded.
Timers stop on hiding, scrolling fully out of view, lock, reduced motion, power
saver, or destruction. Returning to a visible scene starts motion again. Subtle
stops after four seconds. The weather page shares the standard 260px island height. Current temperature
and condition sit side by side, followed by details and the four-hour forecast.
Freshness and source share the bottom line. Enlarged text can scroll.
See [asset provenance and regeneration](../assets/weather/README.md) for the MIT
license, upstream version and optional development dependencies.

`--ignore-power-saver` is an explicit preview-only override; it never changes the
host power profile. No override for reduced motion is provided. Native tests check
animation lifecycle and report texture-frame selection timings; these exclude compositor/GPU
cost and are not a host CPU/battery guarantee. High-DPI and laptop profiling remain
necessary before recommending prolonged Live mode.

## Setup

1. Install v11 with `make install`, then log out/in on Wayland to load new code.
2. In Island preferences, enable Weather and disable/re-enable the extension.
3. Search a city (English or Persian), press Apply, then select **Use** on the
   matching region/country. The location is not guessed from the machine's IP.
4. If city search is unavailable, enter coordinates and an IANA timezone, e.g.
   `35.6892, 51.3890, Asia/Tehran`, and press Apply.
5. Open the Weather tab. Location, units, and preferred provider apply live.

No API key is needed. Preferences show the selected location. City search sends
its query to Open-Meteo geocoding; weather requests send saved coordinates to the
preferred provider and, on failure, the remaining providers in order. Manual
coordinates avoid a dependency on geocoding availability. No continuous location
tracking.

## Sources and fallback

Verified documentation and live endpoints on 2026-10-28 (MET Norway on 2026-11-03):

| Provider | Integration | Result |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/docs) | Default, global current/hourly forecast | Live Tehran request succeeded through GJS/Soup |
| [MET Norway](https://api.met.no/doc/locationforecast/FAQ) | Keyless backup ([locationforecast 2.0 `complete`](https://api.met.no/weatherapi/locationforecast/2.0/documentation)), User-Agent identification only, CC BY 4.0/NLOD, 20 req/s cap | Live Tehran request succeeded through GJS/Soup (2026-11-03); forecast-only data, so the entry covering "now" stands in for current conditions |
| [wttr.in](https://github.com/chubin/wttr.in#json-output) | Keyless alternate (`format=j1`, coordinates), WorldWeatherOnline data | Live Tehran request succeeded through GJS/Soup on 2026-10-28; unreachable from this network on 2026-11-03, which motivated the MET Norway backup |
| [One-API, Iran](https://one-api.ir/2021/04/09/api-%D9%87%D9%88%D8%A7%D8%B4%D9%86%D8%A7%D8%B3%DB%8C-%D9%88-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%AC%D9%88%DB%8C/) | Researched, not integrated | Documents coordinate-based current/hourly endpoints; requires a user token |
| [Sameteo, Iran](https://sameteo.com/products/web-service) | Researched, not integrated | Advertises Iranian weather APIs with account/trial access; no authenticated endpoint validated |
| [Codebazan, Iran](https://codebazan.ir/%D9%88%D8%A8-%D8%B3%D8%B1%D9%88%DB%8C%D8%B3-%DA%A9%D8%A7%D8%B1%D8%A8%D8%B1%D8%AF%DB%8C-%D8%B3%D8%B1%DB%8C-%D8%B3%D9%88%D9%85/) | Researched, not integrated | Published `api.codebazan.ir/havairan/?unit=metric&city=tehran` returned HTTP 403 from this environment |

Either implemented provider can be preferred; failures, timeouts and malformed
responses try the remaining providers in order (Open-Meteo → MET Norway → wttr.in
by default). Successful results identify their actual source.
These are separate services, not a guarantee of entirely independent upstream
meteorological data or availability from every Iranian network. The Iranian
options above are not claimed as working fallback integrations. A future token
integration should use the desktop secret store, never GSettings or bundled keys.

Open-Meteo's free API is for non-commercial use; its data uses CC BY 4.0.
See [provider terms](https://open-meteo.com/en/terms). MET Norway data is
CC BY 4.0/NLOD; it needs no key but rejects coordinates beyond four decimals
(the request URL truncates them) and asks for an identifying User-Agent, which
the weather HTTP client sends. Source attribution is shown
in the tab. wttr's forecast is often three-hourly; the UI displays returned times
and does not invent hourly samples. MET Norway publishes no precipitation
probability, so its forecast cells show no rain percentage rather than an
invented number. Rain is precipitation probability, not a
minute-precise prediction. All providers are normalized to Celsius and km/h
(MET Norway wind arrives in m/s and is converted); day/night comes from
Open-Meteo `is_day` or the MET Norway symbol suffix. Fahrenheit is a display
conversion. Forecast times use the saved location's
IANA timezone, including date boundaries. Fetch age and provider observation time
are different: “Fetched” describes retrieval, not guaranteed observation freshness.

## Lifecycle and bounds

- Optional service: no network/timers while disabled. First request on viewing.
- Refresh every 20 minutes while viewed; explicit refresh button. Hidden tabs,
  hidden surfaces and disable cancel in-flight work and remove refresh timers.
  The optional collapsed weather indicator also keeps the normal 20-minute refresh
  active while visible; it never starts the animated scene.
- One refresh at a time, sequential provider fallback. Network recovery checks
  freshness only when active. Offline retries do not issue HTTP requests.
- Exponential retry delay with jitter, capped around 20 minutes. HTTP 401/403/429
  suppress automatic retries of that provider until manual refresh or reconfigure.
- Asynchronous streamed Soup requests, 12-second socket timeout, 15-second hard
  deadline, 256 KiB body cap, redirects disabled. No shell subprocess polling.
- At most 24 forecast entries in the model, four displayed. Existing content stays
  visible during refresh; failed refreshes explicitly mark retained data stale.
- One schema-versioned cache file, 32 KiB cap, asynchronous atomic private writes:
  `$XDG_CACHE_HOME/ubuntu-island/weather-v1.json` (normally under `~/.cache`).
  Cache results are matched to the saved location; old locations cannot populate
  a new location. Removing this file clears persisted weather data.
- Disable/location changes guard against late async results. Animation is limited
  to the expanded Weather scene; no collapsed-pill animation.

## Verification

`make test` covers provider normalization, missing fields, unknown conditions,
units, timezone boundaries, both fallback directions, stale data, backoff,
quota/auth errors, cancellation and location changes. `make smoke` exercises
native rendering, units, visibility and timer cleanup alongside existing checks.
GTK preferences checks include coordinate validation. Run the real cache test with:

```sh
make weather-cache-test
```

Live checks confirmed both forecast APIs and geocoding through GJS/Soup. This does
not establish sustained uptime, physical monitor behavior or battery/CPU budgets.
