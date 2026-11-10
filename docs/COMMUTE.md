# Commute

Commute estimates driving time, distance, and arrival time for saved routes. Enable
it in **Preferences → Commute**, then disable/re-enable the extension once. Add up
to 12 routes with optional names. Use Select beside a saved route in preferences, or swap
endpoints for a fixed route. **Settings → Notch → Show Commute ETA** adds the selected route to the
collapsed notch and its draggable order preview. `18m` shows the estimate,
and `!18m` marks a stale estimate;
`…` means loading, and `—` means unavailable. It hides when no route is configured.
Traffic status is shown in the Commute tab and the notch's accessible description.
The notch option is off by default. This first version does not predict the best departure time.

## Choose endpoints

**Add route on map** opens a separate preferences window. Select **A · Set start**
or **B · Set destination**, then click the map. Drag either pin to refine it.
Address search runs only when you press Search/Enter; choose a result to place the
selected pin. Decimal latitude/longitude fields provide a keyboard alternative
(press Enter to apply). On the focused map, arrow keys pan, +/− zoom, and Enter
places the selected pin at the center. The route name is optional: leave it blank to display **Start name → Destination
name**. That label also follows endpoint swaps. Save when the endpoints are set. The dashed line connects the
pins; it is not a road itinerary. **Preferences → Commute → Open route in** chooses
Google Maps (default), Balad or Neshan for the **Open route** button. This choice
is independent of the ETA source and needs no API key. Fixed routes can open
even when the ETA service is unavailable; a current-location route needs a
resolved origin. Reversing the route reverses the browser link too.

The provider button beside **Open route** opens the ETA source picker. Choose
Automatic or an available source, and turn **Backup providers** off to stay on
that source even if it fails. Providers requiring an absent key are disabled;
use the Settings shortcut to configure one. Source changes preserve the displayed
direction and apply to both directions; the selection is shared across saved routes.

Select **Use current location as start on each refresh** for a moving origin.
**Locate me** lets you inspect its accuracy before saving. GNOME Location Services
must be enabled and GeoClue must allow access. Desktop location can be unavailable;
fixes worse than 1 km are rejected. Choose a fixed start if this happens. Each
request obtains one fix and stops the location client; there is no background
location watch. A saved pin is never silently substituted for a failed current fix.

When device location fails, the tab shows **Location settings** and, if a starting
pin is saved, **Use saved start**. The latter explicitly switches that route to a
fixed origin and requests an ETA. The former opens GNOME Privacy settings, where
you can enable Location Services. Refresh the estimate after changing permission.
Manually selecting an origin on the map, through search or coordinates switches
to fixed mode. **Locate me** sets a pin without silently enabling tracking; check
“Use current location as start on each refresh” only if you want that behavior.
Routes using current location can be saved with only a destination, but need a
working location service before they can return an estimate.

The map uses native GTK/GdkPixbuf with the existing Soup HTTP dependency. No
WebKit or browser sandbox is required. Optional Ubuntu packages are
`gir1.2-geoclue-2.0` for location and `gir1.2-secret-1` for API keys. `make install` also installs `assets/ubuntu-island.desktop` in
`~/.local/share/applications` for GeoClue identification. If installing the ZIP
manually, copy that desktop file there as well; GeoClue permissions still depend
on your system. No map engine runs inside GNOME Shell.

## Routing sources and backups

The [public-apis directory](https://github.com/public-apis/public-apis) was used to
discover free-key options. Availability and free-plan quotas can change.

| Source | Setup | Live traffic |
| --- | --- | --- |
| [Balad](https://balad.ir/) | No key; unofficial experimental endpoint | Traffic-profile endpoint; freshness unverified |
| [FOSSGIS / OSRM](https://routing.openstreetmap.de/about.html) | Public, no key | No |
| [OSRM demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) | Public, no key | No |
| [openrouteservice](https://openrouteservice.org/) | Optional free-plan account/key | No |
| [GraphHopper](https://www.graphhopper.com/pricing/) | Optional free-plan account/key; check usage terms | No |
| [Mapbox](https://docs.mapbox.com/api/navigation/directions/) | Optional free-plan access token | Live/typical traffic profile; coverage varies |
| [Neshan](https://platform.neshan.org/docs/api/routing-category/routing) | Iranian provider; key required, temporary development credit then paid usage | Yes |

**Provider priority** lists sources from first to last. Use each row's Move up or
Move down button to change the order; changes apply live. Automatic mode skips
key-backed providers without a saved key. The default is Balad, Mapbox, Neshan,
openrouteservice, GraphHopper, FOSSGIS, then OSRM. An explicit **Preferred routing
source** is tried first; backups then follow the configured priority. Turning off
backups uses only the first eligible source. Unknown/duplicate priority entries
are ignored and omitted providers are appended.
Fallback excludes public FOSSGIS/OSRM when a Mapbox token is available;
if Balad and the configured keyed sources all fail, it reports the failure.
Without a Mapbox token, public OSRM remains the last resort. A specifically
selected source and existing custom priority remain respected.

Browser link formats were checked on 2026-11-09 against
[Google's Maps URL documentation](https://developers.google.com/maps/documentation/urls/get-started),
[Balad's driving page](https://balad.ir/directions/driving) and its published
[route parser](https://cdn.balad.ir/public/_next/static/chunks/pages/Directions/Driving-d8dd06751082153c8483.js),
and [Neshan's published web route parser](https://neshan.org/maps/6699-3b995729281facb4f1f2.js).
Balad uses longitude/latitude query pairs; Neshan uses latitude/longitude path
pairs. Those two formats are inferred from the providers' current web clients,
not a promised API contract. Browser interaction could not be verified in this
environment; URL construction and live setting changes are covered by tests.

Balad uses the keyless endpoint verified by the standalone probe and is labeled
experimental. The ETA includes its routing profile's duration, but live-traffic
freshness has not been established, so the Commute tab says **Traffic freshness unverified**.
Availability, terms and response format may
change. It uses the existing bounded HTTP client and visibility lifecycle.

Backup sources can be disabled. The two public OSRM hosts share FOSSGIS
infrastructure: they provide endpoint fallback, **not independent outage
protection**. Public hosts are best-effort services with no uptime guarantee.

### API key status and validation

Under **Provider API keys**, each provider shows **Key stored**, **No key stored**,
or a keyring error. Existing secrets are never filled into the input. **Get API
key** opens that provider's account page. **Validate & save** makes one request for
a route between public Tehran landmarks (Azadi Tower and Milad Tower), then
stores the key only if a valid driving estimate is returned. This may consume
provider quota. No saved private route or current location is used for validation.

A rejected key, denied permissions/region, quota limit, connection error, or
malformed routing response leaves the previous key unchanged. A stored key is
not revalidated automatically when preferences opens; its status explicitly says
it was not tested this session. **Remove** deletes the saved key. Keys remain in
the desktop keyring, and closing preferences cancels pending validation. Real
account coverage and future key expiry cannot be guaranteed by this small test.

The UI shows the provider, whether a backup was used, and **No live traffic** for
free baseline estimates. These estimates cannot detect a jam or promise the best
time to head home. Neshan's traffic-aware response is used when a working key is
configured. Mapbox uses `driving-traffic` with `depart_at=now`; results are labeled
**Traffic-aware**, since typical speeds may replace live observations. A response
without traffic-profile metadata is conservatively shown as a baseline estimate. No paid account is required for basic use. Key-backed adapters are
covered by fixtures; they have not been exercised with real account credentials.

## Refresh, performance, and privacy

- Default refresh is **15 minutes**, configurable from **10 to 120 minutes**.
  Automatic work runs only while the expanded Commute tab or its enabled collapsed indicator is visible. Reopening
  reuses a fresh estimate; it resumes refreshing when that estimate expires.
- Refresh is also available manually. Requests are asynchronous, bounded to
  256 KiB/15 seconds, separated by at least 1.1 seconds, and canceled on hide or
  disable. Repeated refresh attempts are throttled to five seconds.
- Up to 24 route/direction results are cached in memory. An unsuccessful refresh
  can show a clearly marked previous estimate. Closing the extension clears it.
- Saved names and coordinates live in local GSettings. API keys live in the
  desktop keyring, not GSettings. There is no analytics.
- Routing sends endpoint coordinates to the chosen provider; fallback may send
  them to several. Map tiles reveal the viewed area to OpenStreetMap. Explicit
  address searches send the search text to Nominatim. Map attribution stays
  visible; the route panel includes attribution and a map-correction link.
- Only visible map tiles load, with at most four simultaneous requests and
  512 KiB per tile. Soup honors HTTP caching headers in a 32 MiB disk cache;
  at most 96 decoded tiles stay in editor memory. There is no background
  map refresh, browser process, bulk download or prefetch. Closing the editor
  cancels requests. See the
  [tile policy](https://operations.osmfoundation.org/policies/tiles/) and
  [search policy](https://operations.osmfoundation.org/policies/nominatim/).

## Local preview

```sh
make preview # open the Commute tab; route editor is in preferences
make preview-live PREVIEW_ARGS="--tab commute" # real requests for the sample Tehran route
make preview-headless PREVIEW_ARGS="--tab commute --duration 15"
```

The default uses a labeled 32-minute sample and needs no key. Preview settings are
temporary; set up persistent routes through the installed extension's preferences.
`make check` tests parsing, fallback, timing, stale results and cancellation;
`make prefs-test` checks controls; `make smoke` exercises the native tab and map
click/drag/save/reopen lifecycle with offline fixtures. This does not establish GPS accuracy,
provider account validity, or live traffic quality on your system.

## Previous route-editor crash

The former WebKit map could terminate the whole preferences process when the
system denied bubblewrap user namespaces (`bwrap: setting up uid map: Permission
denied`, then `Failed to fully launch dbus-proxy`). The map now uses native GTK,
so neither WebKit nor a security-setting override is needed. `make smoke` covers
opening the editor twice and closing its resources with normal environment
settings. Restart preferences after installing updated files.

## ETA comparison and provider review (2026-11-02)

A 10-minute baseline versus Google Maps' 18-minute estimate can result from
traffic, different selected roads, snapping endpoints to different roads, or
road-speed assumptions. We have not compared that private route at the same time
with a working traffic-provider key, so traffic is a likely explanation, not a
verified diagnosis. No arbitrary multiplier is applied to make the values match.

Rechecked the [public-apis directory](https://github.com/public-apis/public-apis)
and provider documentation:

- **Mapbox** lists Iran in its [traffic coverage](https://docs.mapbox.com/help/dive-deeper/directions/)
  and currently includes [100,000 Directions requests/month free](https://www.mapbox.com/pricing#navigation).
  It requires an account/access token. Live observations can fall back to typical
  conditions; country coverage is not a guarantee for every road. This is the
  added free-plan candidate for comparison; account/regional access still needs
  to work for the user. Adapter validation uses fixtures, not a real account.
- **Neshan** documents [routing with live traffic](https://platform.neshan.org/docs/api/routing-category/routing).
  Its [platform page](https://platform.neshan.org/) describes paid usage with
  development credit for up to three months, not a permanent free routing tier.
  It remains the local traffic-aware option already supported here.
- **TomTom** has a free allowance but its [coverage table](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/product-information/market-coverage)
  lists routing without real-time traffic for Iran. It does not address this
  particular missing-traffic problem, so no extra adapter was added.
- **openrouteservice** explicitly [does not use live traffic](https://ask.openrouteservice.org/t/what-information-are-used-to-calculate-best-route/4961).
  It and the existing public OSRM adapters remain baseline fallback options.

To compare: save a Mapbox access token in **Preferences → Commute → Optional
provider keys**, choose Mapbox as the preferred source and refresh the same route.
Watch the provider and backup label: a fallback to public routing is still a
baseline estimate. A 401/403/quota failure falls back only if backups are enabled.
The token is stored in the desktop keyring. Google Maps' consumer estimate is not
an API response we can directly reuse.

## Keyless provider experiments

Standalone Python probes and observed Balad/OSRM/Waze results are documented in
[scripts/commute/README.md](../scripts/commute/README.md). Balad returned a usable
keyless ETA on 2026-11-04; Waze returned HTTP 403. Live traffic freshness remains
unverified. The Balad adapter is now included in the extension; Waze remains an unsuccessful experiment.
