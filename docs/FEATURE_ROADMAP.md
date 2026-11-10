# Ubuntu Island feature roadmap

Status (2026-11-02): Weather and Commute are implemented. See
[WEATHER.md](WEATHER.md), [COMMUTE.md](COMMUTE.md), and [HANDOFF.md](HANDOFF.md)
for current behavior. Calendar appointments and Task Progress remain proposals.

A local [Jalali/Gregorian/Hijri date-browser prototype](CALENDAR.md) was added on
2026-11-10. It is separate from the appointment/account integration proposed below.

The user-approved Google Calendar direction now has a concrete
[implementation plan](GOOGLE_CALENDAR_PLAN.md) for a future session (2026-11-10).
Use that plan's scope, defaults and phases in preference to section 3 below.
Implementation and live account validation are still pending.

[AI agent sessions](AI_AGENTS.md) records the 2026-11-09 experimental prototype,
test instructions and research for local status, session navigation and Quick Ask.
The opt-in prototype implements the explicit-producer approach described below;
its live provider compatibility remains to be established.

Next Agents iteration: redesign the interface, improve setup and Quick Ask UX,
and exercise real provider sessions, terminal launches and window navigation.
The current implementation is a prototype checkpoint, not the final UI.

This document retains design ideas for future work. Existing user-requested
behavior takes precedence: the notch supports multiple ordered indicators, and
Commute refresh defaults to 15 minutes with a 10-minute minimum while visible.
Performance budgets are targets, not measured claims. Verify provider terms and
GNOME compatibility when implementing any remaining proposal.

## Proposed product direction

The island should help with things happening now or soon. Prefer actionable,
contextual information over duplicates of GNOME quick settings. Preserve native
St/Clutter rendering, predictable navigation, keyboard access, live preferences,
and the existing media-title privacy toggle.

New modules are opt-in. Keep the footer to at most five visible destinations:
user-pinned modules plus a More button for the remainder. Active tasks and imminent
appointments can appear as small badges; never switch the expanded page while the
user is interacting with it. Hidden or disabled modules must not create actors,
network requests, or background loops unnecessarily.

An earlier proposal limited the collapsed notch to one chosen activity, with a small count if others needed
attention. The implemented notch instead supports user-ordered indicators. For
future contextual alerts, a suggested priority is: a user-pinned activity, then an imminent appointment
or commute reminder, then an active task, then media. Weather appears there only
if explicitly pinned or configured for a relevant alert. Manual selection always
wins. Do not interrupt typing or automatically open the island.

## Shared implementation foundation

Keep data providers separate from views. Proposed services expose immutable snapshots
with `status`, `updatedAt`, `stale`, data, and an optional actionable error. Statuses
include unconfigured, loading, ready, offline, authentication-required, and unavailable.
Views retain existing content while refreshing; they do not replace useful data
with a spinner or silently present stale information as current.

Add feature-specific modules under `services/` and split new page builders into
small view modules rather than extending `card.js` indefinitely. Extract existing
navigation only as needed for the new pages. Keep existing tests and packaging
working during each step.

Use asynchronous Gio/Soup calls, cancellables, finite timeouts, response-size caps,
and request-generation tokens. Cancel on disable and ignore superseded results.
One request per provider at a time; coalesce simultaneous consumers. Never perform
synchronous network work or launch polling subprocesses in GNOME Shell.

Use settings for preferences, not secrets. Store tokens/provider keys in the desktop
secret store if an integration requires them. Never bundle a shared API credential.
Use a schema-versioned, bounded cache with atomic asynchronous writes. Persist only
what the feature needs: weather forecasts may be cached; private appointments and
precise commute endpoints need more conservative defaults and a Clear data action.

### Initial performance budgets

| Module | Update policy | Bounded data/rendering |
|---|---|---|
| Weather | Fetch on first use; refresh after 20 minutes while viewed/pinned | One location, current conditions and 24 hourly entries; response cap 256 KiB |
| Commute | Refresh every 15 minutes while visible (configurable, minimum 10); explicit Refresh | Selected route; native map only in preferences; bounded responses |
| Appointment | Subscribe to local calendar changes; deadline-driven UI updates | Next 7 days, at most 200 occurrences; show next event plus three upcoming |
| Tasks | Producer events; coalesce visible updates to at most once per second | At most 32 active tasks and 20 recent completions |
| Weather motion | Static when hidden, locked, fullscreen-hidden, or motion-reduced | Live mode at most 12 fps, one selected 48-frame atlas (~6.75 MiB decoded) |

No continuous animation in the closed notch. Disabled modules have no timers or
subscriptions. Background fetching is off by default unless a user enables a
scheduled reminder or pins a module. Use retry backoff with jitter, stop automatic
requests on authentication/quota errors, and do not request repeatedly while offline.
After resume, perform one freshness check instead of replaying missed timer ticks.

Benchmark each phase against the same extension build without that feature, using
idle/closed, open/static, and active states on the user's laptop. Record CPU time,
wakeups, memory after repeated open/close cycles, frame timing, and network counts.
Treat unexplained idle wakeups, hidden repaints, or growing actor/subscription counts
as release blockers. Numeric CPU or battery guarantees require those measurements.

## 1. Weather

### UX

First use: select a city, confirm the matching place, choose Celsius/Fahrenheit,
and optionally pin weather to the notch. Manual location is the default; do not
request ongoing geolocation for a stationary laptop.

Example, with illustrative values:

```text
Tehran                                      Updated 8 min ago
18°   Light rain                             Feels like 16°

Now       15:00       16:00       17:00
18°       17°         17°         16°
60% rain  70%         40%         20%

Wind 12 km/h                         Refresh · Forecast
```

The temperature and condition are primary. The hourly row answers “do I need a
jacket or umbrella soon?” Use small icons plus words, not color alone. Show stale
age and a retry action when offline. Weather codes do not justify minute-precise
“rain starts in 7 minutes” promises when only hourly forecast data is available.

Condition-based themes apply only inside Weather: warm daylight for sun, cool
slate for rain, soft muted layers for cloud, dark blue for night. Maintain text
contrast and respect the user's background-opacity setting.

Motion modes:

- Off: static illustration.
- Subtle (recommended default): a short entry transition, then static.
- Live: a small rain/cloud/sun scene while this page is visible, within the budget
  above. Pause completely when hidden; default to static on battery saver and
  with reduced motion. No video, webview, CAVA, shader blur, or continuous backdrop.

### Integration and delivery

Open-Meteo is the initial candidate: its forecast API exposes temperature,
apparent temperature, precipitation probability, weather codes, and wind.
Use provider attribution and review usage terms before distributing the integration.
Its free endpoint is for non-commercial use; commercial distribution/use may need
an appropriate plan. [Forecast documentation](https://open-meteo.com/en/docs),
[pricing and terms summary](https://open-meteo.com/en/pricing).

1. Implement the normalized weather model, bounded fetch/cache, and fixtures.
2. Build static current/hourly UI and all error states.
3. Add condition palettes without affecting other pages.
4. Add optional motion only after profiling the static version.

Acceptance: location ambiguity, timezone/day boundary, units, missing fields,
unknown weather code, offline cache, cancelled request, location change during a
fetch, and zero animation callbacks after hiding. Verify no hidden background
fetches unless explicitly configured.

## 2. Commute

### UX

Configure two named places (Home and Work are editable defaults). Search and confirm
each address/coordinate; show enough detail to distinguish similarly named places.
Preview the route before saving. No continuous GPS tracking is required.

```text
Home → Work                                       ⇄
32 min                              Arrive at 09:12
+8 min traffic                         Updated 2 min ago

Leave now                 Refresh                 Open route
```

The swap button reverses direction without changing the saved locations. Present
one primary route; optionally reveal an alternative in a secondary row. Keep the
map in the user's mapping application/browser instead of embedding a map engine
inside Shell. “Open route” must use the displayed direction and explicit user action.

Optional schedule: weekdays, arrival target, and preparation buffer. During the
chosen departure window, show an advisory “Leave by 08:35”; the notch can display
“Work · 32 min”. Outside that window, do not poll. Allow dismissal for the day.
This is an estimate, not a guarantee. Do not derive future departure-time traffic
from a current-traffic result unless the provider supports that request.

Always label freshness. A result that has lost live traffic must say “Traffic
unavailable” or “Typical travel time”; never silently substitute it for a live ETA.
Saved-location names can be hidden in the notch for privacy.

### Provider decision gate

Before implementation, confirm the user's city/country, travel directions, desired
mapping app, and willingness to supply a provider key. Validate real route quality
and traffic coverage for both directions. Do not assume global traffic coverage or
scrape a consumer maps website.

Google Routes is a candidate, not a settled choice: it distinguishes traffic-aware
from traffic-unaware durations, and traffic-aware use has billing implications.
Check coverage, attribution, permitted caching, and quota controls for the chosen
provider before implementing persistence or background refresh.
[Traffic modes](https://developers.google.com/maps/documentation/routes/config_trade_offs-rm),
[usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing).

Deliver a small `RouteProvider` interface so a locally suitable provider can be
substituted. Fetch a narrow set of fields: duration, baseline duration where
supported, distance, route label, and provider timestamp. Keep directional caches
separate and avoid storing a detailed route geometry unless the UI needs it.

Acceptance: asymmetric directions, no route, unsupported traffic, quota exceeded,
offline/stale result, invalid credential, daylight-saving/timezone changes,
manual direction switch during refresh, and bounded requests within/outside the
scheduled window. No route notifications before explicit reminder opt-in.

## 3. Next Appointment and Google Calendar

### UX

First use offers “Use desktop calendars”, a calendar selector, and privacy controls.
If no calendar is available, offer to open GNOME Online Accounts. Do not force a
second Google sign-in when the desktop already has a working calendar account.

```text
NEXT · in 12 min
Design review
14:00–14:30                            Work calendar

Join meeting                 Open calendar
Then: Project check-in · 15:00
```

The notch shows a countdown near the event. “Hide event titles” changes it to
“Meeting in 12 min”; expanded details remain available on deliberate opening.
Join appears only when a supported conference URL exists. Validate links and open
them through the desktop URI handler; never execute event text as a command.

Show ongoing meetings separately from the next event. Treat all-day events as a
secondary row, skip cancelled/declined occurrences, handle recurring exceptions,
and show overlapping meetings without silently choosing one as definitive. A
travel-address event is not automatically a Commute endpoint; that integration
would need an explicit user action.

### Preferred integration

Start with GNOME Online Accounts plus Evolution Data Server (EDS). GNOME's account
setup links online calendars to desktop applications; EDS offers calendar clients
and change-driven views. This avoids adding a second token-refresh/network-sync
loop in the extension. It is a feasibility direction, not a claim that the exact
GNOME 46 binding has already been verified.
[GNOME account setup](https://help.gnome.org/gnome-help/accounts-add.html),
[EDS calendar client API](https://gnome.pages.gitlab.gnome.org/evolution-data-server/libecal/class.Client.html).

Spike first: verify available ECal/ESource typelibs and asynchronous APIs on the
target installation; connect to a selected Google-backed calendar, receive add/
modify/remove changes, and release everything on disable. Keep optional imports
lazy so absent calendar packages do not disable the entire extension. Account
permissions remain managed by GNOME; the island itself should only read events.

Direct Google Calendar OAuth is a fallback phase if the desktop path is inadequate.
Use browser-based desktop OAuth and read-only event/calendar-list permissions.
Keep tokens in the secret store and authorization handling outside Shell's render
path. Do not embed a client secret or use password entry in the island.
[Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

For a direct adapter, start with bounded upcoming-event queries and pagination.
Do not combine a moving `timeMin`/`timeMax` window with a sync token: the API restricts
those combinations. If full incremental sync is later justified, implement it as
a separate strategy with token invalidation/full-resync handling.
[Events list constraints](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).

Acceptance: no account, revoked credentials, disabled calendar, recurrence exception,
all-day event, overlapping meetings, cancelled/declined events, remote timezone,
clock adjustment, suspend/resume, malformed meeting link, hidden-title mode, and
cleanup with an in-flight calendar request. Do not duplicate GNOME's reminders by
default; show an island countdown without adding another notification stream.

## 4. Task Progress

### UX

An activity page exists only while tasks are active or recently completed.

```text
2 tasks running
Build project                   Running · 1m 24s
Download archive                64% · 18 MB/s

Show details                                 Dismiss completed
```

Determinate tasks show a bar and real percentage. Unknown work totals show a quiet
“Running” state, not fake progress. Show Cancel only when the producer supports it.
Completed tasks offer a producer-provided Open result action. Errors offer details
and Retry only when meaningful. Do not assume every download or file copy can be
observed globally.

### MVP integration: explicit local producers

Define an optional session-bus interface, for example
`org.gnome.Shell.Extensions.UbuntuIsland.Tasks1`, with versioned methods to register,
update, and finish a task. This is a proposed project protocol, not an existing
GNOME standard. Bind each task to its D-Bus sender; another producer cannot update
or cancel it. Remove/mark interrupted tasks when that sender disappears.

A small `island-task run --label "Build project" -- COMMAND...` helper can wrap a
user-invoked process. It runs outside GNOME Shell, publishes lifecycle events,
and reports exit status. Arbitrary commands provide indeterminate progress unless
they explicitly publish totals. Preserve argument boundaries; do not evaluate a
command string supplied by an external task record.

Keep identifiers, labels, progress, action capabilities, result URI, and timestamps
bounded. Clamp numeric progress; reject oversized/invalid messages; coalesce UI
updates and discard stale sequence numbers. Cancellation is routed to the owning
producer, never inferred by scanning/killing matching processes. Tasks are memory-only
by default; do not log command arguments or private result paths automatically.

Later adapters may cover specific download clients, build tools, or transfer apps.
Evaluate each application's documented API separately. Do not take over GNOME's
notification bus or introduce process-table polling as a shortcut.

Acceptance: many tasks within/over the cap, updates faster than display rate,
producer crash, task-ID collision across producers, invalid progress, late completion,
cancel race, unsupported actions, result-URI validation, and disable/re-enable while
a helper is running. Establish producer reconnection semantics explicitly.

## Delivery sequence and checkpoints

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 | Provider/view lifecycle, optional navigation, cache/error conventions | Existing media and hardware behavior preserved; no new idle loops |
| 1 | Static Weather and optional condition palette | Offline/error coverage and request-count budget verified |
| 2 | Desktop-calendar feasibility spike, then Next Appointment | A real Google-backed calendar works through GNOME, with cleanup and recurrence checks |
| 3 | Commute provider evaluation, then two-place UX | User confirms coverage/credentials; both directional estimates validated |
| 4 | Task protocol and command wrapper | One real task producer plus adversarial/lifecycle tests |
| 5 | Optional weather motion and cross-feature polish | Hidden redraw count stays zero; frame/CPU measurements meet agreed budget |

Provider/account spikes can happen early, but do not build dependent UI around
an unverified integration. Ship each feature behind its own toggle and in focused
commits. Keep source/package/install tests and GNOME visual checks mandatory.

### Decisions needed before each relevant phase

- Weather: city, units, and preferred motion mode; recommendation is manual city,
  Celsius, and Subtle motion.
- Calendar: whether Google is already configured in GNOME Online Accounts, which
  calendars to include, and whether titles may appear in the notch.
- Commute: two locations, city/country, mapping app/provider, arrival schedule,
  and provider-key/billing preference. Do not store real addresses in this document.
- Tasks: first useful producer (terminal builds, a particular download client,
  or a transfer application); recommendation is explicit terminal task wrapping.

## Future considerations and sources

These are candidates, not commitments or a claim of drop-in GNOME compatibility.
Quickshell projects target other compositor stacks; borrow interaction ideas,
not their polling/subprocess architecture wholesale.

| Candidate | Useful island behavior | Priority / reason to defer | Source or inspiration |
|---|---|---|---|
| Focus timer and breaks | Countdown, pause, extend, break prompt | High after core four; cheap and useful while collapsed | [Quickshell Dynamic Island time tools](https://github.com/lunanoir21/quickshell-dynamic-island) |
| Recording/microphone/camera activity | Contextual duration and supported stop/mute actions | Medium; verify detection and control APIs rather than inferring capabilities | [Quickshell Dynamic Island privacy indicators](https://github.com/lunanoir21/quickshell-dynamic-island) |
| Per-app volume | Silence one noisy application without changing master volume | Medium; useful extension of existing audio service | [Quickshell Dynamic Island mixer](https://github.com/lunanoir21/quickshell-dynamic-island) |
| Optional lyrics and player queue | Lyrics fetched once per track; queue only when the player supports it | Medium; cache misses and avoid pretending all players have queues | [Quickshell Dynamic Island media features](https://github.com/lunanoir21/quickshell-dynamic-island) |
| Contextual battery/device alerts | A short peek on a meaningful change, not another persistent battery tab | Medium; only if it adds an action beyond GNOME's existing indicator | [Kuroshima contextual peeks](https://github.com/HaziqLucii/kuroshima) |
| Notification actions | Temporarily show actionable notifications without a full inbox | Low; avoid duplicate surfaces and do not claim the notifications service name | [Kuroshima integration caveats](https://github.com/HaziqLucii/kuroshima) |
| Air quality and UV | Optional extra row in Weather | Medium after Weather; useful without a separate tab | [Open-Meteo air-quality API](https://open-meteo.com/en/docs/air-quality-api) |
| Leave-for-meeting reminder | Combine one selected appointment location with a verified route provider | Later; needs explicit location confirmation, consent, and fresh traffic | Original synthesis of the Appointment and Commute plans above |
| Presentation/privacy mode | Hide titles/addresses and suppress nonessential peeks temporarily | Medium; extends the existing title toggle without extra polling | Original proposal for this project |
| Reorder/pin modules and keyboard shortcuts | Keep frequent actions reachable as features grow | Foundation work, not a separate data tab | [Ricelin's compact module composition](https://github.com/Gakuseei/Ricelin) |
| Audio visualizer | Animated spectrum around media | Low; continuous audio capture/process/rendering conflicts with the performance priority | [Quickshell Dynamic Island spectrum](https://github.com/lunanoir21/quickshell-dynamic-island) |

The researched projects demonstrate the interactions above; their performance,
security, and backend compatibility have not been independently audited here.
