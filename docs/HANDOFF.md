# Implementation handoff

Updated 2026-11-11. Target: GNOME Shell 46 on Ubuntu Wayland.

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

Agents provides local hook/plugin status, unique process-to-window matching and Quick Ask.
Clear and the notch eye toggle are in the main header. Session states are event
reports, not continuous liveness checks. Weather and Commute use bounded async
requests, caches and explicit stale/error states. See the module guide for setup,
provider limits and privacy details.

## Motion baseline

The user accepted the notch expansion on 2026-11-11. Treat it as the reference
for future features and animations: a restrained, fluid, MacBook-like feel with
clear spatial continuity. New interactions should fit this motion language.

- Keep the surface horizontally centered as it grows downward. Outgoing notch
  content moves down and inward symmetrically: left items move right, right items
  move left. Preserve each layer's text layout throughout the transition.
- Use subtle uniform scaling and fades. The current implementation in
  `ui/island.js` contracts the outgoing notch to 90%; incoming content settles
  from 97% scale and a 4px upward offset. The surface's 8px drop is animated.
- Opening decelerates with `EASE_OUT_QUART`; content uses `EASE_OUT_CUBIC`.
  Closing uses `EASE_OUT_CUBIC` and 75% of the configured opening duration.
  These values are the current reference when tuning related motion.
- Reverse from the current pose when interrupted. Keep focus and input usable,
  honor both extension and desktop reduced-motion settings, and settle fully
  on hide/disable. Use native constraints/transitions; avoid runtime frame timers,
  snapshots and per-label animation loops.
- Recheck expansion and Quick Ask with `--check-motion` after related changes:
  compact/full notches, narrow/default widths, 100/200% scale, enlarged text,
  reversals and reduced motion. Run the native smoke test for input and cleanup.

Tab transitions are future work. When requested, extend these principles while
preserving stable navigation and focus; the current expansion remains the reference.

## Recent UI changes

- An empty Agents list shows a waiting message and keeps Quick Ask available.
  It does not infer missing integration from a lack of sessions or show a setup
  button. Setup remains in Agents preferences. User-facing completion labels use
  “Task finished”; the hook protocol's `turn` identifiers remain unchanged.
- Sessions use harness logos and rotating working indicators. Three-dot actions
  stay in an anchored menu. There is no window chooser: only a unique process
  ancestry match enables row activation. Finished sessions stay in the main list.
  Inactivity expiry defaults to 60 minutes (configurable in Agents settings) and
  runs only when the Agents view maps; it clears cached and broker records without
  an idle timer. Fresh activity can recreate an expired session.
- Regular tabs and sections share a 260px content height (scaled with the UI),
  including Calendar. Keep the expanded width/height stable across navigation;
  with tighter footer padding to avoid a spare band above navigation. Use space
  for the content, with scrolling for overflow. Standalone
  shortcut Quick Ask retains its compact size.
- Agents uses CLI harnesses only. Settings fill unset executable/config paths,
  select an installed harness initially and default the project to home. Terminal
  follows the desktop default (including Terminator); explicit overrides remain
  available. The former automatic GNOME Terminal choice migrates once to system
  default, then later explicit GNOME choices are preserved.
  Explicit path overrides are preserved. The highlighted Enable integration…
  action opens a confirmation with a matching primary button; installed setups
  show Reconfigure…. Secondary actions live under Integration actions.
- Hooks have readable Ubuntu Island labels in `statusMessage` and the command
  comment. Ownership still uses the original marker, allowing legacy hooks to
  upgrade without duplicates. Merge/remove preserves unrelated handlers, metadata
  and empty groups; unchanged installs preserve the existing file and backup.
- The Agents composer keeps its entry mapped while the gray inline harness button
  opens a menu. Selection restores typing focus. The larger prompt has a muted
  placeholder and an inline arrow to send; Ctrl+Enter submits multiline prompts.
- Appearance settings expose open/close (Super+Alt+I), next tab (Super+Alt+Right)
  and previous tab (Super+Alt+Left) shortcuts. Ctrl+Tab/Ctrl+Shift+Tab navigate
  while open. Bindings update live and are released on disable. Holiday markings
  is no longer an informational row in Calendar settings.
- The notch and card keep their own layout sizes inside a centered native
  fixed-layout viewport; see the [motion baseline](#motion-baseline).
- Sound outputs sort headphones (Bluetooth or wired), built-in speakers,
  HDMI/DisplayPort, then others. Stable ties do not promote the active device.
- Calendar dates share a compact header line when additional calendars are shown.
  Date text is now 9.5pt (single-calendar heading 11.5pt), with a little vertical
  padding. All three dates fit one line at 380/440px; enlarged text wraps
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

Upgrade compatibility: an in-session install exposed cached Shell JavaScript
reading a newly compiled schema without `agents-destination`. Keep all four retired
destination/desktop keys as deprecated schema entries; the current CLI-only UI
does not use them. Installer and ZIP checks now read them through real GJS/GSettings
with an isolated memory backend. `make check` passed all 155 tests and the ZIP was
rebuilt. The corrected version was installed with a backup to repair the reported
host failure; a logout/login is still needed to replace cached Shell code.

Session-list follow-up: `make check` passed 155 tests; GTK preferences passed the
60-minute default and bidirectional expiry setting. The native full preview passed
harness icons, menu focus/dismissal and bounds, unique/ambiguous/closed window
matches, lazy expiry in the view and broker, fresh activity returning, and Undo.
It also checked rotating rows, reduced motion, scrolled-out/hidden cleanup, stable
card size, narrow/enlarged-text layouts and 200% scaling. `make smoke` passed,
including automatic window activation, disabling with a session menu open,
focus callback cleanup and repeated enable/disable. Installer tests and the
rebuilt ZIP include the harness assets; all 106 packaged directory files matched
the working tree. Live terminal tabs/panes still need real-environment acceptance.

Terminal/setup follow-up: `make check` passed 153 tests and GTK preferences passed
the enable/reconfigure confirmation flow with temporary provider configs. Native
checks cover terminal alternatives/symlinks, explicit overrides, legacy migration,
named hooks, mixed user handlers, repeated installs/backups and rejection of
malformed configs or conflicting plugins. Read-only discovery on this machine
resolved the system terminal to Terminator. The settings preview was inspected at
200% scale; the rebuilt ZIP matches all 65 checked runtime/source files. No host
provider configuration was changed and no live harness session was launched.

Agents/navigation follow-up: `make check` passed 151 tests; the native agent
checks also verified populated defaults, preserved overrides and literal launch
arguments. GTK preferences, installer/ZIP checks and `make smoke` passed. Native
keyboard checks cover global open/close, forward/backward tabs, Ctrl+Tab,
Ctrl+Shift+Tab, and real typing after harness selection. The full sample preview
passed all eight tabs, inline menus, no scrolling in the default composer, draft
retention/errors, 200% scale and enlarged text. Calendar checks passed at
380/440px and 100/200% scale with a shared 282px surface (280px content plus border),
including reachable overflow on smaller displays. No host install or live agent
session was used for these checks.

Expansion checks: `make check` passes 151 tests plus syntax/schema validation.
`--check-motion` observes painted frames in an isolated preview and verifies inward
movement from both sides, stable layer sizes, Quick Ask focus, interrupted motion,
fullscreen-style cleanup and both reduced-motion switches. These passed at 100%
scale and in a real 200% nested display with 150% text, at 380/440px with compact
and fully populated notches. `make smoke` also passed after the motion change,
including input, Quick Ask focus/typing/shortcuts, preferences, scaling and repeated
enable/disable. The rebuilt ZIP contains the updated runtime and excludes the
motion fixture.

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
