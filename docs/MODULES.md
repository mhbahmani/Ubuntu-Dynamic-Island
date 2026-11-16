# Optional modules

Current setup, behavior and limitations for Calendar, Agents, Weather and Commute.
See [README](../README.md) for general controls, previews and installation, and
[AGENTS.md](../AGENTS.md) for development rules.

Calendar's module switch applies immediately. After changing the other module
switches, disable and re-enable the extension. Module data and notch indicators
share their services; hidden consumers do not keep refreshing.

## Calendar

Enable **Preferences → Modules → Calendar**. In **Preferences → Calendar**, choose
Jalali (شمسی), Gregorian (میلادی) or Hijri (قمری) as the main calendar. The popup
uses that calendar for its selected-day heading and monthly grid. Optional read-only desktop events use EDS;
[the handoff](HANDOFF.md) lists live acceptance gaps.

Under **Calendar display**, **Show holidays and observances** controls both the
short holiday note and events from recognized Google holiday calendars, including
Holidays in Iran. It defaults on. Turning it off preserves personal events,
calendar selections and nonworking-day colors. Other subscribed calendars can be
hidden individually in **Events**; event titles are never used to guess holidays.

**Event title font size** applies immediately to list titles, from 8 to 14 pt
(default 9 pt). **Use calendar language** defaults on; turn it off for English
weekday/month names, Today, built-in holiday descriptions and Latin date digits
in the tab and notch. Calendar conversion and the start of the week stay the same.
Saved notch numeral choices return when calendar language is enabled again.
Personal event titles and custom literal text keep their original language.

### Desktop events

1. Run `make install` as your desktop user. It installs missing Ubuntu packages
   `gir1.2-ecal-2.0` and `gir1.2-edataserver-1.2` through an administrator
   authentication dialog, then backs up and installs the extension per-user.
   `make install INSTALL_DEPS=0` skips system packages for offline/staging work.
2. Add Google in **Ubuntu Settings → Online Accounts** and enable Calendars.
   Confirm the events appear in GNOME Calendar first; GNOME handles sign-in/sync.
3. Open **Preferences → Calendar → Events**, enable **Show desktop calendar events**,
   and select calendars. Empty selection means none. **Manage accounts** opens
   Online Accounts; it does not change another application's source selections.
4. Select a date. Its full date and events appear in the left panel beside the
   month grid. Compact cards show titles and times, with all-day events preserved.
   Titles stay on one line and ellipsize; each card has the same font-scaled
   height, including days with only one event. Full titles remain accessible.
   The list scrolls independently; activating a card opens that date in GNOME
   Calendar. Each card has a left accent in its source calendar’s color, or the
   selected extension theme’s accent when no usable source color is available.
   A single neutral line beneath a day number indicates available events.
5. Optionally enable **Preferences → Notch → Upcoming event**. Titles default off;
   choose 5/15/30/60 minutes lead time. Ongoing meetings take precedence and show
   only the calendar icon (its label stays in the accessible name). All-day
   events stay in the inline list. Clicking the indicator reveals the relevant row.

Partial/offline data is labeled and never treated as a definitive empty day or
next event. Calendar navigation and the tab bar remain outside scrolling content.
Empty days and unconfigured events show a compact “No events” message beneath the date.
Events are never downloaded by the extension: the reader queries EDS's own local
copy, and GNOME/EDS performs account sync. Hiding both consumers keeps the shown
events and suspends the reader for two minutes; its open EDS views wake it only on
change signals, so reopening within that period needs no new process or query.
After that the reader exits. The last six shown ranges (months and the notch week)
stay in Shell memory, so reopening or revisiting a month shows them at once while a
fresh query replaces them in place, without a loading flash. A first-seen range
still shows the loading state. Turning events off, clearing the selection,
locking the session (which disables the extension) or disabling clears that memory
and stops the helper. Nothing is written to disk; no credentials or provider
account writes are added. The Shell extension never installs packages itself; only the
explicit installer performs that setup.

Local EDS fixtures pass; Google synchronization, authentication recovery and live
Meet metadata still require acceptance. Missing bindings leave date browsing usable.

### Dates and navigation

- Jalali and Hijri use Saturday-first, right-to-left grids; Gregorian uses a
  Monday-first, left-to-right grid. Only the required four, five or six weeks appear.
- Neighboring-month cells are empty and inactive. Today is highlighted only in
  its actual month/year; selecting another date gives it a neutral outline.
- The left heading shows the full selected date and the Today button, labeled
  “امروز”, “Today” or “اليوم” for Jalali, Gregorian or Hijri. The right header
  centers the month/year between the previous/next controls. Additional
  calendar dates are omitted from the popup. Enlarged text can wrap; each panel
  retains reachable overflow while the bottom toolbar stays fixed.
- Arrows move by day/week, Home/End move to the week's edges, Page Up/Down change
  month, and Shift+Page Up/Down changes year. Today returns to the current date.
- Browsing months preserves the selected civil date and its heading. Event data
  outside the fetched month is marked incomplete until that range is available.
- Reopening the island resets the selected day and displayed month to today.
  Switching tabs within an open island preserves the selection.
- Hovering or focusing a day shows the other two calendar dates in a small box,
  following the calendar language preference. It does not select the hovered day.
  The box disappears when the pointer/focus leaves or the Calendar is hidden.

### Holidays

Holiday colors follow the **main calendar**, not the additional displayed dates.

| Main calendar | Highlighted days |
| --- | --- |
| Jalali | Iranian solar/religious holidays and Fridays |
| Hijri | Iranian Islamic holidays and Fridays |
| Gregorian | Saturday/Sunday weekends; no country-specific public holidays |

Named holidays appear in the selected-date header. Jalali year 1405 uses bundled
dates from the [University of Tehran's published calendar](https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf/64228cbb-f4de-dc32-4d2b-57db3c8e322f?t=1761972997587).
Both Jalali and Hijri use those published lunar dates. Outside that year,
lunar holidays use aligned tabular estimates, labeled **محاسبه‌ای**. These are Iranian observances, not a universal holiday list;
local moon-sighting dates may differ.

### Dates in the notch

Enable **Preferences → Notch → Dates in the notch**, independently of the Calendar
tab. Only the main calendar is selected initially. Independent switches let you
select none, one or several calendars and reorder them. Later changes to the main
calendar do not replace this explicit selection.

Expand each calendar's row to choose a preset or **Custom**, edit its format and
select automatic, Persian or Latin numerals. Custom edits have a preview and an
**Apply** button. Move the complete Dates group in **Notch order**.

Jalali and Hijri each offer **Short English month names**, for example Farvardin
→ Far and Muharram → Muh. Turn off **Calendar → Use calendar language** to enable
this option. It applies to named months in that calendar’s notch format; numeric
formats, full-date tooltips and the main Calendar tab keep their existing form.
The choice is remembered if you switch back to the calendar’s native language.

Under **Notch → Time in the notch**, enable **Show time in notch**, choose
**Use 24-hour time** or 12-hour time with AM/PM, and optionally **Show seconds**.
Time has its own position in **Notch order** and uses the desktop’s local time zone.
Dates and minute-only time share GNOME’s clock notifications. The seconds timer
runs only while the clock is visible in the collapsed notch; opening, hiding or
disabling it releases the timer. Only the time label updates each second.

| Code | Output |
| --- | --- |
| `%Y`, `%y` | Full or two-digit year |
| `%MM`, `%mm` | Full or short month name |
| `%M`, `%m` | Padded or unpadded month number |
| `%D`, `%d` | Padded or unpadded day number |
| `%WW`, `%ww`, `%w` | Full, short or one-letter weekday |
| `%%` | Literal percent sign |

For example, `%Y/%M/%D` produces a numeric date; `%ww %d %mm` combines weekday,
day and month. Other text is literal, never executed or interpreted as markup.
Long formats are bounded in the notch; hover over the dates or focus the notch
to read the full text. Separate text actors preserve mixed text direction.

### Implementation and checks

`services/calendar-model.js` uses ICU calendars and UTC civil-day arithmetic for
date-only values, with local time determining Today. `services/iran-hijri.js`
supplies published Iranian month starts for 1405. Outside that year it uses
`islamic-civil`, aligned at the published boundary to keep month browsing
continuous. ICU still supplies localized month names and actual weekdays.
This conversion uses only bundled data, with no requests, polling or dependency.
Persian text uses bundled Vazir, with Vazirmatn/DejaVu Sans fallbacks. `make install`
registers Vazir in an independently owned per-user directory; previews use private
font directories. Latin text uses Noto Sans.

The visible tab owns a midnight timer; notch dates reuse GNOME clock notifications.
Suspend/timezone changes while the tab stays open still need live acceptance;
reopening refreshes the date.

```sh
node --test tests/calendar*.test.mjs
make preview-headless PREVIEW_ARGS="--tab calendar --check-calendar --size 1600x1200 --duration 60"
make preview PREVIEW_ARGS="--tab calendar --card-width 380 --text-scale 1.5"
```

## Agents

An experimental, opt-in local status observer for Claude Code, Codex and OpenCode.
It does not read credentials, transcripts or agent databases, or contact account
APIs. Enable **Preferences → Agents → Enable Agents**, then re-enable the extension.

### Integration setup

In **Preferences → Agents**, press the highlighted **Enable integration…** button
beside **Session tracking**, then confirm **Enable integration**. Configuration
changes are available in a collapsed disclosure. Once installed, the row reports
that state and the action becomes **Reconfigure…**.
Setup merges the Island hook/plugin entries with a backup, preserving unrelated
configuration. **Integration actions** contains Refresh status, Send test event
and Remove integration in separate settings rows.
Invalid JSON and unsupported JSONC are rejected without rewriting the file.
Hooks have readable **Ubuntu Island: …** labels (for example **Approval needed**)
in the supported `statusMessage` field and command comment. The unique Island
marker identifies ownership; a matching display name alone never does. Reconfigure
upgrades older Island hooks without duplicates. Existing user handlers, matchers,
metadata, empty groups and their order are retained; removal touches only marked
Island command handlers. Unchanged setup does not rewrite the file or its backup.
OpenCode uses the named `UbuntuIslandStatus` plugin (`ubuntu-island-status` for V2)
and refuses to overwrite a different plugin at its destination.
See the [Codex hook format](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hook fields](https://code.claude.com/docs/en/hooks#common-fields).

| Provider | Configuration |
| --- | --- |
| Claude Code | `settings.json` hooks |
| Codex | `hooks.json`; review trust through Codex's `/hooks` command |
| OpenCode | `plugins/ubuntu-island-status.js`; V1 adapter by default, V2 experimental |

Opening settings or enabling the extension fills unset CLI executable paths and
provider config directories. Discovery checks PATH and common per-user install
locations; missing CLIs remain unset with a message. It selects an installed
harness initially and uses the home folder as the initial project. Terminal
defaults to **System default**, showing the detected name (for example Terminator).
Launches follow GNOME’s terminal setting or Ubuntu’s `x-terminal-emulator`
alternative, with an installed-terminal fallback when neither is available.
Choose an explicit terminal to override that behavior.
Explicit selections and paths are preserved. Custom paths remain editable.
Detection does not install software, sign in, or change provider configuration. Restart the agent after
setup; existing sessions are not backfilled. **Test event** verifies local IPC,
not compatibility with the installed provider. Real provider sessions still need
acceptance testing after provider upgrades.

### Sessions and Quick Ask

The list shows last-reported states such as Working, Needs approval, Needs input,
Task finished and Error. An empty list is a waiting state, not evidence that an
integration needs setup. Integration controls remain in Agents preferences.
It never automatically focuses a window or expands the notch.
Optional notch counts and notifications default off.

Each row shows its harness icon, state and a short session ID. References use the
last eight ID characters and extend when needed to distinguish matching suffixes
or profiles. They do not depend on the row's position or last activity time.
The heading prefers the provider's explicit session title. For Claude, the broker
also reads the per-session `custom-title.json` associated with the reported
transcript path; it never opens the transcript. The supported layout is
`<CLAUDE_CONFIG_DIR>/projects/<project>/<session>/custom-title.json`, next to
`<session>.jsonl`, with a `customTitle` (or `title`) string. The default profile
root is `~/.claude`. Other layouts fall back to hook titles, then the first useful
project name (OpenCode currently uses that fallback). A later working-directory change cannot rename the row. Missing or
malformed metadata preserves the last known title; an initially unnamed session
keeps its project fallback. Titles are sanitized and limited to 160 characters.

Title reads and directory monitors belong to `helpers/agents/titles.js` in the
existing broker subprocess. Only the visible Agents list needs title monitoring;
notch counts use cached snapshots. Reads are asynchronous, capped at 8 KiB with a
one-second deadline. Exact session-directory/title-file events are coalesced for
60 ms, including atomic replacement and creation of a missing session directory.
There are no periodic scans or refresh timers. Hiding the list, opening Quick Ask,
expiry and disable cancel its reads, sources and monitors; reopening refreshes.
Hidden parents can still supply titles for visible children. Unsupported paths,
symlinks and files not owned by the user are rejected.

**Waiting for Codex**, **Waiting for subagent** and **Waiting for background task**
are distinct from Task finished. A parent's Stop can mean its response paused
while work remains. Native subagent events, ID-only background Bash/task results,
and present `background_tasks` snapshots maintain bounded task sets. Missing
fields do not erase known tasks. Verified active Codex children contribute a
Codex waiting reason only after the parent's own Stop; their existence alone
never changes Working to Waiting. Attention states remain distinct. Multiple
children complete independently, and the final child's completion alone does
not finish its parent: its next own work/Stop event settles that status. Task
and child counts are kept separately because one shell task may host a Codex
session; they are never added together as if known to be independent.

Waiting contributes its own summary/notch count (`◷`), produces no completion
notification and is excluded from Clear finished. Older providers without task
fields or native subagent hooks still use Stop as finished when no outstanding
work is known. Child-context hooks cannot finish or rename the parent. States
remain last reports; opening the list also checks for exited agent processes.

A verified Codex child shows **⤷ From Claude** beside its status. Hover, keyboard
focus and session details expose **Started by <current parent title>**. The relay
requires inherited `CLAUDE_CODE_SESSION_ID`, a Claude ancestor between this Codex
and any outer Codex delegation, and the matching parent session/profile report
with the same PID and process birth token. `CLAUDE_CODE_HOST_SESSION_ID`, shared
projects/windows and title similarity are never used. Missing/ambiguous evidence
leaves the cue absent. Child-first arrival resolves when the parent reports;
hidden/finished parents still update the description. On parent expiry/removal,
the child's last verified attribution remains historical and does not imply an
active parent. Only Claude-to-Codex links are accepted, ruling out cycles and
self-links. These labels do not participate in window matching or activation.

Fixture/native coverage and live-provider acceptance gaps are recorded in
[the handoff](HANDOFF.md#agent-session-metadata-2026-11-13).

Existing Claude integrations need **Reconfigure…** to add the owned
`SubagentStart`/`SubagentStop` hooks. PreToolUse stays limited to input prompts,
so a waiting parent shows Working again when its first resumed tool finishes,
not when it starts. Upgrades/removal remain idempotent and preserve unrelated handlers.
Restart the provider after setup. Hook fields, background result formats, process
names and the title-file layout are version-dependent; no transcript parsing or
process polling is used to compensate for unsupported versions. The inherited
environment variable is observed local behavior, not a guaranteed provider API.
The three-dot menu exposes the full ID in a read-only field: Shift+Tab from Hide
session focuses it, and Ctrl+A/Ctrl+C can select/copy it. Tab returns to Hide;
tabbing out of the menu or pressing Escape restores the anchor's focus.
A row becomes clickable, with a small arrow, only when it has one verified
window target. Process ancestry remains mandatory. Terminator sessions also
report their terminal UUID and D-Bus service; the extension verifies the service
owner's PID and asks that terminal for its owning window's exact current title.
This distinguishes multiple Terminator windows sharing one process. Duplicate
titles within that process, missing metadata and unavailable services remain
ambiguous, with no open action or chooser. Project labels and title substrings
are never used to guess a target.

Terminal metadata is queried asynchronously only while Agents is visible and is
rechecked on click. Hiding the view cancels outstanding lookups; there is no
polling worker. Matching identifies a window, not an exact terminal tab/pane.
Closed windows immediately lose their activation affordance. Existing Codex and
Claude hooks acquire the UUID metadata from the updated relay on their next
status report; reconfigure an existing OpenCode plugin to refresh its generated
metadata fields.

The three-dot button opens a small anchored menu with last activity and **Hide
session**; Escape restores focus to the button. **Clear** and the notch eye toggle
stay in the main header. Hide and Clear finished offer Undo without stopping agent
processes. There are no per-session options pages or separate Recent group.

Finished tasks stay in the list because their session may accept more prompts.
Sessions explicitly reported as closed disappear immediately. This means the
agent reported a session end, not that its desktop window was observed closing.
When the Agents list opens, the existing broker also checks recorded agent PIDs
and birth tokens against `/proc`. A missing, exited or replaced process closes
its records without a completion notification, even if SessionEnd was missed.
These asynchronous reads are bounded to 8 KiB and one second, cancel on hide or
disable, and cannot overwrite newer reports. Live processes remain unchanged;
missing process identity or an inconclusive read preserves the last report.
This check does not infer activity from terminal/window presence and does not
run continuously: an exit after opening is checked on the next opening.
Distinct sessions can share the same project-folder label. Closed records remain
bounded internally for late-event checks and can reappear after fresh activity;
they are not offered by Clear/Undo.

**Preferences → Agents →
Remove inactive sessions after** defaults to **60 minutes** and accepts 1–10,080
minutes. Only opening the Agents tab (including reopening the island on that tab)
checks for expiry. It removes records whose last report is older than the cutoff
from both the cached view and the in-memory broker, including expired Undo entries.
There is no periodic cleanup or process-liveness polling. Fresh activity can bring
an expired session back; the cleanup never stops a process.

Quick Ask starts a selected CLI harness (Claude Code, Codex or OpenCode) in a
project using the system default or an explicit GNOME Terminal, Console, Terminator,
Kitty or WezTerm selection. In the Agents composer,
choose the harness from the gray button inside the prompt box; the dropdown
preserves the draft and returns focus to the entry. The arrow button or Ctrl+Enter
starts a session. Empty project input uses the home folder. Errors retain the draft.
Prompts are passed as literal arguments, never shell templates, and may be visible
to local process inspection. Island keeps drafts in memory only, with no prompt
history or logs. Desktop, web and clipboard-based launches have been removed.

The optional **Quick Ask shortcut** is unset initially. Choose an unused modified
key combination, for example Super+Alt+Space. Enter launches, Escape/outside click
closes while keeping the draft, success clears it and errors retain it. The
shortcut works with tracking disabled, but is inactive on lock, overview, while
preferences are open or when the island is hidden for fullscreen.

### Limits and checks

There are at most 32 session records, including hidden ones. The list scrolls
inside the fixed card; header actions, Quick Ask and tab navigation remain outside
it. Sorting on opening avoids moving rows under the pointer. Working animation
runs only in visible working rows, with reduced
motion disabled. Scrolled-out rows, hidden tabs and the composer stop their
native rotation transitions; no per-frame JavaScript or animation timer is used.

The GJS bridge and relay live in `helpers/agents/`. Private Unix IPC uses a 0700
runtime directory, 0600 socket, peer-UID checks and bounded JSON. It is a same-user
trust boundary, not proof of provider identity. Relays fail quietly if the bridge
is unavailable; they do not restart a disabled extension. Parent shutdown removes
the bridge/socket. No network listener, idle polling or persistent session database
is involved.

States reflect events, not continuous process liveness. Lost hooks can leave stale
rows; hide them or restart tracking. Finished does not establish successful work,
and concurrent same-tool requests without distinct IDs can be indistinguishable.

```sh
make agents-test
node --test tests/agents-metadata.test.mjs
ISLAND_PREVIEW_CHECK_AGENT_METADATA=1 make preview-headless PREVIEW_ARGS="--tab agents --size 1920x1440 --duration 35"
make preview PREVIEW_ARGS="--tab agents"
make preview-headless PREVIEW_ARGS="--check-full --duration 60"
```

## Notifications

Enable it under **Preferences → Notifications** (applies after disabling and
re-enabling the extension). The tab mirrors notifications currently held by GNOME's
message tray, the same set shown under the clock. Sources with notifications
turned off in GNOME Settings are not listed.

- **Layouts** (`notifications-layout`, also toggled from the tab): **Compact list**
  shows two-line rows, newest first, capped at 30, under Today/Earlier headings
  when older items exist. **Grouped by app** stacks each app's notifications in
  one card with a count and a preview of the newest two; selecting it expands
  the group, and All/Today chips filter. Single-notification apps stay plain rows.
- Rows use the application's logo (`source.app` icon, else the source icon), and
  fall back to the notification image only when neither exists.
- Dismiss and the notification's own action buttons appear on hover or keyboard
  focus; the dismiss button takes the age's place, so rows keep their layout.
  Delete or Backspace dismisses the focused row or group. Open and actions
  collapse the island. **Clear** and dismiss destroy notifications as GNOME does.
- Critical notifications are pinned first with an error-coloured edge.
- A dot marks notifications that arrived since the tab was last closed; the toolbar
  shows the count, and **Show unseen count** puts it in the collapsed notch.
  This state is in memory only.
- The Do Not Disturb toggle writes GNOME's `org.gnome.desktop.notifications
  show-banners`, the same switch as GNOME's own. While it is on, the tab icon
  changes and the island counts non-critical notifications that arrived
  (“N silenced”); the count resets when it is turned off. The empty state offers
  the same switch.
- **Show new notifications** peeks the app icon and title for four seconds inside
  the current notch width. It follows each app's banner setting and Do Not
  Disturb; critical notifications peek anyway, as GNOME banners do. No peek is
  shown while the island is open or the session is locked. Opening the island
  during a peek selects Notifications.
- The service only connects to tray signals. It keeps references and plain-text
  copies for the current snapshot, strips body markup and never logs content or
  sends it anywhere. Rows render only while the tab is visible; ages refresh when
  it opens, with no timer.
- Not implemented: replacing GNOME's banners, body preview on peek hover (hover
  already opens the island) and swipe to dismiss.

Check: `make preview-headless PREVIEW_ARGS="--check-notifications --duration 150"`
posts sample notifications in the nested Shell and checks both layouts at
380/440px, 100/200% scale and 1/1.5× text, toolbar overlap, logos, actions,
Delete, sections, grouping, filters, peeks, unseen counts, Do Not Disturb,
silenced counts, critical pinning, clear and service stop. Live third-party app
notifications were not tested.

## Weather

Enable Weather in preferences, choose a city through explicit search or enter
coordinates/timezone, then re-enable the extension. There is no IP-based location
guessing or continuous location tracking. City search accepts English or Persian;
apply the query, then select a result. Units and provider changes apply live.

Open-Meteo is the default, with MET Norway and wttr.in as sequential fallbacks.
The preferred provider is tried first. No API key is required. Saved coordinates
are sent to providers; search queries go to Open-Meteo geocoding. The active source
is displayed and stale values are marked. **Fetched** describes retrieval time,
not the age of a provider's underlying observation. MET Norway lacks precipitation
probability and wttr.in can supply three-hour intervals; missing data is not invented.
Forecast labels use the saved location's timezone.

Motion has Off, Subtle (a short animation) and Live modes. The selected premade
atlas is reused at no more than 12 fps; the notch icon remains static. Motion stops
when hidden/offscreen, under power saving, with reduced motion or on destruction.
See [weather asset provenance](../assets/weather/README.md).

Refresh runs every 20 minutes while the tab or enabled notch indicator is visible,
with one request at a time, finite timeouts and response-size limits. A bounded,
private, atomic cache at `$XDG_CACHE_HOME/ubuntu-island/weather-v1.json` can restore
location-specific stale data after restart. Hidden/disabled consumers do not fetch.

```sh
make preview PREVIEW_ARGS="--tab weather"
make preview-live PREVIEW_ARGS="--tab weather"
make weather-cache-test
```

Both ordinary previews start collapsed unless `--tab` is given. Weather scene
shortcuts open Weather: `preview-sun-day`, `preview-clouds-day`, `preview-rain-day`,
`preview-snow-day`, `preview-night`, `preview-clouds-night`, `preview-rain-night` and
`preview-snow-night`. These demos bypass power saving only inside the isolated
preview; reduced motion is still respected. No physical GPU/battery benchmark or
sustained provider-availability guarantee is implied by preview results.

## Commute

Enable **Preferences → Commute**, then re-enable the extension. Save up to 12
driving routes, optionally named, and choose one in the tab. Fixed endpoints can
be swapped. The notch shows a compact duration, `!` for stale data, `…` while
loading or `—` when unavailable. Baseline estimates have no extra prefix; the tab
identifies the provider and traffic capability.

### Routes and location

The native GTK preferences map supports A/B clicks, draggable pins, explicit
search with Nominatim and manual coordinates. Arrow keys pan, +/− zoom and Enter
places the selected pin at the center. Unnamed routes use Start → Destination.
The dashed connection is a straight line, not a road route.

Google Maps, Balad or Neshan can open the route independently of the ETA provider,
without an API key. Fixed routes work even when ETA is unavailable; a current-location
start requires a fix first. The selected route direction is preserved.

Current location is opt-in and uses GeoClue's OS permission. Each refresh obtains
one fix and stops; fixes worse than 1 km are rejected. Failure offers Location
settings or an explicit **Use saved start** action. Saved coordinates are never
silently substituted. Optional packages are `gir1.2-geoclue-2.0` for location and
`gir1.2-secret-1` for keyring access. The per-user installer places
`assets/ubuntu-island.desktop` in the user's applications directory for GeoClue
identity; manual ZIP users need that desktop entry too.

### Routing providers and keys

Automatic priority is Balad, Mapbox, Neshan, openrouteservice, GraphHopper, FOSSGIS,
then OSRM. A preferred provider is tried first; entries missing required keys are
skipped. Turning off backups uses only the first eligible provider. With a Mapbox
token, automatic fallback avoids public FOSSGIS/OSRM. An explicitly selected
provider is still tried first; custom priority orders the eligible backups.

- Balad uses an unofficial keyless adapter to the web routing endpoint. A working
  response does not establish traffic freshness. The route view shows a warning
  icon with **Live traffic freshness not confirmed** on hover or keyboard focus;
  loading/error messages remain visible. The provider name is simply **Balad**.
- Mapbox uses `driving-traffic` with `depart_at=now`; response metadata determines
  whether the result is traffic-informed or typical. Neshan's keyed route supports
  traffic estimates.
- openrouteservice, GraphHopper and public OSRM routes are baseline estimates.
  The public OSRM/FOSSGIS hosts share infrastructure and are not independent
  outage protection. No provider is promised to match Google Maps.

The footer follows the provider that supplied the displayed estimate, including
fallback or saved estimates. The © symbol credits map data, not the selected
routing engine. OpenStreetMap credit remains alongside provider credit; Balad's
[own map footer](https://balad.ir/) also credits both. The attribution is clickable
for details ([Mapbox](https://docs.mapbox.com/help/dive-deeper/attribution/),
[GraphHopper](https://www.graphhopper.com/attribution/)). The separate preferences
map always uses OpenStreetMap tiles, independently of the ETA provider.

Preferences show key status without reading secrets back into text fields.
**Validate & save** makes a provider request using public Tehran landmarks
(Azadi/Milad), not the private route; it can consume request quota. Failed validation
preserves the old key. Successful keys live only in the desktop keyring, with a
Remove action. Validation cancels on close and never runs just because preferences
opened. Keyed adapters have fixture coverage; real account acceptance is separate.

### Privacy, lifecycle and checks

Route names/coordinates stay in local GSettings; requests send endpoints to the
chosen provider and enabled backups. Map tiles reveal the viewed area; only an
explicit search sends text to Nominatim. No keys or private routes belong in logs.

Refresh defaults to 15 minutes (allowed 10–120), shared by the visible tab and
notch indicator. Reopening reuses fresh data. Requests have a 15-second timeout,
256 KiB bound, spacing between attempts and a five-second manual-refresh throttle.
The in-memory cache is limited to 24 route/direction entries; stale data is explicit.
Map resources and location subscriptions are released when their consumers close.

```sh
make preview PREVIEW_ARGS="--tab commute"
make preview-live PREVIEW_ARGS="--tab commute"
```

The live preview requests the sample Tehran route without changing saved host
routes. [Routing probes](../scripts/commute/README.md) support explicit provider
diagnostics. Real keys, GeoClue permissions, routing accuracy and physical-device
behavior require separate live checks.
