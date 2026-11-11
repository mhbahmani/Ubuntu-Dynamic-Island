# Optional modules

Current setup, behavior and limitations for Calendar, Agents, Weather and Commute.
See [README](../README.md) for general controls, previews and installation, and
[AGENTS.md](../AGENTS.md) for development rules.

Calendar's module switch applies immediately. After changing the other module
switches, disable and re-enable the extension. Module data and notch indicators
share their services; hidden consumers do not keep refreshing.

## Calendar

Enable **Preferences → Modules → Calendar**. In **Preferences → Calendar**, choose
Jalali (شمسی), Gregorian (میلادی) or Hijri (قمری) as the main calendar and optionally
show dates in the other calendars. Account events are not implemented; the
[Google Calendar plan](GOOGLE_CALENDAR_PLAN.md) describes the next feature.

### Dates and navigation

- Jalali and Hijri use Saturday-first, right-to-left grids; Gregorian uses a
  Monday-first, left-to-right grid. Only the required four, five or six weeks appear.
- Neighboring-month cells are empty and inactive. Today is highlighted only in
  its actual month/year; selecting another date gives it a neutral outline.
- Additional dates share one header line with the main date beside the month
  controls. The larger date labels have a little vertical breathing room; a single
  calendar retains its full date heading. Enlarged text can
  wrap; the grid scrolls when needed with navigation and actions still reachable.
- Arrows move by day/week, Home/End move to the week's edges, Page Up/Down change
  month, and Shift+Page Up/Down changes year. Today returns to the current date.
- Browsing months preserves the selected civil date; offscreen selection details
  are hidden until the selection is visible again.

### Holidays

Holiday colors follow the **main calendar**, not the additional displayed dates.

| Main calendar | Highlighted days |
| --- | --- |
| Jalali | Iranian solar/religious holidays and Fridays |
| Hijri | Iranian Islamic holidays and Fridays |
| Gregorian | Saturday/Sunday weekends; no country-specific public holidays |

Named holidays appear in the selected-date header. Jalali year 1405 uses bundled
dates from the [University of Tehran's published calendar](https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf/64228cbb-f4de-dc32-4d2b-57db3c8e322f?t=1761972997587).
Lunar holidays outside that dataset and the Hijri view use calculated dates,
labeled **محاسبه‌ای**. These are Iranian observances, not a universal holiday list;
local moon-sighting dates may differ.

### Dates in the notch

Enable **Preferences → Notch → Dates in the notch**, independently of the Calendar
tab. Only the main calendar is selected initially. Independent switches let you
select none, one or several calendars and reorder them. Later changes to the main
calendar do not replace this explicit selection.

Expand each calendar's row to choose a preset or **Custom**, edit its format and
select automatic, Persian or Latin numerals. Custom edits have a preview and an
**Apply** button. Move the complete Dates group in **Notch order**.

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
date-only values, with local time determining Today. Hijri uses `islamic-civil`.
Persian text prefers installed Vazir, then Vazirmatn, then DejaVu Sans; no font is
installed or bundled. Latin text uses Noto Sans.

The visible tab owns a midnight timer; notch dates reuse GNOME clock notifications.
Suspend/timezone changes while the tab stays open still need live acceptance;
reopening refreshes the date.

```sh
node --test tests/calendar.test.mjs tests/calendar-holidays.test.mjs
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

Each row shows its harness icon and a state label. A row becomes clickable, with
a small arrow, only when its reported process ancestry matches exactly one open
application window. Unknown or ambiguous matches have no open action or window
chooser. A shared terminal server with several windows is ambiguous. Matching
identifies a window, not an exact terminal tab/pane; opening a window still requires
a click. Closed windows immediately lose their activation affordance.

The three-dot button opens a small anchored menu with last activity and **Hide
session**; Escape restores focus to the button. **Clear** and the notch eye toggle
stay in the main header. Hide and Clear finished offer Undo without stopping agent
processes. There are no per-session options pages or separate Recent group.

All sessions, including finished ones, stay in one list. **Preferences → Agents →
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
runs only in the visible connected header and visible working rows, with reduced
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
make preview PREVIEW_ARGS="--tab agents"
make preview-headless PREVIEW_ARGS="--check-full --duration 60"
```

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

- Balad is an experimental, unofficial keyless adapter; traffic freshness is
  unverified.
- Mapbox uses `driving-traffic` with `depart_at=now`; response metadata determines
  whether the result is traffic-informed or typical. Neshan's keyed route supports
  traffic estimates.
- openrouteservice, GraphHopper and public OSRM routes are baseline estimates.
  The public OSRM/FOSSGIS hosts share infrastructure and are not independent
  outage protection. No provider is promised to match Google Maps.

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
