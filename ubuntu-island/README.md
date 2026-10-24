# Ubuntu Island — GNOME Shell 46 Dynamic Island

A native GNOME Shell extension implementing a macOS-style Dynamic Island for
Ubuntu 24.04-class GNOME Shell **46**, Wayland. The compact pill sits centered
at the top of the primary monitor and morphs — one single surface, no popup
window — into an expanded card with media controls, system meters, audio
output selection, and Bluetooth device management.

This is the current implementation tree (the `ubuntu-island-gnome46-*`
directories next to it are earlier prototypes kept for reference).

## What's included

- **Single-surface morph**: the pill and the card are two children of one
  chrome-managed `St.Widget`, animated with width/height/opacity tweens
  (`COLLAPSED → EXPANDING → EXPANDED → COLLAPSING`), interrupt-safe under
  rapid toggling, snapping closed when hidden over fullscreen windows.
- Click toggles; **Escape and outside clicks close** (outside clicks still
  propagate to apps underneath); optional hover open/close with grace delays.
- **Media**: MPRIS discovery with playing-player priority, play/pause/skip,
  local `file://` artwork and **remote HTTPS artwork** through a bounded
  (2 MiB, MIME allowlist, host-validated, DNS-checked, disk-cached) loader,
  progress bar with seek (`SetPosition`, only when `CanSeek`).
- **System**: CPU and RAM percentages plus RX/TX rate for the lowest-metric
  default-route interface (VPN tunnels win), sampled from procfs.
- **Audio**: GNOME's shared Gvc mixer, volume slider, mute, and **output
  device selection through `change_output(Gvc.MixerUIDevice)`** (port/profile
  aware), enumerated via Gvc's `output-added`/`output-removed` signals.
- **Bluetooth**: event-driven BlueZ state (`GetManagedObjects` snapshot +
  `InterfacesAdded/Removed` + per-interface `PropertiesChanged`), paired
  devices with connect/disconnect, Battery1 percentage, adapter power toggle;
  pairing stays in GNOME Settings.
- **Preferences** (`prefs.js` + GSettings): widths, animation duration,
  reduced animation, hover behavior, metrics interval, module toggles,
  remote-art toggle, clock relocation.
- Full `disable()` cleanup of timers, signal handlers, D-Bus subscriptions,
  cancellables, and chrome actors; the panel clock is restored.

## Install

```bash
./install.sh
# Log out and back in (Wayland; do NOT use Alt+F2 'r'), then:
gnome-extensions enable ubuntu-island@example.local
```

`install.sh` compiles the GSettings schema and installs per-user under
`~/.local/share/gnome-shell/extensions/`. `./build.sh` produces a versioned,
installable zip.

## Verify

```bash
gnome-shell --version        # 46.0
gnome-extensions info ubuntu-island@example.local
journalctl --user -b | grep -i 'Ubuntu Island\|ubuntu-island'
```

## Development checks

```bash
node --test                    # pure-function tests (Node is a dev tool only)
for f in *.js services/*.js; do node --check "$f"; done
```

Runtime acceptance tests (click/toggle, MPRIS control, metrics plausibility,
audio routing, Bluetooth, rapid toggling, fullscreen hiding) follow the
A01–A18 suite in the repository-level `HARNESS_SPEC.md`. GNOME Shell
46/Wayland runtime verification on a live session is still required — the
syntax, parser, and API checks here do not replace it.

## Limitations

- The date-menu relocation uses GNOME 46 private panel boxes
  (`Main.panel._centerBox`/`_rightBox`); other panel extensions may conflict.
- Remote-art DNS validation is checked before connecting and after redirects
  for literal addresses; a redirect to a *hostname* that resolves privately is
  detected only by literal re-check (TOCTOU remains).
- Audio device list shows Gvc UI devices as reported by PipeWire/PulseAudio.
- Network metering follows one interface (the winning default route);
  aggregate multi-interface accounting is future work.

## Layout

```
ubuntu-island/
  extension.js            # lifecycle, service wiring, clock relocation
  island.js               # morphing surface + interaction state machine
  card.js                 # expanded content sections
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
    audio.js              # Gvc mixer control (shared singleton)
    bluetooth.js          # event-driven BlueZ client
  tests/                  # node --test suite
  install.sh / build.sh   # per-user install / zip packaging
  README.md
```
