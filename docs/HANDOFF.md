# Implementation handoff

Updated 2026-11-13. Target: GNOME Shell 46 on Ubuntu Wayland.

- [AGENTS.md](../AGENTS.md): engineering, packaging and commit rules.
- [README](../README.md): installation, development commands and hardware checks.
- [Module guide](MODULES.md): current Calendar, Agents, Weather and Commute behavior.
- [Google Calendar plan](GOOGLE_CALENDAR_PLAN.md): implementation progress and remaining phases.

## Current implementation

Media, system metrics, sound outputs and Bluetooth use native Shell services.
Weather, Commute, Agents and Calendar are opt-in. Calendar's module toggle applies
live; other module toggles still require disabling/re-enabling the extension.
Notch indicators reuse module state and respect consumer visibility.

Calendar supports Jalali, Gregorian and Iranian Hijri, holidays based on the
main calendar, blank neighboring-month cells and custom notch date codes/order.
Fresh notch settings select the main calendar once; later explicit selections
remain independent. Read-only EDS account events now have explicit calendar
selection, event lines, a split-view daily event list and an optional upcoming-event notch.
The optional EDS bindings are now installed and the probe passes; live Google sync
is unverified.
See the plan for setup, architecture and acceptance gaps.

Agents provides local hook/plugin status, unique process-to-window matching and Quick Ask.
Clear and the notch eye toggle are in the main header. Session states are event
reports, not continuous liveness checks. Weather and Commute use bounded async
requests, caches and explicit stale/error states. See the module guide for setup,
provider limits and privacy details.

## Latest interaction fixes (2026-11-13)

- Calendar day popups wait 450 ms, then show two smaller, muted dates without
  calendar labels, weekdays or calculation notes. Keyboard focus is immediate.
  One cancellable timeout belongs to the current hover; hiding/destroying the
  view cancels it. Commute keeps its immediate explanation popup.
- Hijri dates and lunar holidays use the published Iranian 1405 month starts
  in `services/iran-hijri.js`. Outside 21 March 2026–20 March 2027, conversion
  is an aligned tabular estimate. Preferences explain this coverage. No new
  requests, background timers or dependencies were added.
- Chromium's unbounded-duration sentinel is no longer treated as track length.
  Such streams show **Live**, with the marker at the end and seeking disabled
  because MPRIS supplies no usable seek window. Finite recordings keep normal
  progress. See [Chromium's MPRIS export](https://chromium.googlesource.com/chromium/src/+/8ba1bad80dc22235693a0dd41fe55c0fd2dbdabd/components/system_media_controls/linux/system_media_controls_linux.cc).
- Agents hover belongs to the stable row, independently of asynchronous window
  matching that enables/disables its activation button. Opening preferences now
  says **Opening tab**, with no subtitle and a value label that does not ellipsize.

Validation: `make check` (192 tests), `make prefs-test`, `make media-test`, install
tests and ZIP byte comparison passed. Native Calendar passed at 380/440px,
100/200% scale and enlarged text (`/tmp/ubuntu-island-preview-herdtt7z`).
Commute tooltip checks passed (`/tmp/ubuntu-island-preview-hwy2b2f6`).
`ISLAND_PREVIEW_CHECK_AGENT_HOVER=1` checks stationary hover through changing
window availability at both widths/scales; it passed with 1.5× text
(`/tmp/ubuntu-island-preview-bmuytft2`). `ISLAND_PREVIEW_CHECK_OPENING=1` with
`--preferences appearance` confirmed the complete value in mapped GTK labels
(`/tmp/ubuntu-island-preview-uogxxio7`). Media smoke rendering passed, including
the live-stream fixture (`/tmp/ubuntu-island-smoke-mij3l952/media-live.png`).
Full smoke still fails later at “Shortcut did not replace an already open tab”;
full preview fails its Calendar navigation-position assertion at 380px. Neither
suite is a full pass. Live browser playback and physical hardware were not
retested, and the host installation was not replaced. User reference `1.png`
remains untracked.

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

- Frosted material: the island is now three layers. `IslandBackdrop`
  (`ui/backdrop.js`) blurs the desktop behind the expanded card with
  `Shell.BlurEffect` in background mode; `.ubuntu-island-material` carries the
  theme tint, edge and opacity; content sits above both and stays sharp.
  Matte tone was previously a near-invisible gradient flatten (the two stops
  differed by about 20 levels, and nothing blurred), so 0 and 100 looked
  alike. It now maps to a 13/23/32/40 px radius at 25/50/75/100 (×scale) with
  slight dimming; opacity only sets tint alpha. The blur is off while collapsed,
  at matte 0 and at 100% opacity. Corners use seven in-arc slices. Partial
  repaints are widened up front (input, relayout, charts, weather frames,
  progress, service updates) and any other partial paint gets one full
  correction frame. Themes were refined (cards, borders, hover/pressed, accents,
  tab markers, secondary text). Not yet verified on hardware: `make smoke`
  captures `matte-*-opacity-75`, `opacity-*-matte-75` and `frosted-*`; check
  them and an external monitor before calling the blur done.
- Navigation tabs share spare width evenly across available modules. A caption
  slot reserves the longest available tab name, with padding before Settings;
  changing tabs never moves icons or changes caption visibility. The entire slot
  hides when it cannot fit. Appearance updates preserve module layout classes, so changing opacity
  or theme no longer changes tab spacing. Caption fitting is coalesced after
  layout/style changes and cancelled when hidden or destroyed.

- Fixed Agent activation with multiple Terminator windows sharing one PID.
  Hooks retain bounded terminal UUID/service metadata. Lookups verify the D-Bus
  owner's PID and compare the terminal's reported exact owning-window title only
  within that process's windows. Duplicate matches remain disabled; project names
  and title substrings are never used. Lookups run only while Agents is mapped,
  are cancelled on hide/disable, and are refreshed before activation.

- Calendar now uses two columns: a full main-calendar date and independent event
  list on the left, with month navigation above the grid on the right. Today is
  beside the selected date and follows the main calendar’s language. The month
  label is centered between the arrows. Cards use the EDS source color as a left
  accent, with a live theme accent fallback; grid indicators stay neutral.
  Neutral lines beneath day numbers replace dots. Event cards retain activation,
  all-day handling and service ordering; long titles ellipsize on one line.
  Title and time slots scale with fonts and keep every card the same compact
  height, even when a date has only one event. The multi-calendar
  popup heading is removed. Settings, event fetching and the bottom toolbar are
  unchanged. Both panels retain overflow access with enlarged text.

- Agents now keeps only the text status counts in its header. Working spinners
  remain on individual session rows, with hidden/reduced-motion cleanup.

- Restored navigation padding after the user clarified the gap was above the tab
  bar. Regular cards share a 248px height; the reduction removes the surplus band
  while preserving navigation spacing and reachable overflow.
- Calendar events now appear directly below the grid in the same scroll area.
  Removed the separate summary/setup footer and agenda/detail pages at the user's
  request. With no selected sources the event section is absent. A richer UI is
  deferred; the notch reveals the corresponding inline event row.
- `make install` checks and installs missing ECal/EDataServer Ubuntu bindings via
  `pkexec`, elevating only apt-get. It aborts before replacing the extension when
  package setup fails or is cancelled. `INSTALL_DEPS=0` supports offline/staging
  installs; tests never perform real package operations.
- Vazir v30.1.0 Regular/Medium/Bold and its OFL license are bundled. The installer
  registers an independently owned per-user font directory; previews isolate it.
  Native Pango checks confirm Vazir renders Persian text.

- Agent rows show a short session-ID suffix beside status so shared project names
  remain distinguishable. Suffix collisions expand with session/profile context.
  The anchored menu exposes a selectable read-only full ID with keyboard access;
  row and menu accessible names include the reference. No prompt/transcript
  content or window-title matching was added.
- Agent sessions reported as closed are omitted from broker snapshots immediately,
  including Undo counts. Finished tasks remain visible. Bounded closed records
  retain timestamp/retired-turn guards until ordinary expiry or capacity eviction;
  fresh activity can resume them. This does not infer session closure from a
  missing/ambiguous window match or add any background polling.
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
- Regular tabs and sections share a 248px content height (scaled with the UI),
  including Calendar. Keep the expanded width/height stable across navigation;
  with the original navigation padding restored. Use space
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
- Appearance settings expose open/close (Super+Alt+I), next tab (Super+Alt+Page Down)
  and previous tab (Super+Alt+Page Up) shortcuts. Ctrl+Tab/Ctrl+Shift+Tab navigate
  while open. Bindings update live and are released on disable. The informational
  Holiday markings and Hijri dates rows are removed from Calendar settings.
- The notch and card keep their own layout sizes inside a centered native
  fixed-layout viewport; see the [motion baseline](#motion-baseline).
- Sound outputs sort headphones (Bluetooth or wired), built-in speakers,
  HDMI/DisplayPort, then others. Stable ties do not promote the active device.
- Calendar dates share a compact header line when additional calendars are shown.
  Date text is now 10pt (single-calendar heading 12pt), with brighter text and
  reduced vertical padding. All three dates fit one line at 380/440px; enlarged text wraps
  and overflow remains reachable.
- Network rates reserve `500K` plus 4 logical pixels in the current font and
  scale. Longer current values can expand temporarily, without retaining the
  session's widest value. This replaces traffic-dependent spacing that could
  appear different after login; no new polling timer is involved.
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

Session references: `make check` passed 169 tests plus syntax/schema validation.
The native full preview passed same-project differentiation, full-ID keyboard
access, menu focus restoration, 380/440px layouts, enlarged text and 200% scale.
Rows remain reused across status updates. Screenshots of the list and menu were
inspected. An initial keyboard check caught and corrected Tab navigation into
the read-only entry. The Shell smoke test passed on a separate rerun; the first
run failed a Quick Ask shortcut assertion while another native preview was
running. No shortcut code changed. The ZIP was rebuilt; no host installation
was changed.

Closed-session filtering: `make check` passed all 168 tests plus syntax/schema
validation. The native GJS service/bridge test verifies closed sessions disappear
from real pipe snapshots across repeated start/stop cycles. Regression checks
cover stale reports, resumed activity, same-project sessions and Undo after
closure. The ZIP was rebuilt; the host install was not changed. No actor layout
changed, and the Shell UI smoke test was not rerun for this model-only change.

Compact-layout follow-up: 155 Node tests and GTK preferences checks passed. The
full native preview passed all eight tabs, the empty Agents state, a three-session
list and the default composer without scrolling, and narrow/scaled/enlarged-text
layouts. Keyboard focus now uses content coordinates, avoiding a race with native
focus scrolling; checks move between the first and last rows of a long list.
Calendar checks passed at 380/440px and 100/200% scale with all three dates on one
line, a 262px surface (260px content plus border), and reachable overflow with
enlarged text. A windowed native preview at 380px, 200% scale and 150% text was
also visually checked. The rebuilt ZIP matches all 110 checked runtime files. No host
installation or provider configuration was changed for this follow-up.

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

Google Calendar integration (2026-11-11): 171 checks passed with extracted optional
EDS typelibs, plus syntax/schema validation. Private EDS fixtures exercise source
discovery, native recurrence, modifications/removals, complete empty queries and
helper teardown; no host events or accounts are used. GTK preferences and native
Calendar checks pass at 380/440px and 100/200% scale with enlarged-text overflow,
event dots, agenda/details, removed events, Back/Escape, notch activation and
hidden cleanup. `make smoke` passes. Native Pango resolves Persian text to Vazir.
Live Google sync/authentication, cache freshness, Meet metadata and suspend/timezone
changes remain acceptance gaps. See `docs/GOOGLE_CALENDAR_PLAN.md` for details.

Delivery: the full sample preview passed all eight tabs and existing Agents/audio
interactions. Installer and ZIP checks passed. `make install` installed this
update and the bundled Vazir fonts per-user, preserving the previous extension as
`ubuntu-island@mhbahmani.github.io.backup.20261111184949`. Wayland logout/login is
still required to load the changed Shell code. That delivery did not change system
EDS packages or account settings.

Follow-up validation (2026-11-12): all 174 checks pass with the now-installed system
EDS bindings, including private EDS fixtures, syntax and schema validation. GTK
preferences, the inline Calendar at 380/440px and 100/200% scale with enlarged text,
and the full eight-tab preview pass. Inline event focus, removal, notch activation,
scrolling and hidden cleanup are covered. Agents checks retain individual working
animations while verifying the header has only status counts. Installer tests
cover missing dependencies, already-installed packages and cancelled authentication
without changing system packages or the host install.

The final smoke run passes after tightening Media and Commute content spacing to
fit the restored navigation padding. An earlier run intermittently missed Quick
Ask shortcut focus; the unchanged shortcut checks passed on the final rerun.
The build ZIP was rebuilt after the last CSS adjustment. Live Google account sync
remains unverified; tests use isolated fixture data.

Follow-up delivery: `make install` completed on 2026-11-12. Both required EDS
packages were already installed, so no privileged package action was needed.
The previous per-user extension was preserved as
`ubuntu-island@mhbahmani.github.io.backup.20261112133245`. Installed runtime files
and the rebuilt ZIP match the working tree. Log out and back in under Wayland to
load this version; account settings were not changed.

Bandwidth spacing follow-up (2026-11-12): replaced the remembered widest value
with a `500KB` reference plus 4 logical pixels. Native checks verify stable widths
across ordinary values, recovery after a longer value, interface/toggle changes,
enlarged text and 200% scale. The full eight-tab preview and all 174 automated
checks pass. The rebuilt package and per-user install include this adjustment.


Split-view Calendar validation (2026-11-12): `make check` passes all 175 tests,
JavaScript/Python syntax and schema validation. Native Calendar checks pass for
Jalali/Gregorian/Hijri, date and month selection, Today, all-day/empty days,
event removal/focus restoration, long titles, independent event scrolling,
notch activation, preferences, repeated toggles and hidden cleanup. Layouts pass
at 380/440px and 100/200% scale, with reachable enlarged-text overflow. The six-week
grid fits without scrolling at normal text size. Screenshots of the split view
and all four themes were inspected. The ZIP was rebuilt and changed runtime
files verified against its contents. No host installation or live Google sync
was performed.

The broader smoke test failed twice at “Next-tab shortcut did not advance,”
with Calendar disabled in that fixture. Media checks passed before that assertion;
the remaining smoke checks did not run. No shortcut or unrelated UI code was
changed for the Calendar redesign.


Calendar alignment/color follow-up (2026-11-12): 177 automated checks pass,
including private EDS source-color propagation and invalid/missing color handling
across the helper pipe. Native Calendar checks verify centered month text,
localized Today selection, aligned event stripes, row reuse on source-color
changes and live fallbacks across all four themes. Existing navigation, scrolling,
380/440px widths, 100/200% scale and enlarged-text checks pass. Screenshots were
inspected. Source colors are optional metadata only; event queries and account
configuration are unchanged. The ZIP was rebuilt; no host install or live Google
account validation was performed. The previously recorded general smoke shortcut
failure was not re-investigated for this focused follow-up.


Agent window follow-up (2026-11-12): both reported live agent processes share
one Terminator process, explaining the prior ambiguous PID matches. Read-only
lookups through the new adapter returned distinct owning-window metadata for both
actual sessions, without logging titles or reading terminal contents. All 180
checks pass, including metadata validation, relay propagation, private D-Bus
owner verification, missing terminals, cancellation and timeout. The native full
preview passes independently clickable shared-process sessions, duplicate-title
rejection, fresh activation lookup, hidden cleanup, late-reply rejection and real
window activation, plus existing eight-tab checks. Transient Clutter input-focus
warnings occurred during the fixture's text-entry changes; no JS errors or failed
assertions were reported. Installer/ZIP checks include the new runtime adapter.
No host installation or live session activation was performed. The earlier
general smoke shortcut failure remains recorded separately.

Navigation spacing follow-up (2026-11-12): all 180 tests,
syntax checks and strict schemas pass. Native full preview
`/tmp/ubuntu-island-preview-zsa5kuq3` passes equal tab distribution for 2/4/8
modules at 380/440/480px, 100/200% UI and text scale, caption hiding/restoration,
and stable geometry through opacity/theme changes. The initial mapping warnings
were fixed by deferring caption visibility changes; the existing transient
Clutter input-focus warnings still occur in the Agents typing fixture.

Event-card sizing follow-up (2026-11-12): native Calendar preview `/tmp/ubuntu-island-preview-4b5bpeu7` passes single-line title
ellipsis, equal card heights for long/mixed-script titles and one-event days,
font scaling, full accessible titles, independent scrolling and the existing
calendar/preferences checks. No host install or live-provider behavior was tested.

Caption stability follow-up (2026-11-12): `make check` passes all 180 tests,
syntax and schema checks. Native full preview
`/tmp/ubuntu-island-preview-hgk1de6b` passes switching every available tab at
2/4/8 modules, 380/440/480px, 100/200% UI and text scale. It asserts unchanged
icon positions/caption visibility, full label fit and at least 8 logical pixels
between caption text and Settings. The ZIP was rebuilt; no host install.

Calendar display preferences and notch spacing (2026-11-12): added live
Show holidays and observances (default on), Event title font size (8–14 pt,
default 9), and Use calendar language (default on). The holiday switch hides
both built-in notes and recognized Google holiday-source events; personal
all-day events and nonworking-day colors remain. Classification uses EDS resource
identifiers, including Google's encoded IDs, not calendar names or event titles.
A read-only live catalog check recognized the selected Holidays in Iran source.
English display covers tab/notch dates, accessible descriptions, Today and
built-in observance descriptions, preserving calendar conversion and saved
notch numeral choices. Reopening resets the selected date/month to today.

The network reference is now 500K plus 4 logical pixels, replacing 500KB. Current
labels wider than that reference remain readable and shrink again afterward.
Native Calendar checks passed at 380/440px, 100/200% scale, enlarged text and
8/9/14pt event titles, including live holiday filtering, focus restoration,
English dates and repeated reopen resets. GTK preferences and focused network
width checks passed. The history-chart harness now provides the backdrop
invalidation dependency and verifies that hidden charts do not invalidate it.
`make check` passes all 190 tests, JavaScript/Python syntax and strict schemas.

The event-reader failure was caused by waiting up to five seconds per EDS source
for remote connectivity before reading the existing cache. Seven selected live
sources took 29.5 seconds, exceeding the parent's 20-second request deadline.
Using ECal's documented no-wait sentinel returned the same 28 cached occurrences
across all seven sources in 0.259 seconds. Existing EDS view/online notifications
still deliver subsequent changes. No new polling, worker or cache was added.
A two-second idle probe measured zero CPU ticks and no unsolicited snapshots;
closing its input terminated the helper cleanly. This checks cached availability,
not a guarantee about subsequent remote synchronization latency.

Jalali/Hijri notch rows now offer independent short English month names, effective
only with calendar language disabled. The optional notch clock has 12/24-hour
and seconds controls. Minute-only display shares GNOME's wall-clock signals;
the seconds timer exists only while the collapsed clock is mapped and enabled.
Native Calendar/clock preview `/tmp/ubuntu-island-preview-9yc1oep2` passes format,
short-month, stable-width, accessibility and hidden/expanded/disabled cleanup
checks. Screenshots were inspected. `make prefs-test` passes the new controls.

The broader full preview still fails navigation-position/caption assertions
while switching tabs at narrow widths or 200% scale; focused network checks pass.
`make smoke` (`/tmp/ubuntu-island-smoke-eep0mwco`) passes media, Quick Ask, map
editor and shortcut recorder checks, then stops at an Agents focus assertion.
These broader native failures remain unresolved. The final ZIP was rebuilt and
all 126 runtime source/assets compared byte-for-byte, with the compiled schema
also present. No host installation was changed.

Commute explanations, date hover and previous-tab shortcuts (2026-11-12): Balad
now uses its plain name in the UI; settings still describe the unofficial keyless
adapter. The footer credits the provider of the displayed estimate (including
fallbacks) alongside OpenStreetMap, with a link to attribution details. Balad's
own map also credits OSM. The preferences map keeps its separate OSM tile credit.
Unverified traffic is an icon with “Live traffic freshness not confirmed” on
hover/focus; loading and error messages remain visible.

Calendar days share one popup displaying the other two full calendar dates,
following the language preference and retaining the calculated-Hijri qualifier.
Hover does not change selection. Popups support keyboard focus, remain within
monitor bounds and are removed with their view; there are no timers or polling.
The shared helper is `ui/hover-tip.js`, included by both recursive packaging paths.

Both old default tab shortcuts overlapped GNOME workspace switching on this
machine. Defaults now use Super+Alt+Page Down/Page Up; explicit custom bindings
remain untouched. The shortcut editor rejects GNOME window-manager conflicts.
Backward Tab also handles ISO_Left_Tab when Shift has been consumed by the
keyboard layout. Native real-modal checks pass repeated global forward/backward
cycling and Ctrl+Tab/Ctrl+Shift+Tab; GTK recorder conflict rejection passes.

`make check` passes 191 tests plus syntax/schema checks; GTK preferences and both
installer tests pass. Native Calendar preview `/tmp/ubuntu-island-preview-s4ovwns8`
and Commute preview `/tmp/ubuntu-island-preview-dl0ko8t7` pass hover/focus, language,
provider fallback credits, loading/errors, hidden/disabled cleanup, 380/440px,
100/200% scale and enlarged text checks. Screenshots were inspected. Calendar
fixtures now keep sample events on their intended day near midnight; the final
Calendar run used UTC inside the isolated session. The clock check avoids its
intentional 5ms second-boundary grace period.

`make smoke` (`/tmp/ubuntu-island-smoke-_sd1prrs`) passes media, tab shortcuts,
Quick Ask, Commute layout/recovery, map editor and shortcut recorder checks, then
stops at the previously recorded Agents window-focus assertion. That broader
failure remains unresolved. The ZIP matches all 127 runtime sources/assets and
contains the compiled schema. No host install, account or system shortcut was
changed, and no live route/provider-accuracy claim was made.
