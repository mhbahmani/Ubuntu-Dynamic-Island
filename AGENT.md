# AGENT.md — Ubuntu Island working guide

## Scope and environment

- Edit `ubuntu-island/`, the current implementation (v5). The sibling
  `ubuntu-island-gnome46-*` directories are frozen prototypes; leave them alone.
- Target GNOME Shell 46 on Ubuntu Wayland. Read `HARNESS_SPEC.md` for runtime
  acceptance cases and constraints. Later user design requests take precedence.
- Keep Shell responsive: asynchronous I/O, bounded artwork downloads, no
  subprocess loops or blocking reads. Never use sudo.
- Disconnect signals, cancel asynchronous work, release modal grabs, and
  restore the calendar on disable, including partial enable failures.

## Design and interaction

- Keep Ricelin’s compact artwork-and-controls composition and separate module
  tabs. Current direction is matte graphite, 98–99% opacity, Noto Sans, and
  restrained vermilion controls. Do not restore the old brown palette or clear glass.
- Keep navigation outside scrolling content so switching pages leaves the
  footer stable. Preserve device rows and focus across service updates.
- The idle notch has no “Island” label or placeholder music icon. Playing and
  paused tracks remain available; stopped or empty MPRIS registrations do not.
- Use explicit hover, focus, selected, disabled, pending, and error states.
  Respect reduced motion and interrupted animations.

## Verified GNOME API details

- Preferences import `ExtensionPreferences` from
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`.
  The lowercase Shell resource path is wrong for the preferences process.
- Scale explicit actor dimensions by `St.ThemeContext.scale_factor`, matching
  CSS lengths. Recalculate on scale and monitor changes.
- Avoid backdrop blur: it previously failed to paint on external monitors.
  The high-opacity gradient supplies the matte finish without backdrop sampling.
- Gvc has no synchronous UI-device list. Seed from sinks and maintain devices
  with output signals. Filter unavailable ports using `has_ports()` and
  `port_available`, retaining the active output and portless devices. Watch
  availability changes. `change_output()` takes a device, not an ID.
- Reuse Shell’s mixer singleton; never close it on extension disable.
- Use `Main.pushModal` and `captured-event` for dismissal. Detect outside
  presses by transformed geometry; event sources can be retargeted by the grab.
- `addChrome` supports `trackFullscreen`, `affectsStruts`, and
  `affectsInputRegion`. It does not support `visibleInFullscreen`.
- St supports gradients, letter spacing, and tabular figures. Icon size is a
  GObject property, not CSS. `Clutter.Actor.ease()` is a GJS override.
- Calendar relocation uses private panel boxes; test other panel extensions.

## Verification and installation

First compare installed source with the working tree; stale installations can
look like regressions:

```sh
diff -q ~/.local/share/gnome-shell/extensions/ubuntu-island@example.local/extension.js ubuntu-island/extension.js
cat ~/.local/share/gnome-shell/extensions/ubuntu-island@example.local/metadata.json
```

From `ubuntu-island/`:

```sh
node --test
for f in *.js services/*.js; do node --check "$f"; done
glib-compile-schemas --strict --dry-run schemas
python3 tests/smoke.py
./build.sh
```

The smoke test uses a private headless GNOME session and fixture data. It
checks rendering, idle media, artwork decoding, repeated pointer hover/clicks,
200% scaling, rapid toggles, outside dismissal, Escape, and disable cleanup.
Artifacts stay in its printed `/tmp/ubuntu-island-smoke-*` directory. Keep
only README-linked example screenshots in the repository.

v5 passed 26 Node tests, syntax/schema checks, preferences module import, and
headless GNOME tests. These do not establish physical mixed-monitor rendering,
HDMI hotplug/routing, live MPRIS control, Bluetooth, suspend/resume, or fullscreen
behavior. Run the A01–A18 hardware acceptance cases before claiming those pass.

`./install.sh` backs up the previous per-user installation. Under Wayland,
log out and back in to load changed code; never restart Shell with Alt+F2 `r`.
Use `journalctl --user -b` to inspect extension errors.

## Git hygiene

- Use focused commits with short imperative Conventional Commit subjects
  (`fix(audio): ...`, `feat(ui): ...`, `test: ...`, `docs: ...`).
- Do not add co-author trailers. Never push or open a PR unless requested.
- Keep build ZIPs, compiled schemas, caches, and loose diagnostic captures out
  of commits. Preserve user reference files when cleaning up; archive if needed.
