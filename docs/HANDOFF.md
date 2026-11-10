# Implementation handoff

Updated 2026-11-10. Target: GNOME Shell 46 on Ubuntu Wayland.

- [AGENTS.md](../AGENTS.md): engineering, packaging and commit rules.
- [README](../README.md): installation, development commands and hardware checks.
- [Module guide](MODULES.md): current Calendar, Agents, Weather and Commute behavior.
- [Google Calendar plan](GOOGLE_CALENDAR_PLAN.md): the accepted next-session feature.

## Current implementation

Media, system metrics, sound outputs and Bluetooth use native Shell services.
Weather, Commute, Agents and Calendar are opt-in. Calendar's module toggle applies
live; other module toggles still require disabling/re-enabling the extension.
Notch indicators reuse module state and respect consumer visibility.

Calendar supports Jalali, Gregorian and calculated Hijri, holidays based on the
main calendar, blank neighboring-month cells and custom notch date codes/order.
Fresh notch settings select the main calendar once; later explicit selections
remain independent. There is no account-event integration yet.

Agents provides local hook/plugin status, explicit window selection and Quick Ask.
Clear and the notch eye toggle are in the main header. Session states are event
reports, not continuous liveness checks. Weather and Commute use bounded async
requests, caches and explicit stale/error states. See the module guide for setup,
provider limits and privacy details.

## Recent UI changes

- Sound outputs sort headphones (Bluetooth or wired), built-in speakers,
  HDMI/DisplayPort, then others. Stable ties do not promote the active device.
- Calendar dates share a compact header line when additional calendars are shown.
  Date text is now 9.5pt (single-calendar heading 11.5pt), with a little vertical
  padding. The six-week fixture is 263px tall at 100% scale, close to the other
  tabs' 260px. All three dates still fit one line at 380/440px; enlarged text wraps
  and overflow remains reachable.
- Network rates retain each direction's widest displayed value plus 2 logical
  pixels. Widths reset on interface/indicator changes and are remeasured on
  font/scale changes; no new polling timer is involved.
- The preferences icon uses filled slider shapes with explicit cutouts so all
  parts recolor consistently on hover/focus.

## Repository organization

Root runtime files are GNOME's `extension.js`, `prefs.js`, `metadata.json` and
`stylesheet.css`. Shell components live in `ui/`, GTK preferences in
`preferences/`, services/models in `services/`, and subprocess helpers in
`helpers/`. Asset and schema directories are unchanged.

`make install` and `make build` call scripts under `scripts/`; ZIPs go in ignored
`dist/`. The package preserves this directory layout. Install/build/preview copy
paths and tests include all runtime directories. Build replaces the complete ZIP
so removed files cannot survive in an older archive.

`AGENTS.md` is the complete agent guide; the redundant singular file is removed.
The module guide replaces separate feature documents and the obsolete roadmap.
Use Git history for earlier designs, research and session logs.

## Verification and remaining work

After the directory moves, `make check` passed (Node tests, recursive JavaScript
syntax checks, Python syntax and schema validation). Installer/ZIP tests compare
all runtime files, resolve relative module imports, preserve an existing install
and reject stale archive entries. They use temporary directories.

The isolated GNOME smoke test passed media controls, Quick Ask, the GTK map editor,
shortcut recording, themes, scaling, keyboard/dismissal and disable cleanup.
GTK preferences checks also passed. Native calendar/notch checks after the header
adjustment covered narrow/default widths, 100/200% scale, enlarged text, live
calendar toggles, holidays and clock cleanup.
The full fixture preview passed all eight tabs, audio order, Agents interactions
and network width stability after the file moves.
The narrow Calendar was also visually checked in a real 200% nested display with
150% text; dates wrap without clipping and navigation remains visible.
No host extension installation was performed for these tests.

Still requiring real-environment acceptance: mixed-monitor behavior, HDMI/audio
hotplug, Bluetooth, live player controls, suspend/fullscreen transitions, provider
keys/GeoClue and live agent compatibility. Fixture success is not evidence for
those external integrations.

For Google Calendar, begin with the plan's GNOME Online Accounts/EDS integration
probe. Verify optional bindings and a user-connected Google account before claiming
live synchronization. Keep fixture work independent of host accounts. No packages
or accounts have been changed to prepare that feature.
