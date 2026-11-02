# Session handoff

Updated 2026-11-02. Target: GNOME Shell 46 on Ubuntu Wayland. Read
[AGENT.md](../AGENT.md) for performance, provider, privacy, and commit rules.

## Current behavior

- Weather and Commute are opt-in modules. Weather uses premade day/night animation
  atlases with visibility and motion controls; the collapsed icons are static.
  Shared notch clouds have consistent geometry, with the sun partially behind.
- Notch settings provide draggable indicator ordering, optional Weather, network,
  and Commute values, arrow styles and a numeric 40–120° chevron angle, plus
  colorful/minimal weather icons. Download is red and upload green.
- Appearance → Open on expand defaults to Last used tab. A fixed module applies
  on each real opening, before activating services. Unavailable modules preserve
  the last available tab; changing the preference does not interrupt an open tab.
- Commute supports saved routes, optional names, native map endpoint selection,
  and manual or GeoClue origins. Location-disabled errors offer Privacy settings
  and explicit saved-start recovery. System location settings are never changed.
- Commute refresh defaults to 15 minutes, minimum 10. Its tab and optional notch
  indicator share cache and lifecycle. Hidden consumers stop refresh timers.
  The notch uses `~` for estimates without live traffic and `!` for stale data.
- Automatic routing tries configured Neshan and Mapbox before baseline providers
  (ORS, GraphHopper, FOSSGIS, OSRM). Keys stay in the desktop keyring. Mapbox uses
  driving-traffic and checks response metadata before labeling traffic support.
  See [COMMUTE.md](COMMUTE.md) for provider evidence and setup; see
  [WEATHER.md](WEATHER.md) for weather sources and fallback behavior.

## Validation and limits

The latest implementation passed 73 Node tests plus syntax/schema checks,
real GTK preference checks, and the native headless GNOME smoke suite. Smoke
coverage includes opening-tab behavior, unavailable-tab fallback, map editing,
Commute notch cache reuse, and hidden timer cleanup. Packaging was verified for
Commute/Mapbox before the subsequent opening-tab change.

Mapbox request/response handling is fixture-tested; no real account token or
private-route comparison was available. Do not promise agreement with Google
Maps. Real GeoClue permissions/accuracy, physical mixed-monitor rendering,
HDMI hotplug, live media/Bluetooth, suspend/resume, and fullscreen behavior still
need hardware acceptance checks. Native maps replaced the crashing WebKit editor;
no sandbox override is required or appropriate.

## Development workflow

Use `make help` for all commands. Run `make check`, `make prefs-test`, and
`make smoke` as relevant; `make verify` also checks packaging and weather cache.
`make preview`, `make preview-live`, `make preview-commute`, and
`make preview-commute-map` work without installation or logout. Weather preview
targets include explicit day/night variants. Restart previews after source edits.

Do not assume the installed extension matches this checkout. Compare files before
diagnosing installation problems. `make install` backs up the per-user install;
Wayland requires logout/login to load changed extension code. Preferences-only
changes can be inspected by reopening preferences. Never restart Wayland Shell
with Alt+F2 `r`.

Keep generated ZIPs, compiled schemas, and analysis caches out of commits. User
reference images `1.png` and `2.png` are preserved locally and are not release
assets. Calendar and Task Progress remain proposals, not implemented features.
