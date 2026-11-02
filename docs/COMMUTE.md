# Commute

Commute estimates driving time, distance, and arrival time for saved routes. Enable
it in **Preferences → Commute**, then disable/re-enable the extension once. Add up
to 12 named routes. Use the next-route button to cycle, or swap endpoints for a
fixed route. This first version does not predict the best departure time.

## Choose endpoints

**Add route on map** opens a separate preferences window. Select **A · Set start**
or **B · Set destination**, then click the map. Drag either pin to refine it.
Address search runs only when you press Search/Enter; choose a result to place the
selected pin. Decimal latitude/longitude fields provide a keyboard alternative
(press Enter to apply). On the focused map, arrow keys pan, +/− zoom, and Enter
places the selected pin at the center. The route name is optional: leave it blank to display **Start name → Destination
name**. That label also follows endpoint swaps. Save when the endpoints are set. The dashed line connects the
pins; it is not a road itinerary. Open route opens OpenStreetMap directions.

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
| [FOSSGIS / OSRM](https://routing.openstreetmap.de/about.html) | Public, no key | No |
| [OSRM demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) | Public, no key | No |
| [openrouteservice](https://openrouteservice.org/) | Optional free-plan account/key | No |
| [GraphHopper](https://www.graphhopper.com/pricing/) | Optional free-plan account/key; check usage terms | No |
| [Neshan](https://platform.neshan.org/docs/api/routing-category/routing) | Optional Iranian provider; key required, free tier not assumed | Yes |

Automatic mode tries configured Neshan, openrouteservice and GraphHopper keys,
then the public hosts. An explicit preference is tried first. Backup sources can
be disabled. The two public OSRM hosts share FOSSGIS infrastructure: they provide
endpoint fallback, **not independent outage protection**. Configure an
openrouteservice or GraphHopper key for an independent backup. Public hosts are
best-effort services with no uptime guarantee, unsuitable as a production SLA.

The UI shows the provider, whether a backup was used, and **No live traffic** for
free baseline estimates. These estimates cannot detect a jam or promise the best
time to head home. Neshan's traffic-aware response is used when a working key is
configured. No paid account is required for basic use. Key-backed adapters are
covered by fixtures; they have not been exercised with real account credentials.

## Refresh, performance, and privacy

- Default refresh is **15 minutes**, configurable from **10 to 120 minutes**.
  Automatic work runs only while the expanded Commute tab is visible. Reopening
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
make preview-commute
make preview-commute-map # open the map editor immediately
make preview-commute PREVIEW_ARGS="--live" # real requests for the sample Tehran route
make preview-commute PREVIEW_ARGS="--headless --duration 15"
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
