# Ubuntu Island — GNOME Shell 46 Dynamic Island

A native GNOME Shell extension implementing a macOS-style Dynamic Island for
Ubuntu 24.04-class GNOME Shell **46**, Wayland. The compact pill sits centered
at the top of the primary monitor and morphs — one single surface, no popup
window — into an expanded card with media controls, system meters, audio
output selection, and Bluetooth device management.

The repository root contains the current extension. Earlier prototypes remain
available in Git history. Run installation and development commands from here.

![Media face rendered in GNOME Shell 46 with fixture data](screenshots/expanded.png)

More fixture renders: [System](screenshots/system.png), [Sound](screenshots/sound.png),
[Bluetooth](screenshots/bluetooth.png), [narrow media](screenshots/narrow.png),
and [compact playing pill](screenshots/playing-pill.png).

## What's included

- **Single-surface morph**: the pill and the card are two children of one
  chrome-managed `St.Widget`, animated with width/height/opacity tweens
  (`COLLAPSED → EXPANDING → EXPANDED → COLLAPSING`), interrupt-safe under
  rapid toggling, snapping closed when hidden over fullscreen windows.
- **Ricelin-inspired faces**: one focused surface at a time, using matte graphite
  surfaces and Ricelin’s vermilion accent. Media opens as a compact
  horizontal artwork-and-controls face. A quiet navigation strip switches to
  system, sound, and Bluetooth faces; close and preferences remain available.
  Surfaces are 98–99% opaque, avoiding the previous monitor-dependent backdrop path.
- Click toggles; **Escape and outside clicks close** via the same modal-grab
  pattern GNOME's own popup menus use (outside presses release input
  immediately so apps receive the next click); optional hover open/close.
- **Media**: event-driven MPRIS discovery with playing-player priority, play/pause/skip,
  progress bar with seek (`SetPosition`, only when `CanSeek`), local
  `file://` artwork and **remote HTTPS artwork** through a bounded
  (2 MiB, MIME allowlist, host-validated, DNS-checked, disk-cached) loader.
  **Idle/stopped players and empty registrations are hidden**; paused tracks
  remain controllable. Seeking uses GNOME's native keyboard-accessible slider.
- **System**: CPU and RAM percentages plus RX/TX rate for the lowest-metric
  default-route interface (VPN tunnels win), read asynchronously from procfs.
  CPU and memory have fixed 0–100% history charts. Download and upload share
  a mirrored chart (download above, upload below), with an automatic shared scale.
- **Audio**: GNOME's shared Gvc mixer, volume slider, mute, and **output
  device selection through `change_output(Gvc.MixerUIDevice)`** (port/profile
  aware), seeded from existing sinks and updated through Gvc output signals.
- **Bluetooth**: event-driven BlueZ state (`GetManagedObjects` snapshot +
  `InterfacesAdded/Removed` + per-interface `PropertiesChanged`), paired
  devices with connect/disconnect, Battery1 percentage, adapter power toggle;
  pairing stays in GNOME Settings. Operations show pending states and inline
  failures. Audio and Bluetooth rows are retained across updates to preserve
  focus. A scroll container keeps controls reachable on short displays.
- **Preferences** (`prefs.js` + GSettings): live Graphite/Ocean/Forest/Ember themes,
  background opacity (70–100%, default 98%), matte backing (0–100%, default
  60%) that flattens the translucent tint into a frosted solid panel instead
  of clear glass, widths, animation duration,
  reduced animation, hover behavior, metrics interval, module toggles,
  remote-art toggle, clock relocation.
- Full `disable()` cleanup of timers, signal handlers, D-Bus subscriptions,
  cancellables, and chrome actors; the panel clock is restored.

## Install

```bash
./install.sh
# Log out and back in (Wayland; do NOT use Alt+F2 'r'), then:
gnome-extensions enable ubuntu-island@mhbahmani.github.io
```

`install.sh` compiles the GSettings schema and installs per-user under
`~/.local/share/gnome-shell/extensions/`. `./build.sh` produces a versioned,
installable zip.

## Verify

```bash
gnome-shell --version        # 46.0
gnome-extensions info ubuntu-island@mhbahmani.github.io
journalctl --user -b | grep -i 'Ubuntu Island\|ubuntu-island'
```

## Development checks

```bash
node --test                    # pure-function tests (Node is a dev tool only)
for f in *.js services/*.js; do node --check "$f"; done
glib-compile-schemas --strict --dry-run schemas
python3 tests/smoke.py          # isolated GNOME 46 render + interaction smoke test
```

`tests/smoke.py` starts a separate headless Shell with a private session bus,
runtime directory, and in-memory settings. It uses fixture media/device data,
captures every module face, and checks navigation, idle media, stable audio rows,
outside dismissal, Escape, rapid toggles, and disable cleanup. It leaves logs
and screenshots in the printed `/tmp/ubuntu-island-smoke-*` directory. It does
not replace the running desktop or switch physical audio/Bluetooth devices.

v4 verification (2026-10-25): 26 Node regressions passed; all source syntax,
strict schema compilation, ZIP integrity, and the real GNOME 46 headless smoke
test passed. The smoke includes local artwork decoding and interrupted animated
toggles. The screenshots above use fixture data and a procedural cover.
Transient Clutter allocation warnings occur during rapid fixture changes.
Live MPRIS commands, audio routing/ports, Bluetooth operations, physical
mixed-scale monitors, suspend/resume, and fullscreen applications still need
the hardware acceptance checks below.

Before release, verify click/toggle behavior, MPRIS controls, metrics, audio
routing and hotplug, Bluetooth, fullscreen hiding, suspend/resume, and mixed-scale
monitors in a live GNOME 46/Wayland session. Automated checks do not replace
these hardware acceptance checks.

## Limitations

- The matte surface is deliberately high-opacity; wallpaper blur is not used.
- While open, the island holds an input grab like a native menu: the one
  press that dismisses it is consumed rather than passed to the app.
- The date-menu relocation uses GNOME 46 private panel boxes
  (`Main.panel._centerBox`/`_rightBox`); other panel extensions may conflict.
- Remote art rejects redirects and non-image MIME types and stops reading at
  2 MiB. DNS is validated before connecting; DNS-to-connection TOCTOU remains.
- Audio discovery seeds one UI device per existing sink. Inactive ports that
  share a sink depend on Gvc's later output signals; test port switching on
  your hardware.
- Network metering follows one interface (the winning default route);
  aggregate multi-interface accounting is future work.

## Layout

Visual references: [Ricelin README](https://github.com/Gakuseei/Ricelin),
[media face](https://github.com/Gakuseei/Ricelin/blob/main/assets/hero.png),
and [module faces](https://github.com/Gakuseei/Ricelin/blob/main/assets/shell.png).
The GNOME implementation uses native St/Clutter widgets; Ricelin's Quickshell
components are design and architecture references rather than runtime dependencies.

```
ubuntu-dynamic-island/
  extension.js            # lifecycle, service wiring, clock relocation
  island.js               # morphing surface + interaction state machine
  card.js                 # expanded content sections
  charts.js               # native drawing actors for bounded history
  pill.js                 # compact pill content
  widgets.js              # shared St widget factories
  prefs.js                # preferences dialog (GSettings)
  stylesheet.css          # extension-scoped styles
  metadata.json
  schemas/                # GSettings schema (compiled at install)
  services/
    media.js              # MPRIS + progress/seek model
    art.js                # bounded artwork loader + cache (Soup 3, async)
    system.js             # procfs sampling on a timer
    proc.js               # pure parsers (Node-tested)
    urlguard.js           # pure URL/host safety checks (Node-tested)
    format.js             # pure time/hash helpers (Node-tested)
    presentation.js       # pure geometry, player selection, layout signatures
    audio.js              # Gvc mixer control (shared singleton)
    bluetooth.js          # event-driven BlueZ client
  tests/                  # node --test suite
  install.sh / build.sh   # per-user install / zip packaging
  README.md
```

### v5 refinements

Noto Sans, matte graphite surfaces, and a fixed footer retain Ricelin’s compact
media composition. Idle notches omit the name and music placeholder. Preferences
use the GNOME 46 resource path. Actor dimensions follow the Shell theme scale,
and unavailable HDMI ports are filtered with live availability updates.

Verification includes 26 Node tests, preferences module import, and headless
GNOME rendering with twelve real pointer hover/click cycles and 200% scaling.
Physical mixed-monitor and HDMI hotplug acceptance still need a session reload.

### Lightweight charts and appearance (v6)

Theme and opacity changes apply immediately after opening preferences. Opacity
only affects the background; text and controls stay fully opaque. No blur was added.

Charts share the existing metrics sampler (default: once every two seconds).
Four 60-sample typed buffers use 1,920 bytes for history; there are no extra timers,
network requests, chart libraries, or chart animations. Hidden charts collect
samples without requesting repaints. Disable System metrics to stop sampling.
Missing samples leave gaps; network history resets when the active interface changes.
The history window is 60 sampling intervals (two minutes at the default).

Validated with 30 Node tests, real GTK preferences bindings, and isolated GNOME
rendering at normal and 200% scale. The smoke test covers live theme/opacity changes
and verifies hidden charts do not repaint. These checks are not a battery-life or
whole-desktop performance benchmark.

To check the real preferences controls without changing user settings (requires
an available desktop display):

```sh
glib-compile-schemas --strict schemas
GSETTINGS_BACKEND=memory GI_TYPELIB_PATH=/usr/lib/gnome-shell/girepository-1.0 \
  LD_LIBRARY_PATH=/usr/lib/gnome-shell gjs -m tests/prefs-smoke.mjs
```

### Compact controls and live settings preview (v8)

CPU load and used memory sit beside their headings as short values (`1.44`,
`3.5 GB`), with percentages retained. The navigation uses a neutral selection
indicator. The eye beside the track title toggles its visibility in the collapsed
notch; middle-clicking the notch is a shortcut. The playback icon stays visible.

Opening preferences keeps the island expanded so appearance and width changes
can be previewed. The settings window remains interactive; normal outside-click
and Escape dismissal resume after it closes. Module toggles and sampling interval
still require disabling and re-enabling the extension, as stated in preferences.

Validation includes 42 Node regressions and isolated GNOME rendering, pointer
navigation, title toggling, and a real GTK preferences window lifecycle.
