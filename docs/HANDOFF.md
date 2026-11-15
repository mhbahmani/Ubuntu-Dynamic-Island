# Implementation handoff

Updated 2026-11-15. Target: GNOME Shell 46 on Ubuntu Wayland.

- [AGENTS.md](../AGENTS.md): engineering, packaging and commit rules.
- [README](../README.md): installation, development commands and hardware checks.
- [Module guide](MODULES.md): current Calendar, Agents, Weather and Commute behavior.
- [Google Calendar plan](GOOGLE_CALENDAR_PLAN.md): implementation progress and remaining phases.

## Current implementation

Media, system metrics, sound outputs and Bluetooth use native Shell services.
Weather, Commute, Agents, Notifications and Calendar are opt-in. Calendar's module toggle applies
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

## Audio crash on resume (2026-11-15)

The host journal recorded six Shell SIGSEGVs on November 12–14 at
`AudioService._describe()` while reading `p.profile`; earlier errors at the same
line reported invalid UTF-8. The November 13 native dump stopped in string
conversion. The installed audio service matched the source before this fix.

GNOME 46's Gvc `update_card()` replaces/frees card profiles, then updates each
UI device's borrowed profile list in turn. Availability/output signals fire
synchronously between those updates. Our callbacks scanned every output at
that point, including devices whose profile pointers had not been refreshed.
See [Gvc's card update implementation](https://github.com/GNOME/libgnome-volume-control/blob/91f3f41490666a526ed78af744507d7ee1134323/gvc-mixer-control.c).

All audio refresh entry points now queue one cancellable idle, letting the
native update finish before reading profiles. Card changes also request a
refresh even without an availability change. Connecting devices are retained
without reading their profiles until READY; replaced objects shed old signal
handlers. Disable cancels the idle and disconnects all observers without closing
Shell's shared mixer. No polling, background worker or UI change was added;
Bluetooth Music/Calls grouping and device ordering are preserved.

Validation: the four focused audio tests pass, including an invalid-profile
window, signal burst coalescing, reconnect, removal/replacement and repeated
stop/start. Reintroducing synchronous signal refresh makes the regression fail
at the invalid-profile read. `make check` passes (227 passed, one ancestry skip),
syntax and strict schema validation included. A separate native GJS/Gvc process
passed 20 lifecycle cycles with real GLib idles/GObject signals and read-only
live device discovery (`/tmp/island-audio-native-gxoa7l2w`); it did not change
volume, routing or the host Shell. `make smoke` passed end to end
(`/tmp/ubuntu-island-smoke-2fwuumxx`). `make build` passed; ZIP integrity and the
packaged audio source were verified. Physical suspend/resume and Bluetooth/HDMI
hotplug remain unverified. The host installation has not been replaced.

## Notifications (2026-11-14)

Opt-in Notifications tab with compact and grouped layouts, a toolbar (new count,
layout, Do Not Disturb, Clear), app logos, hover/focus actions, pinned critical
items, an empty state with Do Not Disturb, notch peeks and an unseen-count notch
item; see the module guide. The service mirrors `Main.messageTray` signals and
writes only GNOME's own `show-banners` key. The pill overlays a zero-natural-width
peek row on its indicators, so peeks never widen the notch. Pill reordering moved
from `actor.get_child()` to `_content`; the preferences notch-order chips are
4px narrower to fit 11 items in 300px.

Navigation now holds nine tabs. The full navigation check was extended to 9 tabs
but stops at its existing Calendar icon-position failure at 380px (same result on
the unchanged tree), so 9-tab navigation was checked only through
`--check-notifications` at 380/440px, 100/200% scale and 1/1.5× text.
`--check-notifications`, smoke, node tests and prefs smoke pass. Live app
notifications on the host session are unverified.

## Preview UI preferences (2026-11-13)

Normal previews copy presentation preferences from the host before creating the
isolated settings backend: theme/material, notch order/visibility/formats, widths,
calendar display, hover/motion, and desktop text size/reduced motion. Service
configuration stays simulated and all module tabs remain available. Explicit
preview flags override the snapshot. `--defaults` and automated check modes use
the original demo settings. No preview write reaches the host backend.

`make check` passed 217 tests with one ancestry skip, syntax and schema validation.
Native backend tests cover typed values and isolation. A real headless preview
matched all 44 extension values and both desktop values; host values stayed
unchanged. Explicit overrides passed in a second run, and `--check-input` passed
with demo defaults in a third. Logs/screenshots: `/tmp/ubuntu-island-preview-y07huzxe`
and `/tmp/ubuntu-island-preview-d9cuqgy2`. Only development helpers changed.

## Calendar popup themes (2026-11-13)

Date and full-event-title popups now carry their own theme class because their
top-chrome actors are outside the island's themed hierarchy. Generated CSS uses
the existing tint gradient, edge and text tokens; existing Calendar updates keep
open popups in sync without new signals or timers. Text stays fully opaque.
All 14 appearance checks, syntax checks and the native Calendar preview passed,
including all eleven popup palettes, live switching, 380/440px, 100/200% scale,
enlarged text and cleanup (`/tmp/ubuntu-island-preview-raumqxwe`). Date and event
screenshots were inspected. The ZIP was rebuilt; no host installation changed.

## Calendar event loading (2026-11-13)

Opening Calendar used to cold-start the EDS reader every time (about 0.35–0.4 s
for seven sources on the development machine) and showed an empty loading state
meanwhile, because hiding stopped the reader and discarded its snapshot. The
extension never downloads events; EDS serves its local copy.

- `CalendarEventsService` keeps the last six data-bearing snapshots (ready,
  partial, offline) in Shell memory by request signature. An identical request
  shows its cached copy at once; the reader's interim loading report is skipped,
  so revalidation (and live EDS changes while open) replace events in place.
- Hiding both consumers calls `suspend()`: the idle reader keeps its EDS views for
  120 s (change signals only, no polling), then exits and keeps the memory cache.
  Reopening within that window reuses the reader with no query.
- Disabling events, clearing the selection, extension disable and lock (which
  disables the extension) clear the cache. Nothing is written to disk.

Validation: `make check` (216 passed, 1 skipped), the native reader lifecycle test
(cache hit, no loading flash, grace reuse, expiry, bounds, teardown) and
`tests/preview.py --check-calendar --headless --duration 150` passed. Not checked
with live Google sync or on hardware.

## Smoke harness reliability (2026-11-13)

`make smoke` had stopped passing for three separate reasons, none a product bug:

- Shortcut checks pressed a just-rebound key in the same main-loop turn as the
  rebind; Mutter's binding rebuild sometimes lost that race under load (handler
  never called; confirmed with logging). A shared `settle()` (100 ms plus a
  low-priority idle turn) now precedes presses after rebinding or re-enabling.
- `9779c58` moved Commute credits into the closed provider panel and updated only
  the preview fixture. Smoke now asserts the credit is off the route face and
  measures the controls row for scroll reachability.
- A full pass now takes about 80–95 s, but the harness killed sessions at 90 s.
  `tests/smoke.py` ends the session 2 s after the final PASS/FAIL line, keeps a
  180 s backstop, and reports a timeout explicitly.

Validation: the shortcut step passed 5/5 at `HEAD` with only the first fix;
a full run with all fixes passed end to end in 95 s, ending 3 s after the
result, with no JS errors. `make check` passed (216, 1 skipped).

## Stale working agent sessions (2026-11-13)

The installed broker/model matched the source, but retained Working when a
provider exited without SessionEnd. Opening the Agents list now runs one bounded
asynchronous `/proc/<pid>/stat` check per known agent process in the existing
broker. Missing processes, zombie/dead states and changed birth tokens close
their records and update shared counts without success notifications. Live or
unverified processes retain their reported state. No polling or worker was added.
Hide/disable cancel checks; report generations reject late results after new
activity or record recreation. The inactivity cutoff remains independent.

Validation: `make check` passed 216 tests with one existing ancestry skip, plus
JavaScript/Python syntax and strict schema checks. Native tests cover live/exited
processes, PID reuse, cancellation, timeout, unknown identity, newer reports and
recreated records; the service/bridge test verifies a missed SessionEnd disappears
from shared snapshots and counts. Temporary install and ZIP byte checks include
the new helper through the existing recursive copy paths. No UI layout changed;
Shell smoke and live-provider acceptance were not rerun. The host installation
and provider configuration were not changed.

## Theme selection and popup polish (2026-11-13)

- The theme ComboRow binds its label and swatch to the selected StringObject;
  the selected-value model's position is always zero and was showing Graphite.
- Clicking a calendar date selects it and dismisses its alternate-date popup.
  Hover still waits 450 ms, and keyboard navigation retains date explanations.
  Date text is 9pt with integer popup positions. Calendar popups fade in for up
  to 160 ms without scaling text; power saver and both reduced-motion switches
  open instantly. The power check reads GNOME 46's existing cached profile.
- Ellipsized event titles reveal their complete text on hover/focus. Popups
  follow scrolling, hide outside their viewport, and cancel pending work on hide
  and destruction. No polling or new background service was added.
- Download/upload chart and rate colors are swapped through the theme generator.
  Commute credits moved from the route face to the existing provider details.

Validation: `make check` passed (214 passed, one environment-dependent ancestry
skip), as did `make prefs-test`, including every selected theme label/swatch.
Native Calendar passed at 380/440px, 100/200% scale and enlarged text, with click
suppression, full event titles, scroll positioning, fades, simulated cached
power-saver state, both reduced-motion switches and hidden cleanup
(`/tmp/ubuntu-island-preview-ecs7nujd`). Screenshots were inspected. The Calendar
fixture's obsolete hardcoded Today color now follows the current theme token.
Native Commute passed its credit placement, tooltip and layout checks
(`/tmp/ubuntu-island-preview-1j96rqqo`); its first preview timed out on startup.
The ZIP was rebuilt and the changed runtime files compared byte-for-byte.
Full smoke stopped at the previously recorded Quick Ask assertion, “Shortcut
did not replace an already open tab” (`/tmp/ubuntu-island-smoke-fn_fhwto`), after
media and tab shortcut checks passed. No host install, live provider or physical
mixed-monitor validation was performed.

## Commit review validation (2026-11-13)

Reviewed the combined theme/navigation, chart fill, compact network rate and
agent metadata changes. `make check` passed: 214 tests passed, one ancestry test
was skipped because the runner has a real agent ancestor, and none failed.
JavaScript/Python syntax and strict schema checks passed. `make prefs-test`,
`make smoke` and `make build` passed. The smoke artifacts are in
`/tmp/ubuntu-island-smoke-elnksao4`. Packaging tests passed with a temporary
installation; ZIP runtime files were compared with the working tree.
Live providers and physical mixed-monitor behavior were not tested. Historical
briefs in `docs/briefs/` retain their original instructions and findings; use the
implementation notes below for current behavior.

## Agent session metadata (2026-11-13)

Implemented the authorized `briefs/agent-session-metadata.md` scope over the
existing themes, backdrop, slider, charts, network-rate and smoke work.

- Session titles are separate from a stable initial project fallback. Provider
  `session_title` fields and Claude's bounded per-session `custom-title.json`
  metadata supply headings; ordinary cwd changes cannot overwrite them. A title
  update changes neither activity time nor completion notification state.
- `helpers/agents/titles.js` owns asynchronous metadata reads and narrow directory
  monitors in the broker subprocess. Reads are capped at 8 KiB/one second; events
  coalesce for 60 ms. Monitors/read callbacks stop on hide, composer, expiry and
  disable, with a fresh read on reopening. Locators never enter Shell snapshots;
  transcripts are never opened. No new periodic scan/polling or SDK was added.
- Waiting is derived from the parent's response lifecycle plus bounded task IDs,
  kinds/statuses and verified active children. Stop snapshots are authoritative
  when present; missing fields retain known work. Child-context hooks do not
  mutate parent lifecycle/title. Completion/failure/cancellation of one child
  never clears others or finishes the parent. Waiting has separate summary and
  notch counts, no completion notification, and is excluded from Clear finished.
- Parent links use inherited `CLAUDE_CODE_SESSION_ID`, matching profile/session
  identity and PID/birth-token evidence from the existing 16-hop hook ancestry.
  An outer Codex bounds the immediate delegation chain. HOST_SESSION_ID, labels,
  project/window sharing and title matching are excluded. Only Claude-to-Codex
  links resolve, including child-first arrival. Hidden/finished parent renames
  update the cue; removed parents leave bounded historical attribution.
- The child keeps its icon, session reference and existing activation path.
  A wrapping **⤷ From Claude** cue shares the status line; hover/focus, accessible
  labels and the anchored menu expose the parent title. Rows are reused without
  reordering on updates. Waiting uses the existing static idle icon and theme
  color. Shared hover tips prioritize keyboard focus over unrelated pointer
  allocation events. No theme/style generation changes were needed.
- Claude setup upgrades add owned SubagentStart/SubagentStop handlers. PreToolUse
  stays limited to AskUserQuestion: a relay before every tool cost about 50 ms
  per call, so resumed work shows when its first tool finishes. Use **Reconfigure…**, then restart the provider,
  when installation/setup is authorized. No live hook/config/installation was
  changed in this task. Unsupported provider versions/layouts keep stable project
  labels and legacy Stop behavior when no task evidence exists. The local title
  layout, process names and inherited variable are compatibility observations,
  not guaranteed provider protocols; live versions still need acceptance.

Validation: `node --test` and `make check` pass 215 tests, JavaScript/Python
syntax checks and strict schema validation. The native tests use temporary
provider configuration, title files and sockets: they cover broker/client
visibility end to end, bounded/malformed/missing/symlink metadata, atomic rename,
late callback cancellation, native process ancestry, profile matching, rejection
of inherited IDs without a matching ancestor and no HOST_SESSION_ID fallback.
The model suite covers stable headings, renames, waiting/attention/finished
counts and notifications, multiple tasks/children, terminal task outcomes,
duplicate/late/child-context events, older payloads and parent relationship cases.
`node --test tests/agents-native.test.mjs tests/install.test.mjs` also passes all
10 native/packaging checks; installer targets and ZIP byte comparisons were
private and include the new metadata reader.

The focused native metadata preview passes at 380/440px, 100/200% UI and
100/150% text, including wrapping, focus, stationary hover, live rename,
unchanged row/order/activation identity, reachable session details, waiting notch
count and hidden cleanup. Inspected screenshots and logs are in
`/tmp/ubuntu-island-preview-dprawrtb`. The checks exposed and fixed focus loss when
mapping the menu clamped the list scroll position, plus hover-tip focus priority.
An earlier preview failed to initialize; it was rerun successfully.
Full `make smoke` passes after the UI fixes, including verified process/window
activation, stale-PID rejection, repeated enable/disable, themes/backdrop,
network widths, outside dismissal and Escape:
`/tmp/ubuntu-island-smoke-ctk2gi8z`. No preferences implementation was changed by
this task, so a separate `make prefs-test` was not required. Live Claude/Codex
payloads, provider upgrades, real desktop delegation/window routing and physical
mixed-monitor behavior remain untested. No host installation, live hooks,
provider configuration, push or commit was performed.

Files changed for this task (other agents' existing edits remain intact):
`extension.js`; `helpers/agents/{bridge,relay,titles}.js`;
`services/{agents,agents-model,agents-setup-model}.js`;
`ui/{agents-view,hover-tip,pill}.js`; `scripts/{build,install}.sh`;
`tests/{agents-metadata.test,agents-native.test,agents-service,agent-titles-native}.mjs`;
`tests/fixtures/local-preview.js`; `docs/{MODULES,HANDOFF}.md`.

## Latest interaction fixes (2026-11-13)

- Calendar day popups wait 450 ms, then show two centered, muted 8pt dates without
  calendar labels, weekdays or calculation notes. Keyboard focus is immediate.
  One cancellable timeout belongs to the current hover; hiding/destroying the
  view cancels it. Popups apply their style before measuring complete lines,
  so the first hover has the correct size even after font/scale changes.
  Commute keeps its immediate explanation popup.
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
Popup sizing/centering checks also pass on the first hover and at enlarged text
sizes (`/tmp/ubuntu-island-preview-7754ctk3`); shared Commute tooltip checks pass
after the measurement fix (`/tmp/ubuntu-island-preview-2ts7ku_9`).
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
- Opening decelerates with `EASE_OUT_QUART`; content transforms use
  `EASE_OUT_CUBIC`. Closing uses `EASE_OUT_CUBIC` and 75% of the configured
  opening duration. These values are the current reference when tuning related motion.
- Layers hand off instead of cross-fading mid-surface. Opening: the notch fades
  out in 35% of the duration (its contraction keeps 65%); the card fades in over
  75% with `EASE_IN_OUT_QUAD`. Closing mirrors it: the card fades out in 50% (its
  lift keeps 65%); the notch fades in over the full close with
  `EASE_IN_OUT_CUBIC`. Opacity runs on its own curve, never a timeline `delay`.
- The surface keeps its open (fully rounded) corners while closing and squares
  its top corners only once docked, mirroring the opening's first frame.
- The notch keeps its collapsed layout while fading out; it hides collapsed-only
  items (time, date, event) once fully covered and restores them as the close
  starts. A width change mid-close retargets the close in its remaining time
  instead of snapping (this snap previously removed the closing animation).
- Reverse from the current pose when interrupted. Keep focus and input usable,
  honor both extension and desktop reduced-motion settings, and settle fully
  on hide/disable. Use native constraints/transitions; avoid runtime frame timers,
  snapshots and per-label animation loops.
- Recheck expansion, closing and Quick Ask with `--check-motion` after related
  changes: compact/full notches, narrow/default widths, 100/200% scale, enlarged
  text, reversals and reduced motion. It samples painted frames in both
  directions: intermediate closing sizes, centering, fixed content sizes and the
  layer hand-off, plus tab changes in both directions and an interrupted
  switch. It warms up with one unmeasured open/close first: the nested
  compositor stalls on its first transition. Run the native smoke test for input
  and cleanup. An occluded windowed preview may paint about 1 fps and fail frame
  checks; use headless.

Tab transitions: the selection marker glides between tabs (see Recent UI
changes) and one shared page transition in `ui/card.js` (`_revealPage`) covers
every tab. On the marker's timing (75% of the opening duration) the incoming
page fades in (80%, `EASE_OUT_QUAD`) and settles 14 logical px from the side of
the selected tab (`EASE_OUT_CUBIC`; `pageDirection()` follows tab order). The
outgoing page hides at once: pages share one column, and overlaying both would
need a snapshot. Only opacity and translation change, so the card keeps its
size and text never re-lays out. Each transition frame widens to a full backdrop
repaint. It runs only for user tab changes on a fully open island (not opening,
Quick Ask, availability changes or reduced motion); interrupted or hidden pages
settle to full opacity. In-tab subviews (lyrics, queue, calendar days, agent
menus) and the media tint still switch instantly; reuse the helper if needed.

## Recent UI changes

- Task 3 smoke diagnosis: clean `HEAD` (`699089b`) reproduced the same Agent focus
  failure (`/tmp/ubuntu-island-smoke-xs54y7ew`). The fixture left Agents before
  activation (disabling the resolver) and changed only the call argument's PIDs,
  which failed current-session revalidation. It now keeps Agents mapped and
  publishes the target PIDs through `_renderAgents`, verifies stale arguments
  remain rejected, and checks collapse, grab release, focus and idle cleanup.
  Product activation guards remain intact. The slider check restores its page
  as well as its animation preference; its native transitions add no focus idle.

  Validation: `node --test` and `make check` passed all 200 tests plus syntax and
  schema checks. The corrected activation fixture passed full smoke before the
  bandwidth change (`/tmp/ubuntu-island-smoke-p_wws7cl`). Network checks cycle
  zero, `999K`, `1.0M`, `120M`, `1.0G`, `999G` and `888B` through raw samples,
  checking both rate slots and the whole notch for resizing and clipping.
  Reserved widths per label (including the 4 logical-pixel gap) are 36px at
  100% and 72px at 200%; with 150% text they are 50px and 104px respectively.
  The headless test scales font DPI through the desktop text factor as well as
  St geometry, since changing St scale alone leaves glyph sizes unchanged.
  These are isolated native measurements, not physical-monitor acceptance.
  Final `make smoke` passed end to end, including lifecycle cleanup; logs and
  inspected rate screenshots: `/tmp/ubuntu-island-smoke-11vcrke6`. No host
  installation or live-provider/hardware checks were performed.

- Tab colouring (options A, D and E from the 2026-11-13 review): the selected tab's
  icon takes the theme accent, and one `ubuntu-island-tab-slider` in a pass-through
  BinLayout wrapper glides under it (`EASE_OUT_CUBIC`, 0.75 × opening duration,
  both reduced-motion settings honoured). Opening, layout changes and quick ask
  snap it instead of animating. Hovering a tab changes its text colour only;
  per-tab markers indicate keyboard focus. The navigation bar is shaded with
  the theme's bottom tint, an accent hairline and an accent caption. Also themed: keyboard focus rings (`focus` token, ≥ 3:1, same
  widths as before) and section headings (`heading` token, ≥ 4.5:1; Graphite
  stays neutral). Not yet verified in a live session: `make smoke` runs
  `_checkTabSlider()` (centred after a glide, instant with animations disabled).
  Next, via Codex briefs in `docs/briefs/`: themed chart fill and themed notch.
- Themes: palettes moved to `services/themes.js` and grew from four to eleven
  (new: Lagoon, Amethyst, Berry, Midnight, Aurora and Sunset as two-hue
  gradients, and Mocha). Tints and accents are more saturated. Each theme is
  seeds only: a dark tint gradient and one accent. Secondary text, card
  surfaces, borders, hover/pressed, strong buttons (saturation capped at 62%,
  ≥ 5.4:1 with button text), chart line, today marker and tab marker are
  derived. Graphite keeps neutral surfaces; the selected tab marker uses its accent.
  `scripts/theme-css.mjs` (`node scripts/theme-css.mjs`) generates the stylesheet block, and
  `tests/appearance.test.mjs` checks contrast, schema choices and that the
  CSS is current. The first four ids stay in order so saved Preferences
  indices are unchanged. Not yet checked in a live session: `make smoke`
  captures `theme-*`, `frosted-*` and calendar theme shots for all eleven.
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
- Network rates use raw `rxBytes`/`txBytes` samples and `compactRate()` (at most
  four characters; binary units, capped at `999G` with full accessible rates).
  Compact and System-tab rates promote before rounding to 1000. Slots reserve
  the widest integer/decimal unit template plus 4 logical pixels using each
  label's Pango layout, cached until scale/style changes. Traffic never changes
  their width; no sampler, polling timer or per-frame work was added.
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

That revision used a 500K reference plus 4 logical pixels, replacing 500KB, and
allowed longer labels to grow temporarily. Task 3 supersedes this with fixed
compact-rate slots (see Recent UI changes).
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
