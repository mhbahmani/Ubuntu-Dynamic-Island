# AGENT.md — Ubuntu Island working guide

## Scope and environment

- The repository root is the current extension (v10): entry points and build
  scripts at root, with `services/`, `schemas/`, `tests/`, and `screenshots/`.
  Obsolete prototypes were removed; consult Git history if needed.
- Target GNOME Shell 46 on Ubuntu Wayland. See `README.md` for development
  and runtime acceptance checks. Later user design requests take precedence.
- Keep Shell responsive: asynchronous I/O, bounded artwork downloads, no
  subprocess loops or blocking reads. Never use sudo.
- Disconnect signals, cancel asynchronous work, release modal grabs, and
  restore the calendar on disable, including partial enable failures.

## Design and interaction

- Keep Ricelin’s compact artwork-and-controls composition and separate module
  tabs. Current direction is matte graphite, 98–99% opacity, Noto Sans, and
  restrained vermilion controls. Do not restore the old brown palette or clear glass.
- Theme and background opacity preferences apply live. Keep text fully opaque.
- Charts use the existing metrics sampler and four 60-sample typed buffers.
  Never add a per-frame animation, independent polling, or hidden repaint loop.
  CPU/memory use fixed percentage scales; network shares an automatic scale,
  with download above the baseline and upload below. Reset on interface changes.
- Keep navigation outside scrolling content so switching pages leaves the
  footer stable. Preserve device rows and focus across service updates.
- The idle notch has no “Island” label or placeholder music icon. Playing and
  paused tracks remain available; stopped registrations do not. Playing media
  without metadata uses the player/URI fallback title.
- The media title eye toggle and middle-click on the notch change only the
  collapsed title (`pill-show-title`); keep the playback icon visible.
- Keep load average and used-memory values compact on the CPU/MEMORY heading
  line; omit “load” and “used”, keep the percentage, and preserve accessible labels.
- Metric names and inline secondary values share one expanding markup label;
  verify its allocated width at narrow card widths and enlarged text.
- Opening focuses the surface; Tab then enters the controls. Selected tabs use
  a neutral indicator, never an orange focus/selection ring.
- Opacity supports 0–100%. Handle zero alpha without dividing by zero; matte
  tone only affects RGB, never final alpha. Tab markers are separate actors,
  not rounded shadows that change with focus.
- Opening preferences keeps the panel open and suspends its modal grab and
  hover-close behavior. Track the actual preferences window by title (including
  late title updates), reuse the watcher when raised, and clean up on failure,
  close, and disable. Do not add continuous window polling.
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
diff -q ~/.local/share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io/extension.js extension.js
cat ~/.local/share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io/metadata.json
```

From the repository root:

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

v10 passed 43 Node tests, syntax/schema checks, preferences module import, and
headless GNOME tests. These do not establish physical mixed-monitor rendering,
HDMI hotplug/routing, live MPRIS control, Bluetooth, suspend/resume, or fullscreen
behavior. Run the README hardware acceptance checks before claiming those pass.

`./install.sh` backs up the previous per-user installation. Under Wayland,
log out and back in to load changed code; never restart Shell with Alt+F2 `r`.
Use `journalctl --user -b` to inspect extension errors.

## Git hygiene

- Use focused commits with short imperative Conventional Commit subjects
  (`fix(audio): ...`, `feat(ui): ...`, `test: ...`, `docs: ...`).
- Do not add co-author trailers. Never push or open a PR unless requested.
- Keep build ZIPs, compiled schemas, caches, and loose diagnostic captures out
  of commits. Preserve user reference files when cleaning up; archive if needed.

## Future work

`docs/FEATURE_ROADMAP.md` is a proposal, not implemented functionality. It covers
Weather, Commute, Calendar appointments, and explicit Task Progress integrations.
Respect its optional-module lifecycle and performance budgets; verify provider/API
compatibility before implementation. Do not add the roadmap features without a
user implementation request.
