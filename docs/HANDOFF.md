# Session handoff

Updated 2026-11-06. Target: GNOME Shell 46 on Ubuntu Wayland. Read
[AGENT.md](../AGENT.md) for performance, provider, privacy, and commit rules.

Offline notch update (2026-11-06): a shared Gio.NetworkMonitor subscription
consolidates enabled network-dependent indicators at the first indicator's ordered
position. Notch → When offline now offers Connection icon (default), Broken edge,
and Hide unavailable indicators. Connection icon uses a text-free disconnected
Wi-Fi symbol; Broken edge pairs an unplugged symbol with two static amber segments
at the surface's bottom edge, hidden throughout expansion/collapse transitions.
Neither style has a badge background or text. Offline / limited / sign-in details
remain in the accessible name. Legacy badge settings migrate to icon; existing
hide choices are preserved. No additional polling or reachability probes were
added. Music, CPU and Bluetooth stay visible; online notifications restore the
usual indicators. Hide keeps fresh weather/commute cache and valid local-network
rates, removing missing/stale values and disconnected rates. Preferences apply live.
Expanded module behavior is unchanged.

Offline validation: Node tests, syntax/schema checks, real GTK bidirectional
preference bindings, temporary-XDG installer regression and ZIP integrity/content
checks passed. The custom symbolic unplug asset is included by the existing
recursive assets copies in install.sh, build.sh, smoke and preview. Installer
and ZIP checks verify it is delivered. Headless GNOME smoke covered both styles
in all three connection states, ordering, local indicators, 150% text, 200% edge
scale/geometry, expansion/collapse, hide mode with fresh/stale/missing data,
reconnection, individual module indicators and signal cleanup. Node checks cover
the old badge migration and edge visibility during interrupted transitions.
Screenshots were visually inspected. Physical Wi-Fi/Ethernet disconnect and portal behavior still
need live hardware validation; the smoke injects monitor notifications.

## Current behavior

- Commute now supports experimental keyless Balad routing. Provider priority is
  user-configurable with accessible Move up/down controls; Automatic skips keys
  not configured. An explicit preferred provider still overrides first place.
- API-key preferences load saved/absent status from the keyring, link account
  pages, and validate a public test route before saving. Failed validation keeps
  the existing key. Closing preferences cancels pending HTTP/keyring work.
- Removed the redundant Commute heading settings and next-route icons as requested.
  Balad displays traffic freshness as unverified; it does not claim proven live
  observations. The live native Soup adapter returned a valid Tehran route.

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
- Automatic routing tries configured Neshan and Mapbox, then experimental Balad, before baseline providers
  (ORS, GraphHopper, FOSSGIS, OSRM). Keys stay in the desktop keyring. Mapbox uses
  driving-traffic and checks response metadata before labeling traffic support.
  See [COMMUTE.md](COMMUTE.md) for provider evidence and setup; see
  [WEATHER.md](WEATHER.md) for weather sources and fallback behavior.

## Validation and limits

Preview input fix, second round (2026-11-03): the notch-reopen failure returned
in the windowed preview, and that session's log ended with Clutter's
`free_pointer_device_entry: assertion failed: (!entry->press_count)` abort.
Root cause: dismissing on an outside press released the modal while that press
was still pending (its release arrives up to ~150 ms later). Per
`clutter-stage.c`, a press builds the pointer emission chain, and a grab
dismissed mid-press can strand it; every later click then routes through the
stale chain, so the notch button never receives press/release and the island
cannot reopen until the entry is freed — which then trips the assertion.
Dismissal now arms a guard: the modal is released only after the dismissing
press's release has dispatched (idles run after the current dispatch), with a
400 ms cap for a release that never arrives; Escape dismisses via the same
idle path instead of synchronously during key dispatch. Node tests cover the
guard, cap, Escape and suspended paths; the native smoke now also exercises
Escape dismissal followed by a real notch click reopen, plus the guard holding
the grab through a pending press. Verified in the headless private session
only — recheck the windowed nested preview with a real mouse on the user's
desktop (the previous idle-only fix passed the smoke yet leaked in that
environment). No background polling was added; pending guard sources are
removed on destruction.

Earlier round (2026-11-02): outside-pointer dismissal deferred modal release
until the press finished dispatching; synchronous release reproduced a stalled
Shell with real pointer events. Collapsed/suspended surfaces ignore captured
dismissal. No pointer assertion appeared in that day's preview logs.

The latest implementation passed 83 Node tests plus syntax/schema checks,
real GTK preference checks, and the native headless GNOME smoke suite. Smoke
coverage includes opening-tab behavior, unavailable-tab fallback, map editing,
Commute notch cache reuse, and hidden timer cleanup. Packaging was verified with the Balad adapter and key-validation module.
GTK checks cover key status, rejected replacements, saving/removal, cancellation
on close, provider links, and ordering, using injected credentials rather than
real keyring writes. Live Balad routing also passed through the native HTTP client.

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

Preview follow-up: the nested preview now observes its private stage for outside
clicks and Escape without taking the island modal seat grab. The installed
extension retains its modal handling. `python3 tests/preview.py --headless
--check-input --duration 14` checks three actual pointer dismiss/reopen cycles
and a top-bar date-menu click with animations enabled. Virtual-pointer positions
do not map reliably in the windowed nested backend, so automated checking requires
headless mode. Windowed event traces showed reopening after outside dismissal
with this preview change. Saved Commute routes now expose Select/Selected in
preferences after removal of the tab's next-route icon.
