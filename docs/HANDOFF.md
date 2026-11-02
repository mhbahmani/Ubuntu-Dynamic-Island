# Session handoff

2026-11-01 follow-up: screenshot's Commute failure was GNOME Location Services
being disabled, not routing. Current-location errors now offer explicit saved-pin
recovery and a Privacy settings shortcut, with short visible status text. Manual
source selection switches to fixed mode; Locate me no longer enables tracking.
Names are optional and displayed as endpoint names when blank. Notch chevrons now
have a 40–120° numeric angle (default 80), replacing compact/wide presets. Legacy
compact choices migrate to 60°. All cloudy icons share the same viewport/scale;
day cloud grew 5% and night moons moved left/up. Host privacy settings unchanged.
Validation: 70 Node tests, real GTK bindings/location-disabled preflight, native
Shell smoke (including explicit saved-start recovery), and packaging passed.

2026-11-01 follow-up: arrow HSV saturation reduced by 5%; default chevron angle
widened by 5° (now about 80°). Colorful partly-cloudy cloud scale increased from
0.8 to 0.9 while retaining the larger sun. Indicator style is now the first group
on the Notch settings tab, with explicit arrow-shape/weather-style labels.

2026-11-01: Native GTK route map replaces WebKit after two confirmed preferences
crashes (`bwrap: setting up uid map: Permission denied`). No sandbox override or
WebKit package is needed. `make preview-commute-map` opens the editor directly.
Notch settings now offer thin/compact/chevron arrows and colorful/minimal weather.
Chevron is default (roughly 15° tighter than 90°); all arrows use saturated red
and green. The partly-cloudy sun is larger; the Weather header settings button
was removed. 66 tests, GTK settings bindings and native smoke (including map
click/drag/save/reopen/cleanup) passed with the ordinary environment. Live Tehran
tiles also rendered successfully. The older WebKit validation notes below are
historical. Source changes from both Commute iterations are still uncommitted.

2026-10-31: Commute is implemented as an opt-in tab with map editing, saved routes,
GeoClue origins, public OSRM and optional key-backed provider fallback. Default
refresh is 15 minutes, minimum 10, visible only. See [COMMUTE.md](COMMUTE.md).
`make preview-commute` opens its sample. Weather notch icons are now static
full-color Meteocons; network chevrons are narrower.
Validation: 64 Node tests, GTK preferences, schema/syntax, packaging, native
Shell smoke and a live FOSSGIS Tehran route (12 min / 10 km) passed. The offline
WebKit map click/drag/save fixture required a test-process-only sandbox override
because this runner denied bubblewrap user namespaces; production sandboxing
is unchanged. Real GeoClue permission/accuracy and key-backed accounts remain
unverified. Generated ZIP removed; user reference `1.png` preserved.

Updated 2026-10-28. v11 adds the requested basic Weather tab on top of the
accepted v10 visual baseline. Source and build are updated; the user's installed
extension remains v10. Weather is opt-in in preferences and needs a confirmed
city or manual coordinates. See [WEATHER.md](WEATHER.md) for providers and setup.
2026-10-29: added a native weather scene with Off/Subtle/Live preferences. Subtle
is the production default (four seconds); preview defaults to Live. Demo via
`make preview PREVIEW_ARGS="--scene rain --ignore-power-saver"`; the host was in
power saver during development, so the explicit preview-only override is useful.
Normal behavior respects power saver and reduced motion. See WEATHER.md for limits.
2026-10-30: replaced procedural drawing with licensed Meteocons animation atlases
behind the text and a horizontal forecast. One selected 6.75 MiB texture, under 12 updates/sec;
Clouds, rain and snow also have moon artwork and dark night palettes, selected
from provider day/night data. No weather-animation timer while hidden. No host CPU/battery guarantee yet.

Navigation alignment repair: tab glyphs now share the vertical center of the
caption and preferences icon. The selection marker is bottom-aligned independently
in a BinLayout, preserving footer height. Native smoke checks cover alignment and
marker separation at normal/200% scale, narrow width and enlarged text.

Local development preview: `make preview` opens the actual extension
in a nested GNOME window, initially Weather with sample data. `make preview-live` enables
real weather; `make preview-headless` saves a screenshot. Uses a private bus, temporary
installation/settings/cache and a real preferences window; no installation or
logout. Windowed and headless launch/render paths were verified. Restart preview
after edits; it does not hot reload. See README for details.

Use `make help` for command discovery, `make check` for fast checks, `make verify`
for native checks and packaging, and `make install` for a backed-up per-user
installation. Install still needs logout/login to load changed code on Wayland.
Python bytecode/cache directories and build outputs are ignored. `make verify`
and `make preview-headless` passed; `make install` and its backup behavior were
verified against a temporary XDG_DATA_HOME, leaving the real installation untouched.

Validation: 52 Node tests, syntax/schema checks, real GTK preferences, GJS cache
round trip, live GJS/Soup requests to both weather providers and city search, and
isolated GNOME Shell smoke checks including weather rendering, live units and
hidden timer cleanup. No physical hardware or long-term performance claim.

The user accepted the previous v10 state. There is no outstanding
UI repair request. Preserve this baseline; the feature roadmap is a proposal, not
an instruction to implement everything automatically.

## Resuming work

1. Read this file and `AGENT.md`, then inspect Git status and recent commits.
   Preserve changes made after this handoff.
2. Use `README.md` for source layout, installation, and verification commands.
3. Consult [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) for the next requested feature.
   Resolve only the decisions relevant to that feature.

## Accepted baseline

- Implemented tabs: Media, System, Sound, Bluetooth. Native GNOME Shell 46
  St/Clutter UI, Ricelin-inspired compact composition, Noto Sans, matte themes.
- Opacity works across 0–100%; matte tone changes gradient RGB only. Text and
  controls remain fully opaque. No backdrop blur.
- Tab selection uses dedicated straight marker actors. Opening focuses the
  surface, avoiding the old orange rounded System indicator.
- CPU/load and MEMORY/used values share compact heading labels (`CPU 1.44`,
  `MEMORY 3.5 GB`). Percentages remain visible. At enlarged font sizes, percentages
  move below when needed. Layout uses available card width rather than an
  overflowing child's allocation; check percentage bounds as well as ellipsizing.
- Opening preferences keeps the island expanded for live preview and suspends its
  modal grab while the preferences window is active.
- The Media eye control and middle-click on the notch hide only the collapsed
  media title. The playback icon remains. Idle/stopped media has no placeholder.

Recent implementation commits:

| Commit | Purpose |
|---|---|
| `b6e8024` | Keep opacity independent of matte tone |
| `ac217f3` | Stable tab markers and compact metric headings |
| `9f2f5e0` | Feature roadmap and v10 documentation |
| `ccfaa48` | Constrain enlarged-text metrics to the card |

## Validation and installation

Last code validation, 2026-10-27: 43 Node tests passed, along with syntax/schema
checks, real GTK preferences checks, packaging, and isolated GNOME Shell 46 tests.
Native checks covered themes/rendered alpha, narrow layout, enlarged text, 200%
scale, repeated pointer navigation, idle media, hidden chart redraws, preferences
window lifecycle, outside dismissal, Escape, rapid toggles, and disable cleanup.
The final 150% text screenshot was visually reviewed after the width correction.

These do not establish physical mixed-monitor rendering, HDMI routing/hotplug,
live MPRIS commands, Bluetooth operations, suspend/resume, or fullscreen behavior.
User acceptance does not mean each hardware acceptance test was individually run.

v10 including `ccfaa48` was installed at
`~/.local/share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io`.
The preceding installation was backed up with suffix `.backup.20261027195114`.
Compare installed files with source when diagnosing regressions. Wayland requires
logout/login to load changed extension code; do not restart Shell with Alt+F2 `r`.

Last native artifacts: `/tmp/ubuntu-island-smoke-jh6431ea`. Temporary logs and
screenshots may disappear; regenerate with `python3 tests/smoke.py` when needed.
Build ZIPs and compiled schemas are generated, ignored files, not source to commit.
Weather redesign checks: 54 Node tests, schema/syntax checks, GTK preferences,
GJS cache integration and isolated native GNOME smoke checks.

## Planned work, not implemented

The roadmap contains UX, integrations, performance budgets, acceptance criteria,
open decisions, and sourced future ideas for:

- Weather: basic data and bounded atlas animation are implemented; extended
  laptop CPU/battery profiling and further visual refinement remain.
- Next Appointment: investigate GNOME Online Accounts/Evolution Data Server for
  Google-backed calendars before adding a separate OAuth integration.
- Commute: two saved locations, directional ETA and optional departure reminders.
  Provider coverage, traffic accuracy, credentials, and billing need confirmation.
- Task Progress: explicit producer events and a terminal wrapper, without process
  scans or polling subprocesses in Shell.

Suggested sequence: shared lifecycle/navigation as needed, static Weather,
calendar feasibility and appointments, Commute, Task Progress, optional motion.
No city, commute endpoints, calendar selection, provider credentials, or first
external task producer has been chosen by the user. Recheck provider terms and
GNOME API compatibility when implementing; sources were reviewed on 2026-10-27.

## Persistent preferences

- Performance is the top priority: asynchronous I/O, bounded caches/history,
  lazy optional services, no hidden repaint loops or unnecessary background work.
- Preserve the accepted compact matte design. New features should offer contextual
  actions instead of merely duplicating the Ubuntu top bar.
- Use the installed `ui-ux-pro-max` skill for UI work and Ricelin README images
  as references. Ricelin is inspiration, not a runtime dependency.
- Use focused, short Conventional Commits without co-author trailers. Commit
  changes separately by purpose. Never push unless requested.
- Keep documentation current. Preserve user reference files during cleanup and
  do not restore removed prototype directories.

Collapsed indicators: optional static weather glyph and compact single-line network
rates, controlled live with eye buttons in Weather/System. Both default off.
Weather polling follows the visible notch when opted in; its animation remains
off while collapsed. Native checks cover visibility, polling cancellation, and
narrow indicator layout.

Preferences now have Appearance, Notch, Modules, and Weather pages with search.
Native checks cover navigation and bidirectional settings bindings, and the
window lifecycle fixture opens the real preferences UI.

The notch now distributes enabled groups across its width and grows beyond the
configured minimum when needed. Network arrows use red for download and green
for upload; weather and music have restrained color accents. The Notch settings
page includes a draggable order preview and keyboard move buttons, backed by
`pill-order`. Packaging includes `notch-prefs.js` and the order model. GTK tests
exercise drag/drop callbacks and keyboard reordering; native tests cover live
order changes and readable narrow layouts.

Weather now uses the same 260px height as the other pages. Its current conditions
share a row; artwork is smaller, and forecast/freshness/credit fit at normal text
size. Native checks assert stable tab height and credit visibility.
