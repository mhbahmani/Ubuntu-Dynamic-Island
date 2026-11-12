# Google Calendar implementation plan

Status: the read-only EDS integration, account/calendar preferences, inline daily
events and upcoming-event notch are implemented (2026-11-11). Native fixtures
pass against EDS 3.52.3. Live Google account acceptance remains unverified.

Connect Google Calendar through GNOME Online Accounts and Evolution Data Server
(EDS). The extension does not implement OAuth or write events. Its optional
bindings and explicitly selected calendars are required before events can appear.

## Implementation record — 2026-11-11

Environment: GNOME Shell 46.0, GJS 1.80.2, EDS 3.52.3-0ubuntu1.2 and GNOME Calendar
46.1. The host lacks `gir1.2-ecal-2.0` and `gir1.2-edataserver-1.2` (with their ICal
and Camel dependencies). Ubuntu packages were downloaded and extracted under
`/tmp` for testing via `GI_TYPELIB_PATH`; no system packages/accounts were changed.
`gjs -m scripts/calendar-probe.mjs` reports availability without reading accounts.
The correct object namespace is **ICalGLib 3.0**, not the low-level ICal namespace.

Implemented boundaries:

- `services/calendar-events-model.js` owns bounded plain-text normalization,
  composite identity, cancellation/decline filtering, local-day overlap, merged
  query ranges, next-event selection and narrow structured Meet validation.
- `helpers/calendar/` owns optional GI imports, asynchronous registry/client/view
  and timezone queries, recurrence expansion, and change subscriptions. No EDS
  imports enter Shell. No OAuth, provider HTTP, event writes or persistent event
  cache is added. Read results may come from EDS's existing cache.
- `services/calendar-events.js` owns a bounded newline protocol, generations,
  coalesced writes, a 20-second outstanding-request deadline, and owned-child
  shutdown with a 500ms force-exit fallback. Idle subscriptions do not time out.
  Hidden/disabled/locked consumers clear data and release the helper/clock.
- Preferences discover event sources grouped by account; stable source UIDs are
  selected explicitly. Removed/disabled sources never imply selecting all.
- The existing Calendar contains event dots and a selected-day event list below
  the month grid, sharing its scroll area. Rows retain identity across updates
  and open the selected date in GNOME Calendar. There is no separate summary
  footer or agenda/detail page; no event section appears without selected sources.
- The optional notch uses the selected sources, hides titles by default, suppresses
  definitive next-event claims for partial/offline data, reuses GNOME's clock and
  schedules one next boundary. Activation reveals the relevant inline event. Lock/hide
  releases event state. All-day events remain in the inline list.

EDS 3.52's asynchronous `Client.generate_instances` has no completion callback in
GJS: it cannot establish a completed empty range. The reader instead awaits an
asynchronous view/query and complete series retrieval, resolves timezones
asynchronously, then calls **pure** `ECal.recur_generate_instances_sync` in the
helper with an already-loaded timezone map. No synchronous EDS/network call is
used. Expansion is capped at 500 occurrences; the parent deadline bounds native
pathological expansion. THISANDFUTURE overrides are omitted as incomplete rather
than displaying obsolete instances. Series/query result counts and wire sizes
are bounded; EDS itself allocates its native query response before JS can inspect
it, which remains an upstream memory-budget limitation.

The native fixture suite uses a private session bus and temporary XDG directories.
It verifies catalog discovery, local source connection, RRULE/EXDATE, moved and
cancelled exceptions, declined attendees, floating Tehran time, all-day and timed
missing ends, DST recurrence, truncation, additions/modifications/removals, proven
empty coverage, and cleanup. A registry disposal crash found under GDB was fixed
by releasing EDS registries while the JS context is still alive. Protocol tests
cover UTF-8 chunk boundaries, malformed/oversize input, stale generations,
repeated activation and teardown. Pure model tests cover Tehran, New York DST and
Apia's skipped day.

`make check` passes 171 tests when the optional test typelibs are available;
without them the EDS integration case skips explicitly. GTK preferences, native
Calendar checks at 380/440px and 100/200%, enlarged-text reachability, event
navigation and hidden cleanup, and `make smoke` pass. Preview calendars are
fixtures even with `--live`; host events never enter screenshots.

Open-calendar intentionally targets the selected **date**, not an unverified
exact-event identifier. [GNOME Calendar 46's implementation](https://raw.githubusercontent.com/GNOME/gnome-calendar/gnome-46/src/gui/gcal-application.c)
uses EDS's translated date parser, so the launcher uses that domain's four-digit
year format. The installed EDS parser was checked with this format. Actual live
Google event opening, Meet field delivery, authentication recovery, offline cache
freshness, removal/disable of a Google account and suspend/timezone transitions
still need live acceptance. No claim of completed Google synchronization is made
from local fixtures alone.

UI revision requested after the implementation: show selected-day events directly
below the month grid in the same scroll area. Remove the separate summary/setup
button and agenda/detail pages. Clicking a row opens GNOME Calendar on that date;
the notch reveals the matching inline row. A richer details/Join interface is
deferred. The earlier phase/UI descriptions below are historical design context;
this current user instruction takes precedence.

`make install` now checks the two Ubuntu binding packages and installs only missing
packages via `pkexec apt-get --assume-yes --no-remove install …`. Package failure or
cancelled authentication aborts before replacing the user's extension. Automated
installer tests use stub commands or `INSTALL_DEPS=0`; they never install system
packages. Live phase 1/6 acceptance gaps remain as listed above.

## Follow-up — 2026-11-12

The host now has both Ubuntu binding packages installed. The dependency probe
loads ECal 2.0, EDataServer 1.2 and ICalGLib 3.0 successfully. This confirms runtime
availability; Google accounts/events have not been inspected for live acceptance.
Current UI is the inline event list described above, with the former empty
summary/setup footer removed.

## Scope and defaults

The first version includes calendar selection, event markers, a selected-day
agenda, upcoming/ongoing events in the notch, Google Meet links, and opening the
desktop calendar for editing. Account authorization and synchronization remain
owned by GNOME. Google is the required live acceptance case; the reader can also
list other EDS calendars without promising untested provider compatibility.

Event creation, edits, deletion, RSVP, new reminder notifications, direct Google
OAuth, and automatic commute changes are outside this version. Existing GNOME
reminders continue independently. Read-only describes our code's behavior; it does
not reduce the permissions already granted to GNOME Online Accounts.

Implementation defaults below are decisions for the first version, not additional
user requirements. They can be adjusted if native testing reveals a concrete issue.

| Preference | Proposed key and default | Behavior |
| --- | --- | --- |
| Show desktop calendar events | `calendar-events-enabled`: false | Master event integration toggle; existing date browsing stays independent |
| Selected calendars | `calendar-event-sources`: empty string array | Explicit EDS source UIDs; empty means no selection, never all calendars |
| Show upcoming event in notch | `pill-show-event`: false | Independent of the Dates indicator and Calendar tab visibility |
| Show event title in notch | `pill-event-show-title`: false | Default text is `Event in 12 min`; details appear on deliberate opening |
| Show before event | `calendar-event-lead-minutes`: 15 | Offer 5, 15, 30 and 60 minutes in preferences |

Use `event` as the new notch-order item, with the label **Upcoming event**. Append
it through the existing order normalization without changing saved item order.
Do not change the existing calendar/date format settings or add another main tab.

## Confirmed starting point

The current extension already has Jalali, Gregorian and calculated Hijri grids,
holiday rules, keyboard navigation, configurable notch dates and Persian font
fallbacks. [The module guide](MODULES.md#calendar) describes those behaviors. The
date model uses UTC civil-day numbers for date-only arithmetic; that representation
is not a UTC timestamp for a local appointment.

### Verify the target environment first

Check the installed GNOME 46/EDS stack and available GJS bindings during phase 1;
do not rely on a previous session's package snapshot. Initial optional packages to
investigate are `gir1.2-ecal-2.0` and `gir1.2-edataserver-1.2`, including the ICal
namespace supplied by their dependencies. Require Goa bindings only if the probe
shows they are needed; EDS source metadata and desktop account settings may suffice.

No packages or accounts have been changed for this implementation. Live Google access and
recurrence callbacks remain unverified. Online EDS references may
describe a newer release; confirm exact signatures and callback behavior against
the installed stack before implementing the adapter.

## User experience

### Setup in Calendar preferences

Add an **Events** group alongside the existing display choices. Explain that
events come from desktop calendars, then offer the master switch, a list of
calendar switches grouped by account, and **Manage accounts**. Launch Ubuntu's
Online Accounts panel through its supported desktop command. Sign-in remains in
GNOME's account flow; no password entry or OAuth webview belongs in the extension.

List only event calendars, not address books, task lists or memo lists. Use stable
source UIDs for selection and names/account labels only for display. Do not change
which calendars GNOME Calendar itself selects or enables. Removed sources stop
contributing immediately; do not silently select a replacement with the same name.

Distinguish missing dependencies, no calendars, nothing selected, loading, ready,
partially available, disconnected and authentication-required states. Keep setup
details in preferences. The tab needs only a compact status and relevant action.
An unavailable provider must not break the date grid or other extension modules.

### Month and agenda inside the existing card

- Preserve the current compact month header, weekday layout, blank neighboring
  cells, Today highlight, holiday colors and date selection behavior.
- Mark dates with events using a small neutral dot within the existing cell.
  Announce the event count in its accessible name. A marker means appointments;
  it must not change holiday coloring or look like an underline through the number.
- Selecting a date updates one compact summary row: for example,
  `2 events · 14:00 Design review`. Activating it opens that day's agenda inside
  the same card, replacing the grid. This extra step keeps a full agenda from
  making every month view taller. Show `No events` only after that range has loaded.
- Add at most one compact row to the normal month layout, aiming for roughly
  32 logical pixels of extra height. Confirm actual native measurements instead
  of shrinking fonts to reach that target. Days with no data or no connection
  must not be presented as confirmed empty days.
- The agenda has Back, the selected date, and an **Open calendar** action outside
  its scrolling content. List all-day entries separately, then timed occurrences
  in chronological order. A common day with up to three entries should fit;
  long lists and enlarged text remain scrollable and fully reachable.
- Event details replace the agenda within the card. Show the full wrapped title,
  local date/time, calendar name and optional location, with **Join** and
  **Open calendar** when supported. Long content scrolls, with primary actions
  outside it. Do not introduce an event editor or a large description preview.
- Back restores the previous date, month, scroll position and focused control.
  Escape traverses these internal views before dismissing the island. Updates
  retain row actors/focus and never navigate automatically; a removed open event
  gets an explicit unavailable state with its actions disabled.

Keep the graphite design, existing controls, Noto Sans and Vazir/Vazirmatn fallback.
Use separate directional text runs for Persian dates, event titles and times.
Screen-reader announcements must include dates, times and event counts without
repeating every minute or relying on color or hover.

### Upcoming event in the notch

Show a timed event from the configured lead window until its end. All-day entries
stay in the agenda. Use minute precision such as `Event in 12 min`, `Event now`,
or, when titles are enabled, `Design review · in 12 min`. Hide the group when there
is no eligible occurrence. An empty indicator must still monitor the upcoming
window while its enabled collapsed-notch consumer is visible.

Prefer ongoing events, then the earliest future start. If multiple events are
ongoing, show `2 events now` and open the agenda to let the user choose. For
simultaneous upcoming events, show the count rather than silently choosing one.
Use stable ID ordering for otherwise identical list positions. Ended events are
removed immediately. Zero-duration events remain in the day agenda and may appear
before their start, but do not become indefinitely ongoing.

Activating the indicator opens the Calendar agenda focused on the relevant date
and occurrence. If the Calendar module is disabled, open the desktop calendar
instead. Keep normal notch clicks and media controls working; test pointer event
propagation and keyboard access. No automatic expansion, page switching or joining.

Use a shared measured width budget for media, dates and the event label. The
current date/media budgets were written before another variable-length group
existed: simply appending a label can exceed the monitor width. Preserve all
essential icons and make full event details reachable by activation. With titles
hidden, do not expose them in collapsed accessible names or tooltips either.

## Architecture and data contract

Use one optional GJS helper process for EDS access and recurrence processing,
outside GNOME Shell. The Shell service receives bounded, normalized snapshots.
This follows the existing subprocess lifecycle pattern in `services/agents.js`,
but needs no public socket or new always-running daemon. Prefer asynchronous EDS
operations even in the helper so cancellation and parent shutdown stay responsive.
Use independent EDS clients, not Shell's private date-menu event source, so our
month navigation and source selection do not change GNOME's calendar view.

```text
Google account → GNOME Online Accounts / EDS
                              ↓
                 optional calendar helper
                              ↓ private pipes
                  CalendarEventsService
                     ↙                ↘
             Calendar and agenda    Notch event
```

The helper imports ECal/EDataServer/ICal only after an explicit event consumer
requests them and reports missing dependencies as structured status. Shell entry
points must not statically import these optional namespaces. Preferences can run
a short-lived catalog-only helper for source selection; it must not fetch events
or depend on the extension being enabled. Close it when the preferences page/window
no longer needs it. Keep fixture mode independent of host accounts and packages.

Use versioned newline-delimited JSON over private stdin/stdout. Parent requests
contain a generation/request ID, selected source UIDs, local timezone and requested
ranges. Responses contain that same generation, per-source status and complete
snapshots for explicitly identified ranges. Reserve stdout for protocol data;
sanitize diagnostics and never log titles, attendees, locations, URLs or tokens.
Read/write asynchronously; bound line size, queued output and all input fields.
Coalesce to the newest snapshot when the consumer is slow. EOF from the parent
must cancel work, stop views and exit; process exit must not trigger a crash loop.

Proposed source record: `uid`, display name, account label, color, enabled/available
state. Proposed occurrence record:

| Field | Meaning |
| --- | --- |
| `sourceUid`, `uid`, `recurrenceId` | Stable composite identity; include source because UIDs can collide across calendars |
| `title`, `location` | Bounded plain text; render no provider-supplied markup |
| `allDay` | Determines date-only versus timed interpretation |
| `startMs`, `endMs`, `timezone` | Timed instants plus timezone metadata |
| `startDate`, `endDateExclusive` | Gregorian date-only boundaries for all-day entries |
| `status`, `selfResponse` | Cancellation and response filtering; unknown is distinct from declined |
| `joinUri`, `openTarget` | Optional validated actions; never synthesized from unverified ID assumptions |

Snapshots need `status`, `generation`, requested range coverage, `receivedAt`,
per-source errors and an `incomplete` flag. `receivedAt` means the local EDS data
was read, not that Google just synchronized. Never label a local read as a fresh
server sync. Keep event data in memory only; use EDS's existing cache for offline
availability. Clear private data on disabling the feature or removing its source.

### Ranges, recurrence and dates

Maintain two bounded consumer ranges: the upcoming seven local days for the notch,
and the displayed month for the calendar/agenda. Query the displayed month
independently, even if it is years away; never query every day between it and today.
Coalesce overlapping ranges and subscribe only to selected sources.

Use EDS/libical recurrence expansion, not a new RRULE parser. A calendar view's
components are not automatically a fully expanded agenda. The spike must prove
series expansion, detached/moved instances, EXDATE, cancelled occurrences and
deletion semantics. On relevant source/view changes, debounce and recompute the
affected bounded range; replace its snapshot atomically. Cancel superseded month
queries and discard late callbacks using generation guards.

Timed events belong to every local day they overlap, using half-open intervals.
Compute query boundaries from local midnights; do not assume every day is 86,400
seconds. Respect TZID, UTC and floating times using EDS/calendar timezone rules.
All-day dates retain their date-only meaning, with an exclusive end; do not shift
them through UTC. Convert the resulting local Gregorian date to the existing
civil-day representation, then reuse Jalali/Gregorian/Hijri formatting.

Exclude cancelled occurrences and events explicitly declined by the current user.
Do not drop events merely because attendee identity or participation is unknown.
Recompute local grouping and ranges after timezone changes, clock changes and
resume. Changing the displayed calendar system must not modify event instants,
recurrence rules, timezone or the selected civil date.

Start with caps of 500 normalized occurrences across active ranges and 2 MiB per
snapshot, with bounded strings, source enumeration and recurrence work. These are
resource limits to test, not measured performance guarantees. Truncation or partial
source failure must be visible as incomplete coverage; do not imply exact counts,
an empty day, or a definitive next event from incomplete results. Provide an
**Open calendar** escape path for data beyond the in-island limit.

### Visibility and cleanup

The Shell event reader runs only when events are enabled, sources are selected,
and either the Calendar event UI is visible or the event indicator is enabled on
the visible collapsed notch. The latter remains a consumer even before an event
enters its lead window. Stop the helper, requests and subscriptions when neither
consumer remains, including fullscreen hiding and lock. Refresh on reactivation;
do not reconnect on every metrics or media render.

Use EDS change notifications instead of remote polling. Reuse GNOME's existing
clock notifications for minute labels and time changes. At most one rescheduled
deadline timer may handle an event start/end or lead-window boundary between clock
ticks. No per-second animation or hidden countdown loop. Clock and deadline hooks
are removed with the last consumer. Resume performs one current-state refresh.

Use cancellables, finite deadlines for initialization and explicit operations,
scoped signal ownership and generation guards throughout. A healthy subscription
may remain quiet indefinitely; do not treat an idle pipe as a failed request.
Give helper shutdown a bounded grace period, then terminate only that owned
subprocess if it fails to exit. Repeated enable/disable, failed initialization,
helper crashes and shutdown during recurrence expansion must release everything.
Do not stop or reconfigure desktop EDS services or GNOME's own calendar widgets.

### Open and join actions

Initially recognize Google Meet HTTPS links with an exact `meet.google.com` host,
no embedded credentials and bounded length. Prefer structured event fields; allow
plain-text extraction only after testing the actual Google-to-EDS representation.
Do not treat an arbitrary event URL or location as a meeting. Expand the supported
provider list later with provider-specific tests. Validate again at activation and
launch through Gio's desktop URI handler on a user action only.

Verify the installed `gnome-calendar --uuid` identifier format and support for
recurring occurrences before using it. Its help output alone does not establish
the format. If exact-event opening is unavailable, use the tested `--date` format
and label the action **Open calendar**, without claiming it opens the exact event.
Use argument arrays, never a shell command string. Missing applications or launch
failures get a local error. Verify the existing preferences/window-grab lifecycle
also releases the island's grab before opening an external calendar or meeting.

## Implementation phases

### 1. Verify the desktop integration

- Read `AGENTS.md`, `docs/HANDOFF.md` and this plan; check worktree state.
- Add a development probe under `scripts/`, not the root. Verify optional imports,
  source discovery, asynchronous ECal connection, view changes, recurrence
  callbacks and cancellation against the installed EDS stack. Probe output should
  use counts/status, not private event content.
- Confirm required optional packages and document setup. Follow the repository's
  no-sudo rule; do not install system packages or change accounts automatically.
- With a user-connected Google account and an existing test event, prove reads,
  modification/removal propagation, cache/offline behavior, Meet extraction and
  external opening. Ask the user to create/change the test event; the probe stays
  read-only. Verify callback thread safety and completion signaling in GJS.
- Record evidence and unresolved gaps in this plan. If live access is unavailable,
  continue pure-model/fixture work, but leave live acceptance explicitly pending.
  Do not silently switch to direct OAuth or claim mocked results prove syncing.

Exit: a verified adapter approach on GNOME 46, or a precise dependency/account
gap with fixture work able to proceed independently.

### 2. Build the event model and optional reader

- Implement pure normalization, date grouping, ordering, eligibility and link
  validation in `services/calendar-events-model.js`.
- Implement the helper under `helpers/calendar/` and a lifecycle-owning
  `services/calendar-events.js`. Reuse the Agents subprocess pattern, keeping the
  two services independent. Avoid refactoring unrelated agent code.
- Add fixture-backed protocol, model and lifecycle tests, plus native EDS probes.
- Prove disabled/missing-dependency behavior before wiring the main UI.

Exit: deterministic snapshots, correct recurring/date boundaries and bounded,
cancellable lifecycle; no EDS dependency during ordinary date browsing.

### 3. Add setup and source selection

- Add the proposed schema keys and Events preferences, with status, calendar
  selection and Manage accounts. Put notch options on the existing Notch page.
- Keep account/source discovery asynchronous; preserve focus and switch state
  when sources arrive or change. Catalog helper failures must not close preferences.
- Test bidirectional settings updates, empty/removed sources, unavailable packages
  and reopening preferences with the extension disabled.

Exit: the user can enable the feature and select calendars without touching other
desktop calendar preferences or disrupting unrelated preferences pages.

### 4. Add compact markers, agenda and details

- Extend `CalendarView` with event snapshots and range-change callbacks. Put agenda
  and detail actor management in `ui/calendar-agenda.js`; keep calendar arithmetic in
  the existing date model.
- Wire requests through `ui/card.js` and `extension.js`, including page changes,
  `select`/`moveMonth`, settings, mapping and cleanup. Extend Card's Escape/Back
  handling and preferred-height calculation for the internal views.
- Add sample events to the full preview: Persian/English titles, multiple sources,
  recurring exceptions, all-day, overlapping, empty and unavailable states.
- Extend `--check-calendar`; keep the existing preview command set. Never read
  host calendar events in default previews or screenshots. `--live` currently
  means weather/routes/system metrics and must not silently expose calendar data.

Exit: a reviewable native UI at narrow/default widths, with common views fitting
and all overflow reachable; existing date/holiday behavior remains correct.

### 5. Add the notch indicator and actions

- Add event-order normalization, preferences preview and a bounded event label in
  `ui/pill.js` (extract a renderer only if needed). Connect its activation to the
  existing card/open-calendar flow and validated Join action.
- Wire event consumption to collapsed visibility, upcoming windows and clock
  changes. Ensure a far-future event becomes visible without reopening the card.
- Test title privacy, simultaneous meetings, transition through start/end,
  timezone/resume, long mixed-language labels and coexistence with all indicators.

Exit: the notch is useful while collapsed, fits the monitor and creates no hidden
polling, unintended navigation or privacy leak.

### 6. Verify integration and package the feature

- Run the acceptance checks below and record actual results in `docs/HANDOFF.md`.
- Update `README.md` and `docs/MODULES.md` to distinguish shipped features,
  required dependencies, verified providers and remaining limitations.
- Runtime directories (`ui/`, `preferences/`, `services/`, `helpers/`, `assets/`)
  are copied by installation, build and preview scripts. Keep new runtime files
  there or update every copy path explicitly. The syntax and installer/ZIP tests
  recurse through these directories; verify the new helper in all outputs.
- Use a temporary `XDG_DATA_HOME` for installation checks and inspect ZIP contents.
  Do not replace the user's installed extension for testing.

Exit: fixture/native/package checks pass and the live Google result is documented.
If live acceptance remains blocked, deliver an explicitly labeled prototype with
that gap, not a claim of completed Google synchronization.

## Acceptance checklist

| Area | Required cases |
| --- | --- |
| Date regressions | All three calendars, holiday colors, actual Today only, blank neighboring cells, custom notch date codes/order/numerals, Persian fonts |
| Event semantics | Timezones, DST forward/backward days, midnight boundaries, exclusive all-day end, multi-day overlap, floating time, missing end, zero duration, cancelled/declined versus unknown response |
| Recurrence | Series, EXDATE, detached/moved occurrence, deleted instance/series, cross-source UID collision, late results after month/source changes |
| Setup and errors | Missing typelibs, no account, no selection, expired authorization, offline cached data, partial sources, removed source, empty versus loading, helper failure, resource limits |
| Layout and input | 380/440px, actual 100/200% UI scale, 150/200% text, RTL/mixed titles, long agenda/details, keyboard-only use, focus restoration, accessible counts, reduced motion |
| Notch | Dates + event + all other groups, long labels, hidden titles including accessibility/tooltip, lead/start/end boundaries, overlapping meetings, Calendar module disabled |
| Lifecycle | No consumer → no helper/timer/views; pinned-but-empty notch remains subscribed; repeated enable/disable, lock/unlock, fullscreen hiding, resume, timezone change, shutdown with in-flight work |
| Actions | Valid/invalid Meet links, no credentials/unsafe schemes, removed event, missing calendar app, date fallback, modal-grab release, no actions without user activation |
| Privacy and packaging | Fixtures never read host accounts, no event/token logs or new disk cache, helper and optional dependency failure covered in installed copy and ZIP |

Use the existing command surface:

```sh
make check
make prefs-test
make preview-headless PREVIEW_ARGS="--tab calendar --check-calendar --size 1600x1000 --duration 60"
make preview PREVIEW_ARGS="--tab calendar --card-width 380 --text-scale 1.5"
make preview PREVIEW_ARGS="--tab calendar --card-width 380 --scale 1 --text-scale 2"
make smoke
node --test tests/install.test.mjs
make build
```

Adjust the calendar check duration if new assertions need it. GUI checks need a
working display/Xauthority. The native probe and live-account checks are additional
to these commands; Node tests cannot establish GJS/EDS or Google compatibility.

## Primary references

- [GNOME Online Accounts supported services](https://gnome.pages.gitlab.gnome.org/gnome-online-accounts/services.html)
  lists Google calendar support. [GNOME account setup](https://help.gnome.org/gnome-help/accounts-add.html)
  describes desktop authorization and service selection.
- [EDS SourceRegistry](https://gnome.pages.gitlab.gnome.org/evolution-data-server/libedataserver/class.SourceRegistry.html)
  provides asynchronous discovery and source-change notifications.
- [ECal get_view](https://gnome.pages.gitlab.gnome.org/evolution-data-server/libecal/method.Client.get_view.html)
  and [ClientView](https://gnome.pages.gitlab.gnome.org/evolution-data-server/libecal/class.ClientView.html)
  document asynchronous queries and added/modified/removed signals.
- [ECal generate_instances](https://gnome.pages.gitlab.gnome.org/evolution-data-server/libecal/method.Client.generate_instances.html)
  documents asynchronous occurrence generation. Verify its binding behavior and
  exception handling on the installed version during phase 1.
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
  is background for the deferred direct-API option, not an extra login requirement
  for this implementation.

## Continue implementation

> Implement the Google Calendar feature described in docs/GOOGLE_CALENDAR_PLAN.md.
> Read AGENTS.md and docs/HANDOFF.md first. Start with the GNOME 46/EDS
> integration probe and the implementation record above. Finish the native EDS
> adapter spike and phase 2 reader, then preserve the existing compact
> Jalali/Gregorian/Hijri UI. Use fixtures without host account access for previews.
> Keep the integration read-only and opt-in, record any live-account dependency,
> and continue independent work if live validation needs my involvement.
