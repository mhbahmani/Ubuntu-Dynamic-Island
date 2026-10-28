# Weather (v11)

Basic static functionality, retaining the v10 visual style. Further UI/UX work
is intentionally deferred.

## Local preview (no installation/logout)

Run `make preview` from the repository root for an interactive nested
GNOME window with sample weather, or use `make preview-live` for real weather. It opens the
actual Weather tab automatically with an example Tehran location. Preferences
apply inside the private preview only. Close and rerun after editing code.

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
preferred provider and, on failure, the other provider. Manual coordinates avoid
a dependency on geocoding availability. No continuous location tracking.

## Sources and fallback

Verified documentation and live endpoints on 2026-10-28:

| Provider | Integration | Result |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/docs) | Default, global current/hourly forecast | Live Tehran request succeeded through GJS/Soup |
| [wttr.in](https://github.com/chubin/wttr.in#json-output) | Keyless alternate (`format=j1`, coordinates), WorldWeatherOnline data | Live Tehran request succeeded through GJS/Soup |
| [One-API, Iran](https://one-api.ir/2021/04/09/api-%D9%87%D9%88%D8%A7%D8%B4%D9%86%D8%A7%D8%B3%DB%8C-%D9%88-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%AC%D9%88%DB%8C/) | Researched, not integrated | Documents coordinate-based current/hourly endpoints; requires a user token |
| [Sameteo, Iran](https://sameteo.com/products/web-service) | Researched, not integrated | Advertises Iranian weather APIs with account/trial access; no authenticated endpoint validated |
| [Codebazan, Iran](https://codebazan.ir/%D9%88%D8%A8-%D8%B3%D8%B1%D9%88%DB%8C%D8%B3-%DA%A9%D8%A7%D8%B1%D8%A8%D8%B1%D8%AF%DB%8C-%D8%B3%D8%B1%DB%8C-%D8%B3%D9%88%D9%85/) | Researched, not integrated | Published `api.codebazan.ir/havairan/?unit=metric&city=tehran` returned HTTP 403 from this environment |

Either implemented provider can be preferred; failures, timeouts and malformed
responses try the other provider. Successful results identify their actual source.
These are separate services, not a guarantee of entirely independent upstream
meteorological data or availability from every Iranian network. The Iranian
options above are not claimed as working fallback integrations. A future token
integration should use the desktop secret store, never GSettings or bundled keys.

Open-Meteo's free API is for non-commercial use; its data uses CC BY 4.0.
See [provider terms](https://open-meteo.com/en/terms). Source attribution is shown
in the tab. wttr's forecast is often three-hourly; the UI displays returned times
and does not invent hourly samples. Rain is precipitation probability, not a
minute-precise prediction. Both providers are normalized to Celsius and km/h;
Fahrenheit is a display conversion. Forecast times use the saved location's
IANA timezone, including date boundaries. Fetch age and provider observation time
are different: “Fetched” describes retrieval, not guaranteed observation freshness.

## Lifecycle and bounds

- Optional service: no network/timers while disabled. First request on viewing.
- Refresh every 20 minutes while viewed; explicit refresh button. Hidden tabs,
  collapsed surfaces and disable cancel in-flight work and remove refresh timers.
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
- Disable/location changes guard against late async results. No weather animations
  or collapsed-pill integration in this version.

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
