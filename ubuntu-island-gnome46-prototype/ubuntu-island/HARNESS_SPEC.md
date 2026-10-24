# Ubuntu Island: coding-harness implementation specification

## Mission

Implement and ship a stable, attractive, GNOME-native Dynamic Island for Ubuntu 24.04-class GNOME Shell **46.0**, **Wayland**, with **music + artwork**, **CPU/RAM/network monitoring**, and **Bluetooth/audio device controls**. The included source is the initial prototype; treat missing features and correctness gaps as implementation tasks, not as already solved.

### Known environment

- `XDG_CURRENT_DESKTOP=ubuntu:GNOME`
- `gnome-shell --version` = `GNOME Shell 46.0`
- `XDG_SESSION_TYPE=wayland`
- Target GNOME Shell extension runtime is **GJS ES modules** with `resource:///org/gnome/shell/...` imports.
- Do not build Electron, browser UI, X11-specific transparent windows, GTK 4 windows, or rely on a generic `gtk-layer-shell` overlay in GNOME Wayland.

### Hard constraints

- Keep GNOME Shell responsive. No blocking network, subprocess loops, file transfers, HTTP images, or large file reads in the Shell process.
- Preserve standard GNOME quick settings, overview, and notifications/calendar controls. Restore anything modified when disabled, including failure paths.
- Never overwrite global keybindings, monkey-patch GNOME internals without a justified backup/restore procedure, or alter filesystem/service configs.
- No `sudo` and no autostart background daemon for the baseline extension. Keep privileges at user scope and use ordinary D-Bus APIs.
- Maintain `disable()` cleanup: all GLib timers, signal connections, cancellables, actors, and async callbacks.
- Document APIs that are private or unstable, specifically `Main.panel._centerBox`, `_rightBox`. Avoid private APIs where feasible, and test conflicts with other extensions.
- Do not claim features are complete before runtime tests demonstrate them on GNOME 46/Wayland.

## UX specification

### Visual design

- Compact notch centered at **top of primary monitor**, approximately 150–210px wide and 30–36px tall.
- Dark background near `#101018`, rounded lower corners, thin low-contrast border, no unnecessary shadow covering apps.
- Expanded width around **400–460px**, dynamic height capped to fit the work area, rounded 18–22px corners.
- High-contrast readable controls, accessible names, title clipping/ellipsis for long tracks and devices.
- 60 Hz animation target: ~180–260ms ease-out for opening and closing, ideally morphing one surface instead of a disjoint panel popup.
- Reduced-motion preference should disable animated transforms and use immediate transitions.
- The UI must not display over fullscreen or lock screen; workspaces and normal apps should stay interactive.
- Zero accidental extra window focus changes or taskbar icons.

### Interaction state machine

`COLLAPSED` -> `EXPANDING` -> `EXPANDED` -> `COLLAPSING` -> `COLLAPSED`.

- Click pill toggles open/closed.
- Escape closes.
- Outside click closes without swallowing subsequent clicks unnecessarily.
- Optional hover-to-open after 180ms and hover-to-close grace period after 350ms, but only after click-open works reliably.
- Repeated rapid clicks must not corrupt width/height or leave an unclickable pane.
- No automatic expansion for routine CPU/RAM changes. Important later notifications should have cooldown and priority.

### Compact view

- Left: media status icon and truncated title when playing, default icon otherwise.
- Right: Bluetooth connection indicator; optionally CPU status dot.
- Tooltip/accessibility label should describe the action (open/close).

### Expanded view

Top: media artwork (64–72px), track title and artist, previous/play-pause/next, progress bar and time (progress is a second-phase feature).

Middle: cards for CPU%, RAM%, network receive/transmit. Update every 2s without relayout flicker.

Bottom: volume slider, mute toggle, current audio device + list of selectable audio outputs, paired Bluetooth devices + their connected state, connect/disconnect button, optional battery when BlueZ Battery1 is present, and a button to open GNOME Bluetooth Settings for pairing.

If there is no player, no adapter, no sound server, or no default network route: show a useful empty state, never throw or show `undefined`.

## Data and architecture

```
GNOME Shell 46 (GJS)
  extension.js: lifecycle + StatusArea/PanelMenu + St/Clutter UI
       |     |       |       |
       |     |       |       +- BluetoothService -> BlueZ system D-Bus
       |     |       +---------- AudioService -> Volume.getMixerControl() / Gvc
       |     +------------------ SystemMonitor -> /proc/stat, meminfo, route, net/dev
       +------------------------ MediaService -> MPRIS session D-Bus

Model events -> isolated UI updates. Avoid UI code inside low-level services.
```

- Music: discover `org.mpris.MediaPlayer2.*` names, cache proxies for `org.mpris.MediaPlayer2.Player`, monitor `g-properties-changed` and handle player disappearance. Select the currently playing player, fall back to last selected, then first. Respect `CanControl`, `CanGoNext`, `CanGoPrevious`. Never assume a browser exposes MPRIS.
- Artwork: accept safe `file://` URIs from MPRIS. Implement HTTP(S) art in a **bounded, asynchronous, cached helper** (2 MiB max, image MIME allowlist, short timeout, no credentials, limit redirects, deny localhost/private IP ranges if remote requests are allowed, no SVG active content). Avoid arbitrary network retrieval from the GNOME Shell main thread. Fallback icon always available. Cache eviction and cancellation on track change/disabling.
- CPU: get aggregate `/proc/stat` totals + idle and compute deltas (do not use cumulative CPU values). RAM: `(MemTotal - MemAvailable)/MemTotal`. Network: derive interface from default route, sample `/proc/net/dev` counters, show deltas/second; treat the first sample as unknown. Extend IPv6-only and VPN handling later.
- Bluetooth: `org.freedesktop.DBus.ObjectManager.GetManagedObjects` on system bus for `org.bluez.Adapter1`, `org.bluez.Device1` and `org.bluez.Battery1`, paired devices only; `org.bluez.Device1.Connect/Disconnect` async. Use `PropertiesChanged` and `InterfacesAdded/Removed` event-driven updates instead of only polling in the finished version. Do not auto-pair or auto-trust devices.
- Audio: reuse `resource:///org/gnome/shell/ui/status/volume.js` -> `getMixerControl()`; Gvc stream volume and mute. Use `Gvc.MixerControl.change_output(Gvc.MixerUIDevice)` to enumerate/select physical output ports and profiles in the finished version; the prototype uses `get_sinks()` + `set_default_sink()`, which has narrower capability. Never close GNOME's shared mixer.

### UI integration and behavior

- The prototype uses `Main.panel.addToStatusArea(uuid, PanelMenu.Button, 0, 'center')` and GNOME's PopupMenu. It re-parents the date menu into the panel right box, restores it during disable.
- This is acceptable for Milestone A, but *not* proof of true notch morph animation.
- For Milestone B, transition to a single `St.Widget` / `St.BoxLayout` surface managed by Shell (`Main.layoutManager.addChrome` or appropriate UI group) with explicitly constrained input region, monitor geometry handling, and fullscreen policy. Prototype in a nested Shell first. Do **not** create an ordinary GTK always-on-top window and expect Wayland compositor-global positioning.
- Handle scaling, multi-monitor, focus, top panel height, and notification alignment.

## Milestones and tasks

### Milestone A: Run and stabilize the delivered prototype

1. Install in a **nested** GNOME 46 Wayland Shell when possible. Confirm no syntax/import/type errors. Fix any encountered GJS issues.
2. Verify calendar button moved to right and retains notifications/calendar actions; disabling restores exact original parent/index.
3. Verify MPRIS track/song changes, pause/next/previous, stale player removal, and local cover art.
4. Verify CPU/RAM/network values against `top`, `free -h`, and `/proc/net/dev` over time.
5. Verify volume/mute, output sink selection, paired Bluetooth connect/disconnect. Test missing services.
6. Log meaningful failures with `[Ubuntu Island]`; distinguish `not available` from permission and transport errors.
7. Run pure Node tests + runtime smoke test. Export an installable GNOME extension ZIP.

### Milestone B: Finish feature parity and interaction quality

1. Replace popup with **real continuous animated morph**. Implement state machine and reduced-motion setting; close on outside click/Escape.
2. Remote album art via secure cache helper; progress bar using `mpris:length`, `Position`, `Seeked` and 1-second UI clock when expanded (never seek if `CanSeek` false).
3. Audio output **UI-device ports/profiles** and proper mute button; ensure device switching persists/updates correct playback stream.
4. Bluetooth `PropertiesChanged` subscriptions for immediate connection updates; battery from Battery1; optional adapter power toggle with appropriate handling.
5. Preferences (`prefs.js` + GSettings): notch width, show-on-monitor, hover threshold, metrics sampling interval, module enable/disable, art cache, reduced motion.
6. Better network adapter choice for default IPv6, multiple routes, VPN, and unusual interface names.
7. Add accessibility tests, smooth UI animation, RTL, DPI 100/125/200% and different screen resolutions.

### Milestone C: Production hardening

- Integration/unit tests with mocked service data; automated syntax + lint; no stale D-Bus callbacks after disable.
- Memory/timer leak regression after 50 enable/disable cycles.
- CPU usage/perf benchmarks while open, closed, playing, and idle.
- Shell upgrade compatibility strategy. Do not declare new Shell versions supported without testing them.
- Resilience with Bluetooth disabled, no MPRIS players, audio daemon restart, disconnected network, multiple Bluetooth devices, and fullscreen games.
- Documentation including release/rollback guide, screenshots, and clear limitations.

## Acceptance tests (must pass on real GNOME 46 Wayland)

| ID | Test | Expected |
|---|---|---|
| A01 | Enable extension; log out/in | Center pill appears, GNOME Shell stays responsive |
| A02 | Click twice and press Escape | Correct expand/collapse, no stuck input |
| A03 | Play/pause/skip Spotify/VLC | UI reflects state, controls actually control player |
| A04 | Switch from player A to player B | Currently playing source takes priority |
| A05 | Local art + HTTPS art | Both render after Milestone B; fallback is visible earlier |
| A06 | Compare CPU/RAM after 10s against system | Values plausible and not cumulative |
| A07 | Download known large file | RX counter and graph/time update without stalling Shell |
| A08 | Change output volume | System volume changes and follows external changes |
| A09 | Select alternate output sink | Audio switches; UI indicates active output |
| A10 | Paired Bluetooth connect/disconnect | Operation succeeds or displays clear error |
| A11 | Bluetooth off/unavailable | No crashes, clear empty state |
| A12 | Disable extension | No actors/timers remain, calendar restored |
| A13 | Switch fullscreen / maximize | Notch hidden in fullscreen, no overlap |
| A14 | Rapid toggle 30 times | No stuck controls or orphaned overlays |
| A15 | Run shell with no MPRIS player | Idle state with no `undefined` or Shell errors |
| A16 | Swap HDMI/headphone ports on same card | Correct device routing after Milestone B |
| A17 | Sleep/resume, disconnect VPN | Counters reset gracefully, service status recovers |
| A18 | GNOME 46 with another top-panel extension | No unrecoverable placement conflicts |

A05/part HTTPS, A16, morph animation, event-driven BlueZ and preferences are **not claimed complete** by the delivered prototype.

## Definition of done

1. The core UI and three features function in a **real** GNOME Shell 46 Wayland session with recorded testing evidence.
2. Baseline A01–A15 tests pass (with the explicitly documented media/port exceptions until Milestone B is finished).
3. All designed features have empty/error/disabled states.
4. Every actor, signal, timer, and cancellation is cleaned up.
5. The extension can be enabled/disabled without losing access to notifications/calendar.
6. Install/rollback/release commands are documented, and a versioned ZIP is available.
7. Harness provides a succinct verification report: pass/fail per acceptance test, screenshots, logs, and known deviations.

## Trusted implementation references

- GNOME Shell 46 `panel.js`: https://raw.githubusercontent.com/GNOME/gnome-shell/gnome-46/js/ui/panel.js
- GNOME Shell 46 `volume.js`: https://raw.githubusercontent.com/GNOME/gnome-shell/gnome-46/js/ui/status/volume.js
- GNOME JavaScript extension guide: https://gjs.guide/extensions/development/creating.html
- GNOME Shell 46 migration: https://gjs.guide/extensions/upgrading/gnome-shell-46.html
- MPRIS Player interface: https://specifications.freedesktop.org/mpris/latest/Player_Interface.html
- BlueZ Device1 D-Bus API: https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst

Do not copy over GPL snippets without respecting their licenses; the project source was written from interface/architecture documentation, not copied from an existing extension.
