# Session handoff

Updated 2026-11-09. Target: GNOME Shell 46 on Ubuntu Wayland. Read
[AGENT.md](../AGENT.md) for performance, provider, privacy, and commit rules.

Quick Ask keyboard shortcut (2026-11-09): configure **Agents → Quick Ask → Quick
Ask shortcut** in preferences; the default is unset. The native recorder requires
Ctrl/Alt/Super and supports Escape to cancel and Backspace to disable. The binding
updates live and is released on disable. It works with session tracking disabled.
The existing island surface widens into a compact focused entry, using the saved
agent/destination/project (home when empty). Enter uses the existing validated
launcher; desktop/web destinations still copy for manual paste. Escape, outside
click and Close retain the in-memory draft; success clears it, errors keep it
open. Normal opening restores the regular card. Hover-close is suspended while
typing, hidden pages stop their active work, and enlarged text/target changes
recalculate height with one coalesced idle. The shortcut does not take focus from
preferences, the lock screen, overview or a hidden fullscreen notch.

Validation: 131 Node tests, syntax/schema checks, GTK preference bindings and
private GNOME smoke passed. Native checks include actual shortcut keys and typed
text, Enter, Escape/outside dismissal, launch failure, live rebinding, switching
from an open tab, 380px/150% text, 200% display scaling, preference recording and
repeated enable/disable with tracking off. Temporary-XDG installation and ZIP
integrity/source checks include both new root modules (`quick-ask.js` and
`shortcut-prefs.js`), already covered by the scripts' root-module glob. Native
artifacts: `/tmp/ubuntu-island-smoke-tlhwtrqn`. Existing headless Clutter input-focus
warnings still occur in the full Agents composer; real IME and authenticated
provider sessions remain unverified. This addition has not been installed.

The preceding media fix, Agents redesign, adaptive Notch order and robot icon
were committed separately as `e5ee16b`, `1a591fc`, `d943843` and `d8284c4`.

Agents icon follow-up: replaced the generic gear with a shared outlined robot
head in the tab, collapsed notch, preferences navigation and both Notch order
layouts. The SVG lives in the bundled hicolor icon directory so GTK recognizes
it as symbolic and recolors it for light/dark themes. Shell uses the same file
through Gio.FileIcon. Existing recursive asset copying covers installation,
packaging and previews; temporary-XDG installation and ZIP checks passed.

Agents UI redesign (2026-11-09): project-first clickable rows replace Open/X
buttons. Nine symbolic states, one native animated working arc, stable row order,
collapsed Recent, explicit window rebinding, menu actions and broker-backed Undo
are implemented. Reopening groups attention before work/history; events preserve
row actors/focus. Header, Quick Ask and navigation are fixed around the list.
Quick Ask retains drafts on Back/errors, remembers successful project folders,
and supports Ctrl+Enter and nested Escape. Animation stops when hidden, in
secondary views, on disconnect and under reduced motion; there is no JS frame
loop. Hidden rows count toward the 32-row cap and are evicted first. Undo uses
live broker data and never cancels or controls an agent.

The inline concept rendered in local browser checks, but the user's chat preview
failure could not be reproduced or attributed to a specific client error. The
native preview and captured PNGs provide a fallback. Use `make preview-agents`.

The user's `2.png` showed Notch order growing with seven labeled chips. It now
uses measured native GTK presentations: labeled 18px icons when they fit, compact
14px icons when they do not. The selected name remains below; accessible names,
tooltips, drag/drop and arrow controls remain available. Reordering reuses widgets
instead of rebuilding them. Its minimum measured width fell from 603px to 258px
at the default test font; GTK allocation checks cover 300–900px and enlarged text.

Validation: 131 Node tests, syntax/schema checks, GTK preferences (including both
order layouts), private MPRIS tests, the full seven-tab sample preview and native
Shell smoke passed. Agents checks cover actual keyboard typing/Ctrl+Enter under
a real modal grab, draft retention and launch errors, Undo after new events,
window selection/focus/closure, hidden/reduced-motion cleanup, 380px with 150%
text and 200% display scaling. Installer checks use temporary XDG data; ZIP
integrity and packaged runtime sources were compared with source.

Latest native artifacts: `/tmp/ubuntu-island-preview-4h0k_n1j` and
`/tmp/ubuntu-island-smoke-k74tqwmw`. Screenshots were inspected; convenient copies
are under untracked `output/agent-ui/`. Headless GNOME still logs Clutter
input-focus cursor/surrounding assertions on a populated composer; keyboard text,
submission and focus checks pass. This warning is not claimed fixed. Real IME
composition and authenticated provider sessions remain unverified.

These changes have not been installed. User screenshots were excluded from commits.

Media seekbar follow-up (2026-11-09): the supplied Telegram screenshot showed
5:24 elapsed on a 5:01 track after headphone Next. The installed media service
matched this checkout; read-only MPRIS inspection found Telegram reporting the
generic `/org/desktop_app/track/0` ID. A regression reproduced the overshoot when
new-track metadata reused that ID without a Position/Seeked update.

Track identity now also considers URI, title, artist and album. A transition
resets the old clock and performs the existing bounded asynchronous Position
read; artwork and duration-only updates do not reset it. Explicit position
samples win over cached values. Track revisions invalidate stale seek drags and
failed seeks, including reused IDs. Both the service estimate and visible elapsed
time clamp to a known duration; unknown-duration streams keep their elapsed time.
No polling was added.

Validation: 129 Node tests, syntax/schema checks, private D-Bus metadata-only
Next transitions with reused IDs, native GNOME seek/drag and duration-bound checks,
and ZIP integrity/source checks passed. The native screenshot now shows 5:01/5:01
for an injected overrun. No real player was advanced or paused by the tests;
physical headphone Next still needs user verification after installation/reload.
This follow-up has not been installed.

Agents prototype (2026-11-09): an opt-in seventh module tracks local Claude Code,
Codex and OpenCode lifecycle events, with last-reported status/time, bounded session
rows, dismiss/clear, a static ordered notch indicator and optional notifications.
Open offers an explicit window chooser and retains the chosen window until it
closes. It does not claim to select terminal tabs or enumerate arbitrary browser
conversations. Quick Ask launches a CLI with literal arguments, or copies a prompt
and opens the selected CLI, desktop app or supported website. Agent authentication
and permission handling stay with the agent.

The external GJS bridge uses a private Unix socket for events and a stdout pipe
for coalesced Shell updates. Input limits, timeouts, UID checks, generation guards
and parent-pipe shutdown bound its work; there is no idle polling or transcript
collection. GTK preferences provide review/install/remove/check/test controls for
optional hooks/plugins. Installation preserves unrelated configuration and creates
backups; invalid JSON and symlink configuration files are rejected. Nothing was
written to real agent settings or the user's extension installation during this work.

Use `make preview-agents` for sample sessions and simulated Quick Ask. Preview
setup targets temporary config directories. See [AI_AGENTS.md](AI_AGENTS.md) for
real setup and limits. The default OpenCode adapter uses V1; V2 is experimental.
Forced exits or missed events can leave stale reported states. Live authenticated
provider event sequences and all real terminal launchers remain unverified.

Validation: Node regressions and targeted Agents tests; actual GJS bridge/relay/
client lifecycle, immediate replacement, malformed/oversized input, configuration
preservation, dangling-symlink rejection, generated OpenCode V1 events, and literal
prompt arguments captured by a fake terminal. GTK bindings, full sample preview
and native GNOME smoke passed. Native checks cover pointer submission, focus
retention, hidden view updates, narrow/enlarged text, real window selection and
activation with normal modal-grab release, and disable cleanup. Screenshots were
inspected. Temporary-XDG installation and ZIP integrity/content checks passed.
Both packaging scripts and preview/smoke copy paths include `helpers/agents/`.

The original prototype is committed as a checkpoint. The requested UI redesign
is implemented; real authenticated provider acceptance remains future
work. No real agent configuration or installed extension was modified.

Commute's “Report a map issue” button was removed as requested. Provider credits,
provider selection and Open route remain, with native Commute smoke coverage.

Music state follow-up (2026-11-09): selecting a player, changing tracks and
pausing/resuming now read Position asynchronously with a 2.5-second timeout.
The MPRIS Position cache can remain at discovery time because it does not emit
PropertiesChanged ([specification](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html#Property:Position)).
The existing local clock still supplies progress ticks; no polling was added.
Cancellation and generation guards reject old replies after selection changes,
seeks, Seeked signals or stop. Failed reads preserve the current estimate.
Leaving Music resets Choose player, Sound, Lyrics and Up next to the main
playback view without stealing focus from the newly selected tab.

Validation: 113 Node tests, syntax/schema checks, GTK preference bindings and
native Shell smoke passed. The private D-Bus test uses two players with stale
cached positions to verify switching and resume; actual Telegram playback was
not exercised. Native navigation checks cover all four secondary views, focus
and playback-clock cleanup. Packaging matches the runtime source.

Music spacing follow-up (2026-11-09): reduced vertical padding and row gaps so
the main controls have more room within the same 260px card. Artwork and button
sizes stay unchanged. Native checks use actual cover content and verify no
scrolling at 440px and 380px with normal and 125% text; 150% text still scrolls
when needed to keep every control reachable.

Metrics, Weather and Commute follow-up (2026-11-09): weather loads its rectangular
atlas without the media cover crop/rounded corners. Cropping the eight-column
sheet to a square had shifted frame boundaries and made clouds jump sideways.
The loader still rounds media covers. Native checks assert the atlas is 1536×1152.

Metrics reads now have a 1.5-second cancellation deadline, isolate failures by
source and guard restart generations. Start is idempotent, and stop cancels both
read and sampling timers. IPv6 defaults cover connections without an IPv4
default; CPU totals exclude already-counted guest time. Charts draw a dot for
one valid sample. Memory continues to use MemTotal minus MemAvailable. Repeated
live native samples and System rendering worked on the host; the exact persistent
blank state in the supplied screenshot was not reproduced, so these are verified
reliability fixes rather than a confirmed diagnosis of that session's freeze.

Commute has an in-card ETA provider picker and backup toggle. Source/interval/key
changes retain the reversed route. The default order is Balad, Mapbox, Neshan,
then the other configured sources. Public OSRM is excluded from fallback when
a Mapbox token is available (an explicit OSRM selection still works). Existing
custom priority is preserved. Throttled source changes show an updating state.
Open route independently uses Google Maps (default), Balad or Neshan, selected
in Commute preferences; fixed endpoints work even without an ETA response.
Commute padding moved inside the scrolling content to fix native hit testing
that clipped the reverse/refresh buttons. Navigation and the 260px height remain
fixed. See COMMUTE.md for browser URL source evidence and verification limits.

Validation: Node regressions, syntax/schema checks, real GTK preference bindings,
native GNOME smoke and live metrics sampling. Native checks cover actual provider
selection/reversal clicks, route-app setting changes, narrow/enlarged-text layouts,
weather texture geometry and hidden cleanup. User installation was not changed.
Browser automation was unavailable; Balad/Neshan URL formats were checked against
their current published web clients, without claiming browser or live traffic
validation. The original reference screenshots remain untracked and untouched.

Music refresh (2026-11-08): square rounded artwork, a static cover-derived tint,
round vermilion play/pause, full-width seek timeline, and a compact utility row.
The card remains 260px with navigation outside its scroll view. Normal 440px and
380px layouts fit; enlarged text can scroll. The tint follows background opacity.
Artwork is cropped/rounded and its color sampled once per decoded image, not per
frame; no visualizer or extra repaint timer was added.

The player-name button opens Automatic/pinned selection (including paused apps).
Shuffle/repeat and Raise follow player capabilities. Quick Sound shares the
existing mixer, shows current output and links to Sound. ±10-second controls use
the existing seek operation. Dragging now previews the timestamp immediately;
progress ticks cannot overwrite it, release seeks once, keyboard changes seek
immediately, and a track/player change invalidates an in-progress drag.

Lyrics opens on demand via LRCLIB's anonymous API. Requests use the existing
bounded JSON/Soup transport, with 15-second deadline, cancellation, a 20-record
session cache, identity guard, spacing and Retry-After backoff. Text is rendered
as plain text; timed lyrics use the existing one-second media clock. Closing the
view, switching tabs, collapsing or disabling cancels work. Up next lazily reads
MPRIS TrackList, caps metadata requests at 20 entries, updates from track-list
signals, and disconnects while hidden. It labels player order and the shuffle
limitation; it cannot promise a complete queue. No sleep timer was added.
The playback clock also stops in the player picker, quick Sound and Up next
views; playback and timed lyrics share the existing clock while visible.

Runtime additions: media-tools.js, services/artwork-model.js, services/lyrics.js
and services/lyrics-model.js. Existing root-JS/recursive-services packaging and
preview copies include them. The installer test now checks every service module.
make media-test runs a real private D-Bus player for Identity, Shuffle/LoopStatus,
Raise, SetPosition, track lists, GoTo, signals and hidden cleanup.

Music validation: 98 Node tests, syntax/schema checks, private MPRIS integration,
isolated installer/backup tests and ZIP content checks. Native Shell checks cover
actual pointer drag timestamps, release-only seeking, stale-drag cancellation,
secondary-view controls, focus retention, supported/unsupported actions, 380px
width, 150% text and hidden media timers. Full sample preview passed. A public
LRCLIB record was fetched through the real native Soup adapter; this establishes
endpoint connectivity, not catalog coverage or behavior of real desktop players.

Commute design refresh (2026-11-07): a static coral driving emblem, blue 32pt
ETA, separate estimated-arrival/distance column, and connected blue/coral
endpoint chips replace the flat text layout. Open route is an explicit footer
button; the car and ETA have no click or hover behavior. Provider and map credits
occupy two small lines on the left, with map reporting and the route button on
the right. Refresh stays beside the route name.

Traffic status is an unboxed 8pt line: amber for unverified/baseline estimates,
green only when the provider reports traffic support, and blue while updating.
Freshness stays neutral; errors use larger 9pt warning text. Status and freshness
share one line when they fit and stack for long messages/enlarged text. The full
traffic freshness limitation remains in the accessible name.

Commute shares the other tabs' fixed 260px card height (262px with the surface
border at 100% scale). Normal fixtures fit without scrolling at 440px and 380px.
Enlarged text and long errors use the existing scroll area with navigation fixed.
Empty setup opens Commute preferences; location recovery offers explicit saved
start and system settings actions. Route activation is disabled without an
estimate or during location failures, and updates preserve button focus.
Provider behavior and polling are unchanged. The vector driving emblem is
`assets/commute-driving-symbolic.svg`; existing recursive asset copies in
install.sh, build.sh and previews deliver it.
Visual references: [Maps on Mac](https://support.apple.com/guide/maps/get-directions-mps4d8a6bd2f/3.0/mac/27)
and [CommuteBar](https://www.commute.bar/), adapted to the existing graphite theme.

Commute validation: all 92 Node tests, syntax/schema checks and native GNOME
smoke passed. Native checks/screenshots cover 380px width, 150% text with long
endpoints and the maximum supported duration, loading, stale data, empty setup,
and saved-start recovery, equal tab heights, fixed navigation across tab changes,
and reachable attribution when scrolling enlarged text. Native pointer checks
verify that the car/ETA do not activate routes, that the explicit button works,
and that disabled activation and focus preservation behave correctly.
Screenshots were inspected; ZIP integrity and changed
runtime contents were verified. No installation or live-provider test was done.

Full preview (2026-11-07): `make preview` now enables all six modules and all notch
indicators, starts collapsed, and supplies sample media/artwork, system history,
audio outputs, Bluetooth devices, Weather and Commute. Sample device controls
update fixtures rather than real devices. The new development-only preview-data.js
is explicitly copied by tests/preview.py and is not a production runtime module.
Provider activation is deferred until sample adapters are ready; sample Weather
and connection status work without host internet. Live preview uses actual
Weather/routes/metrics with simulated media/audio/Bluetooth controls. `--tab` opens
any module; existing Weather scene and Commute shortcuts still open their tab.
`make preview-offline` / `make preview-offline-edge` and `--connection` /
`--offline-style` simulate offline states without modifying the host connection.
`--headless --check-full --duration 14` checks the notch, all tabs and sample controls;
`--check-input` still checks native dismissal and reopening separately.

Full-preview validation: Node tests and syntax/schema checks passed. Private
headless preview checks passed for the populated online notch,
both offline styles, all six tabs and simulated device controls. Native pointer
input also passed three dismiss/reopen cycles and a top-bar date-menu click.
Online and offline notch screenshots were inspected. No physical device operations or
installation were performed; this does not verify live-provider behavior.

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
- Automatic routing defaults to experimental Balad, then configured Mapbox and Neshan, before baseline providers
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

Collapsed media titles now offer mutually exclusive fixed/scroll/fit modes in
Notch preferences. Fixed uses a schema-bounded 5–40 grapheme limit (default 12;
code-point fallback on runtimes without Intl.Segmenter), plus pixel ellipsis.
Scroll uses a clipped full-width label and native Clutter translation, with no
JavaScript frame timer; it stops when expanded, unmapped, hidden by the eye
toggle, reduced-motion/global animations off, or destroyed. Fit budgets the title
to 240 logical pixels and subtracts other indicator widths from a notch growth
budget of min(600 logical pixels, 60% of monitor width). Existing indicators can
still impose their own minimum widths. Full text remains in accessibility labels
when the title is shown. `media-title.js` is included in builds.

Title-mode validation: unit/schema/syntax checks, real GTK mode/limit bindings,
packaging, and native Shell smoke passed. Native checks cover character trimming,
fit width growth/cap, full-width scroll geometry and movement, pause while
expanded/hidden, resumption on collapse, and disabled animation cleanup. Fit and
scroll screenshots were inspected; no physical mixed-monitor claim is made.

Runtime packaging (2026-11-07): install.sh and build.sh now copy all root
JavaScript runtime modules. The installer regression test uses a temporary
XDG_DATA_HOME, checks every root module, schema/desktop-file installation, and
backup preservation on reinstall. Runtime-file update requirements are recorded
in AGENTS.md and linked from AGENT.md.

Title review (2026-11-07): replaced recursive implicit scroll animations with one
repeating native keyframe transition, including both end pauses. This fixes the
remap recursion reproduced when hiding/showing the notch. Scrolling still stops
while expanded/hidden, when animations are disabled, and on destruction, without
JavaScript frame timers. Lifecycle tests now cover repeated remaps and cleanup;
the smoke runner rejects JavaScript errors even if its final assertions pass.
All 92 Node tests, syntax/schema checks, real GTK preferences, isolated installer
checks, ZIP contents/integrity and native GNOME smoke passed. The native log had
no recursion or GObject unref errors. Physical monitor/media-device checks remain
outside this validation.
