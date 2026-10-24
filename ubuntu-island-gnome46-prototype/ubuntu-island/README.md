# Ubuntu Island — GNOME Shell 46 prototype

**Target:** `XDG_CURRENT_DESKTOP=ubuntu:GNOME`, `gnome-shell --version=46.0`, `XDG_SESSION_TYPE=wayland`.

This is a real extension source tree, not an HTML mockup. It is a **prototype**, not a GNOME-runtime-verified release. JavaScript syntax and the pure procfs parsing tests have been checked in a Linux build environment; **actual GNOME Shell 46/Wayland runtime testing is still required**.

## Included in the prototype

- Centered clickable pill + GNOME native animated popup with music, metrics, audio, and Bluetooth sections.
- GNOME notification/calendar date button moved to the panel right group, restored on disable.
- MPRIS discovery + play/pause/previous/next and **local `file://` artwork** (remote artwork is a follow-up task).
- CPU and RAM percentages and RX/TX throughput for the default IPv4 route interface.
- GNOME Shell's shared Gvc mixer volume slider + selectable output sinks.
- Bluetooth paired-device listing, connect/disconnect actions through BlueZ. Pairing stays in GNOME Settings.
- Signal/timer cleanup on disable, no shell daemon or Node runtime needed on target.

## Current limitations, important

1. This first version uses a **native GNOME popup opening animation**. It is not yet a continuous single-surface pill-to-card morph.
2. Only local album art files render, and remote HTTP(S) art URLs fall back to a generic media icon. Implement secure background caching for remote artwork in the next milestone.
3. Bluetooth controls work with paired devices. Pair devices from GNOME Bluetooth Settings. A powered-off adapter is shown but is not powered on from the notch yet.
4. Audio-output selection lists Gvc sink streams; multiple physical ports represented by one stream might not appear separately. Use Gvc UI devices and `change_output()` for complete port/profile routing.
5. The network meter counts traffic on the primary **IPv4 default route** interface, not an aggregate of all adapters; VPN and IPv6-only setups need refinement.
6. The project uses a GNOME 46-specific **private panel box** to move the calendar. Another panel extension or GNOME upgrade can conflict with that operation.
7. Hover expansion, settings screen, performance characterization, multi-monitor options, remote artwork, and full morph animation are specified in `HARNESS_SPEC.md`, not implemented in this version.

## Install manually

```bash
# Run from this repository's parent, so that ./ubuntu-island exists.
mkdir -p ~/.local/share/gnome-shell/extensions
cp -a ./ubuntu-island ~/.local/share/gnome-shell/extensions/ubuntu-island@example.local

# Required on Wayland after the first install or code update: log out,
# then log back in. Do NOT use Alt+F2 'r' on Wayland.
gnome-extensions enable ubuntu-island@example.local
```

If the extension is not yet discovered after copying it, **log out and log back in before** running `gnome-extensions enable`. An alternative is to use the bundled script:

```bash
chmod +x ./ubuntu-island/install.sh
./ubuntu-island/install.sh
# log out and log back in, then:
gnome-extensions enable ubuntu-island@example.local
```

GNOME Shell and PipeWire/PulseAudio compatibility are included on a normal Ubuntu GNOME desktop; Bluetooth connectivity requires BlueZ/adapter support.

Check:

```bash
gnome-shell --version
echo "$XDG_SESSION_TYPE"
gnome-extensions info ubuntu-island@example.local
journalctl --user -b | grep -i 'Ubuntu Island\|ubuntu-island'
```

If journal output doesn't include GNOME Shell failures, check the full GNOME Shell journal or inspect through GNOME's Looking Glass. A nested Wayland Shell can be useful for testing, e.g. GNOME 46 `dbus-run-session gnome-shell --nested --wayland` from a test environment.

## Testing and development

```bash
node --test tests/*.test.mjs
for f in extension.js services/*.js; do node --check "$f"; done
```

Node is only a **development/test tool**, not a runtime dependency. Tests cover deterministic procfs calculations, not GNOME actor or D-Bus integration.

## Safe recovery

```bash
gnome-extensions disable ubuntu-island@example.local
# If disabled successfully the original date/menu position should be restored.
# Log out/in if you need to recover after a Shell exception.
```

If GNOME Shell reports a load failure, temporarily move `~/.local/share/gnome-shell/extensions/ubuntu-island@example.local` away and log out/in. Use `journalctl` to identify the error before re-enabling. Avoid debugging on a critical production desktop if possible.

## Layout

```
ubuntu-island/
  extension.js            # GNOME Shell actors, panel, lifecycle, UI
  stylesheet.css          # Extension-scoped Shell styles
  metadata.json           # GNOME Shell 46 compatibility
  services/media.js       # MPRIS session D-Bus
  services/system.js      # /proc sampling
  services/proc.js        # Pure parsers
  services/audio.js       # GNOME's Gvc mixer singleton
  services/bluetooth.js   # BlueZ system D-Bus
  tests/proc.test.mjs     # Deterministic Node tests
  HARNESS_SPEC.md         # Full design + requirements + acceptance suite
  install.sh              # Non-destructive per-user installation
```
