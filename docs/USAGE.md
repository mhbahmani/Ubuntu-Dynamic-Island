# Usage and settings

[Back to the README](../README.md) · [Optional module setup](MODULES.md) · [Development and previews](DEVELOPMENT.md)

Detailed controls, appearance options and notch behavior. For installation, start
with the [README](../README.md#installation-recommended).

Example views: [Media](../screenshots/expanded.png), [System](../screenshots/system.png),
[Sound](../screenshots/sound.png), [Bluetooth](../screenshots/bluetooth.png),
[narrow layout](../screenshots/narrow.png), and [playing notch](../screenshots/playing-pill.png).

## What's included

- **Calendar (prototype, opt-in)**: choose Jalali (شمسی), Gregorian (میلادی), or
  Hijri (قمری) under **Preferences → Calendar → Main calendar**. Additional date
  switches put the selected dates together on one compact line in the header.
  The tab has a clear date heading, grouped month controls, one number per day
  and only the needed week rows. Jalali/Hijri use a Saturday-first RTL grid;
  Gregorian starts on Monday.
  Adjacent-month cells stay empty. Holiday colors follow the main calendar:
  Iranian holidays/Fridays in Jalali, Iranian Islamic dates/Fridays in Hijri,
  and Saturday/Sunday weekends in Gregorian. Selecting a named holiday shows its
  name in the header. Jalali and Hijri dates in Iranian year 1405 follow the
  published calendar; lunar holidays outside that year are marked as estimates.
  Select a day to convert it, browse months, or return to Today.
  Pause over a day for 450 ms to see two small alternate dates; keyboard focus
  shows them immediately. Moving away or closing the tab cancels the popup.
  Arrow keys move through dates; Page Up/Down changes month, Shift+Page Up/Down
  changes year, and Home/End moves to the start/end of the week.
  Enable it in **Preferences → Modules → Calendar**, or open Calendar in `make preview`
  without installing. Hijri follows Iran’s published 1405 calendar (21 March
  2026–20 March 2027), with an aligned tabular estimate outside that range; local
  moon-sighting dates may differ. Read-only desktop events are available through the optional EDS
  integration; see [event setup](MODULES.md#desktop-events).
  **Preferences → Notch → Dates in the notch** shows one or several calendars.
  Only the main calendar is selected initially; use the independent switches to
  choose and reorder Jalali, Gregorian and Hijri. Each has presets, custom Persian
  Calendar format codes, and a Persian/Latin numeral choice. Expand its settings
  row to edit it and see a preview. Move the whole **Dates** group in **Notch order**.
  Long formats shorten to fit; hover over dates or focus the notch to read the full text.
  The Calendar module can remain off.
  Vazir is bundled and installed per-user by `make install`, with a DejaVu Sans fallback.
  See [calendar design and checks](MODULES.md#calendar).
- **Agents (experimental, opt-in)**: local Claude Code/Codex/OpenCode status events,
  attention counts, automatic window matching, optional notifications, and Quick Ask
  for CLI harnesses. No API keys or account access. Tracking needs
  optional local hooks/plugins; executable and configuration paths are detected.
  Harness icons identify sessions; working indicators rotate while visible.
  Rows open a window only when process ancestry identifies one unique target.
  Sessions reported as closed disappear automatically; finished tasks remain
  available for more prompts. A closed session report does not prove its window closed.
  A short session ID beside each status distinguishes sessions in the same
  project. The three-dot menu exposes the full ID as selectable, read-only text.
  Three-dot menus keep Hide and last-activity details in the list, with Undo.
  Finished sessions stay in the same list. **Agents → Remove inactive sessions
  after** defaults to 60 minutes; cleanup runs only when opening the Agents tab.
  A fixed Quick Ask bar keeps the list compact. Drafts survive Back; errors
  preserve the prompt.
  **Clear** in the main header removes finished sessions with Undo; the adjacent
  eye toggles agent status in the notch. The former Agent options page is removed.
  Set **Agents → Quick Ask → Quick Ask shortcut** in preferences to widen the
  notch into a compact text box. Choose an unused combination such as
  **Super+Alt+Space**, type a message, then press **Enter**. **Escape** closes it
  and keeps the draft. The shortcut also works with session tracking disabled.
  It uses your default CLI harness, desktop terminal (including Terminator), and
  project folder (initially your home folder). Explicit terminal choices remain
  available in Agents settings.
  Open Agents in `make preview`; see [setup and limitations](MODULES.md#agents).
- **Notifications (opt-in)**: recent desktop notifications from GNOME's message
  tray as a **compact list** (Today/Earlier) or **grouped by app** (stacked,
  expandable, with All/Today filters); switch in **Preferences → Notifications** or
  from the tab. Rows show the app's own logo, a new-since-last-opened marker,
  and on hover or focus a dismiss button and the notification's actions; Delete
  dismisses. The new count and grouped filters head the list only when present;
  layout, Do Not Disturb and Clear float in the bottom-right corner over a soft
  fade. Critical notifications stay pinned. New notifications can peek in the
  collapsed notch, which can also show an unseen count. GNOME keeps its own banners.
  See [behavior and privacy](MODULES.md#notifications).
- **Single-surface morph**: one chrome-managed surface expands downward around
  its center. Notch content gently contracts inward and fades as the card or
  Quick Ask appears, without reflowing text during the transition. Opening
  eases into place; closing is slightly faster. Rapid reversals remain continuous,
  reduced motion opens/closes instantly, and fullscreen hiding snaps it closed.
  This is the accepted [motion baseline](HANDOFF.md#motion-baseline) for
  future features and animations.
- **Ricelin-inspired faces**: one focused surface at a time, using matte graphite
  surfaces and Ricelin’s vermilion accent. Media opens as a compact
  horizontal artwork-and-controls face. A quiet navigation strip switches to
  system, sound, and Bluetooth faces; close and preferences remain available.
  Background opacity (default 98%, 0–100%) sets the tint; matte tone sets a
  real frosted-glass blur of the desktop behind the expanded card.
- **Keyboard navigation**: Super+Alt+I opens/closes the island; Super+Alt+Page Down
  and Super+Alt+Page Up cycle available tabs. These defaults avoid GNOME's
  workspace-switching shortcuts. Ctrl+Tab and Ctrl+Shift+Tab also work
  while open. Customize or disable global bindings under **Appearance → Keyboard
  shortcuts**. Tabs share the regular 248px height; Notifications and Agents
  grow with their content up to **Appearance → Maximum expanded height**
  (default 400px), then scroll. The tab bar heads the card and never moves;
  tabs spread into spare width when only a few modules are enabled.
- Click toggles; **Escape and outside clicks close** via the same modal-grab
  pattern GNOME's own popup menus use (outside presses release input
  immediately so apps receive the next click); optional hover open/close and
  auto-hide (a notch style).
- **Media**: event-driven MPRIS discovery with playing-player priority, play/pause/skip,
  progress bar with seek (`SetPosition`, only when `CanSeek`), local
  `file://` artwork and **remote HTTPS artwork** through a bounded
  (2 MiB, MIME allowlist, host-validated, DNS-checked, disk-cached) loader.
  **Idle/stopped players and empty registrations are hidden**; paused tracks
  remain controllable. Seeking uses GNOME's native keyboard-accessible slider,
  with the displayed timestamp following the thumb while dragging.
  The square cover supplies a subtle static tint; a full-width timeline and round
  play control fit the regular 248px surface. The player-name
  menu selects Automatic or pins a running player, including a paused player.
  Shuffle/repeat and Open player appear when supported; ±10-second seek buttons
  are available for seekable tracks. The speaker button provides system volume,
  mute, current output and a shortcut to Sound (when that module is enabled).
  Lyrics and Up next open inside the card, with navigation fixed above them.
- **System**: CPU and RAM percentages plus RX/TX rate for the lowest-metric
  default-route interface (VPN tunnels win), read asynchronously from procfs.
  IPv6 defaults are used when no IPv4 default exists; failed reads leave gaps
  only in the affected metrics and have a bounded timeout.
  CPU and memory have fixed 0–100% history charts. Download and upload share
  a mirrored chart (download above, upload below), with an automatic shared scale.
- **Audio**: GNOME's shared Gvc mixer, volume slider, mute, and **output
  device selection through `change_output(Gvc.MixerUIDevice)`** (port/profile
  aware), seeded from existing sinks and updated through Gvc output signals.
  Recognized Bluetooth headphone outputs are grouped under one device with
  **Music** (high-quality playback, headphone mic off) and **Calls · mic**
  (headphone mic available, lower playback quality). Only available, identified
  modes are shown. Using another microphone lets you keep Music mode; merging
  the controls does not remove the Bluetooth profile trade-off.
  Outputs are ordered by headphones (Bluetooth or AUX), built-in speakers,
  HDMI/DisplayPort, then other devices. Switching outputs keeps that order.
  Bluetooth headphones show a small battery icon and percentage beside their
  name when BlueZ reports a battery level. Device addresses match the audio
  output to its battery; missing or disconnected batteries stay hidden.
  This works even with the Bluetooth tab disabled and adds no battery indicator
  to the notch or polling timer.
- **Bluetooth**: event-driven BlueZ state (`GetManagedObjects` snapshot +
  `InterfacesAdded/Removed` + per-interface `PropertiesChanged`), paired
  devices with connect/disconnect, Battery1 percentage, adapter power toggle;
  pairing stays in GNOME Settings. Operations show pending states and inline
  failures. Audio and Bluetooth rows are retained across updates to preserve
  focus. A scroll container keeps controls reachable on short displays.
- **Weather (v11, opt-in)**: current conditions, feels-like temperature, humidity,
  wind, and the next four forecast entries. Open-Meteo, MET Norway and wttr.in automatically
  fall back to each other; choose one as the preferred source. City selection,
  manual coordinates, Celsius/Fahrenheit, refresh, and a bounded offline cache.
  Fetches while the Weather tab or its enabled notch indicator is visible, at most every 20 minutes automatically.
  Bundled Meteocons animations sit behind the temperature and horizontal forecast,
  with optional Off/Subtle/Live motion and automatic power-saver/reduced-motion support.
  See [weather setup, sources, and limitations](MODULES.md#weather).
- **Commute (opt-in)**: saved driving routes with map-selected endpoints, optional
  current location, ETA/distance/arrival, and provider fallback. Refresh defaults
  to 15 minutes (minimum 10), only while visible. Public routing works without a
  key; optional Mapbox, openrouteservice, GraphHopper and Neshan keys add alternatives.
  See [Commute setup and provider limitations](MODULES.md#commute).
  Choose the ETA source directly in the tab; reversing keeps the preference.
  Automatic defaults to Balad, then Mapbox when configured, with public OSRM as
  a last resort only without a Mapbox token. **Preferences → Commute → Open route in**
  independently chooses Google Maps, Balad or Neshan for driving directions.
- **Preferences** (`prefs.js` + GSettings): eleven live themes (Graphite, Ocean, Forest, Ember, Lagoon, Amethyst,
  Berry, Midnight, Aurora, Sunset, Mocha),
  background opacity (0–100%, default 98%) for the tint layer only, matte tone
  (0–100%, default 60%) for frosted-glass blur strength without changing transparency,
  a Notch order preview that uses smaller icons when labels would overflow,
  widths, animation duration,
  reduced animation, hover behavior, metrics interval, module toggles,
  remote-art toggle, clock relocation.
- Full `disable()` cleanup of timers, signal handlers, D-Bus subscriptions,
  cancellables, and chrome actors; the panel clock is restored.

In **Settings → Appearance → Open on expand**, keep **Last used tab** (default)
or choose Media, System, Sound, Bluetooth, Weather, or Commute. A fixed choice
applies each time you open the island, including hover-open. You can switch tabs
normally while it stays open. If the chosen tab is unavailable (for example, its
module is disabled or Media has no player), the island keeps the last available
tab. Preference changes take effect on the next opening.

Music's **Lyrics** button looks up the current title/artist (plus album and
length when available) on [LRCLIB](https://lrclib.net/docs). It shows timed lines
when supplied, or plain lyrics, with a full-text view. Lookup starts only while
that view is open; results stay in a bounded memory cache for the extension's
session. Closing the view cancels requests. No account or API key is needed.
Missing metadata, instrumental tracks, unavailable lyrics and connection failures
have explicit states. Lyrics availability depends on the provider's catalog.

**Up next** uses the player's optional
[MPRIS TrackList](https://specifications.freedesktop.org/mpris/latest/Track_List_Interface.html).
It displays at most 20 shared entries after the current track and can jump to one.
This is the player's reported list, which may be incomplete or differ from shuffle
order. Players that do not expose it show an explanation. Player pins last for
this extension session and return to Automatic when the chosen player disappears
or stops being eligible.

## Desktop calendar events

Read-only account calendars, event markers, split-view daily events and an optional upcoming
notch indicator are implemented through GNOME Online Accounts/EDS. Start with
[event setup](MODULES.md#desktop-events). Live Google synchronization remains
unverified; the [handoff](HANDOFF.md) distinguishes native fixture coverage
from the remaining live acceptance checks.

## Notch indicators

Weather and System have eye buttons to show a static weather icon and compact
upload/download rates in the collapsed notch. Both default off and require their
modules to be enabled. Network rates use B/K/M/G units per second (K/M/G are
binary units) and reuse existing samples. Weather refreshes at the normal
interval while its indicator is visible. Stale weather is dimmed and described
as stale to assistive technology. No animation runs in the collapsed notch.

When the system reports a lost connection, the notch combines Weather, Network,
and Commute into one small amber connection symbol, without a text label or badge
background. It follows the first enabled indicator's position. Music, CPU, and
Bluetooth remain visible; normal indicators return when connectivity recovers.
Screen readers still distinguish Offline, limited internet, and network sign-in.
Detection uses the system connection monitor without extra polling or requests.

In **Settings → Notch → When offline**, choose:

- **Connection icon** (default): a disconnected Wi-Fi symbol, or a Wi-Fi question
  mark when network sign-in is required.
- **Broken edge**: a small unplugged symbol with a split amber underline at the
  bottom of the collapsed notch. The underline disappears while opening the card.
- **Hide unavailable indicators**: remove missing or stale weather/commute values
  and unavailable network rates, keeping fresh cached values and valid local rates.

Changes apply immediately. Previous **Offline badge** preferences migrate to
**Connection icon**. Expanded tabs retain cached data and recovery controls.

## Preferences tabs

Preferences are grouped into Appearance, Notch, Modules, Weather, Commute, Agents, Notifications and Calendar tabs, with
search across settings. The Notch tab controls the music name, weather icon and
upload/download rates independently; changes apply immediately. Drag items in the
Notch order preview to arrange Music, Weather, Network, CPU, Bluetooth, Commute,
Agents, Dates, Upcoming event and Time.
Select an item and use the move buttons for keyboard reordering. Hidden items
keep their place.

**Notch → Collapsed notch** also sets:

- **Notch style**: *Floating island* (theme colors), *Blend with top bar*,
  which takes the top bar's own color (read from the running Shell theme) and
  height while collapsed, so the notch reads as part of the bar (the opened card
  keeps the theme; the bar color fades out as it opens and back in as it docks),
  or *Auto-hide* (below). Blend and auto-hide are exclusive.
- **Text size** (80–150%): notch labels and icons scale together; the notch grows
  taller only when the text needs it. Rate slots re-measure for the new size.
- **Hide CPU dot while load is low**: the colored dot appears at the threshold
  (default 50%) and hides again 5 points below it, so it does not flicker.

**Auto-hide** keeps the collapsed island above the screen edge, separate from the
top bar. Rest the pointer at the top edge
above it for the reveal delay (default 350 ms) to slide it down; sweeping along the
edge restarts the wait, so passing movements do nothing. Click it, or hover it
with **Open on hover**, to open. Clicking the edge reveals and opens at once; the
keyboard shortcut and notification peeks reveal it too. It hides again 700 ms after
the pointer leaves.

**Notch → Time in the notch** adds a local clock with 24-hour or 12-hour AM/PM
format and optional seconds. Its timer stops whenever the clock is hidden.
In each Jalali/Hijri date row, **Short English month names** abbreviates months
when **Calendar → Use calendar language** is off.

The collapsed width is a minimum: the notch grows to fit enabled groups, with
red download arrows and green upload arrows. Each rate keeps a fixed slot exactly
as wide as the widest four-character rate, measured in the current font and
scale; only the notch's regular item spacing separates it from its neighbours.
**Rates layout** shows them side by side or stacked (download above upload in
smaller text, narrower; the notch grows taller if the lines need it). Rates promote units before rounding to 1000
(for example, `999K` → `1.0M`), so traffic never changes the notch width.
The compact display caps at `999G`; its accessible description retains the full rate.
Weather uses the regular 248px expanded height, retaining its
background artwork, four-hour forecast and current conditions.

At the top of **Settings → Notch**, **Indicator style** offers **Network arrow shape**
and **Weather icon style**. Choose thin arrows (↑↓) or chevrons. Type a **Chevron angle** from **40° to 120°**
(default 80°); smaller angles produce sharper tips. The numeric control applies
to chevrons, while thin arrows retain their stem.
All use red for download and green for upload, softened slightly from full saturation. Choose Colorful or
Minimal outline weather icons independently. The colorful partly-cloudy icon has
a larger exposed sun; clouds share one size across day/night/rain/snow icons. Weather keeps its single footer settings
button. The route editor uses a native GTK map to avoid WebKit sandbox crashes.

Enable **Settings → Notch → Show Commute ETA** to see the selected driving route
while collapsed. Drag its Commute chip to choose its position. Refresh uses the
same 15-minute default (minimum 10), only while that indicator or the tab is visible.
A `!` marks a stale result. Provider and traffic details stay in the Commute tab;
see [routing providers and keys](MODULES.md#routing-providers-and-keys).

Under **Settings → Notch → Music name**, select one title behavior: **Character
limit · trim** (default), **Scroll overflowing title**, or **Fit width to title**.
Trim mode has a 5–40 character limit (default 12). Short titles use their measured
width instead of reserving the whole limit; the configured notch width remains a
minimum. Narrow space or large fonts may still require additional ellipsis.
Scrolling moves the complete title back
and forth with a pause at each end, only while the collapsed title is visible
and animations are enabled. Fit mode grows the notch for the title, up to a
240 logical-pixel title budget and a monitor-aware growth budget (60% of monitor
width, capped at 600 logical pixels including indicators); longer text ellipsizes.
All modes preserve the music-name hide toggle and expose the full visible title
to screen readers. Changes apply immediately.
