# Session handoff

Updated 2026-10-28. v11 adds the requested basic Weather tab on top of the
accepted v10 visual baseline. Source and build are updated; the user's installed
extension remains v10. Weather is opt-in in preferences and needs a confirmed
city or manual coordinates. See [WEATHER.md](WEATHER.md) for providers and setup.
The new implementation keeps UI styling basic pending user direction.

Local development preview: `python3 tests/preview.py` opens the actual extension
in a nested GNOME window, initially Weather with sample data. `--live` enables
real weather; `--headless` saves a screenshot. Uses a private bus, temporary
installation/settings/cache and a real preferences window; no installation or
logout. Windowed and headless launch/render paths were verified. Restart preview
after edits; it does not hot reload. See README for details.

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
No code tests were rerun for this documentation-only handoff.

## Planned work, not implemented

The roadmap contains UX, integrations, performance budgets, acceptance criteria,
open decisions, and sourced future ideas for:

- Weather: basic static functionality is implemented in v11; condition colors
  and bounded animations remain future work after profiling.
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
