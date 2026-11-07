# AGENT.md — Ubuntu Island working guide

## Scope and environment

- Read `docs/HANDOFF.md` and `README.md` before changing code. Current user
  instructions take precedence over historical designs and roadmap proposals.
- Target GNOME Shell 46 on Ubuntu Wayland. Root entry points use native St/Clutter;
  preferences use GTK/Adwaita. Weather and Commute are implemented opt-in modules.
- Keep changes scoped to the request. Do not implement future roadmap features
  without authorization. Never use sudo or weaken sandbox/privacy protections.

## Performance first

Host responsiveness and resource use take priority over visual effects and extra
features. This extension runs inside GNOME Shell: blocking it blocks the desktop.

- Use asynchronous Gio/Soup I/O, cancellation, finite timeouts, response-size
  limits, and generation guards against late results. No synchronous network
  calls, subprocess polling loops, or unnecessary dependencies.
- Reuse existing service snapshots, caches, and timers across tabs and notch
  indicators. Hidden consumers must not keep polling or repainting. Disabled
  modules must release timers, signals, requests, and location subscriptions.
- Commute defaults to a 15-minute refresh with a 10-minute minimum. Refresh only
  while its tab or enabled notch indicator is visible; reuse fresh cached data.
- Weather motion uses premade assets, at most 12 fps and one selected atlas.
  Pause when hidden and respect reduced-motion and power-saving settings. Keep
  collapsed weather icons static. Avoid per-frame allocation and layout work.
- Disconnect signals, release modal grabs, and restore the calendar on disable,
  including partial enable failures. Test repeated enable/disable and hidden states.
- Performance budgets are targets, not measured guarantees. Report what was
  actually verified, including any untested hardware or live-provider behavior.

## Providers, privacy, and fallbacks

- Use https://github.com/public-apis/public-apis for API discovery. Verify current
  capabilities, regional coverage, terms, quotas, and pricing in provider-owned
  documentation before choosing or changing a service. Directory inclusion does
  not establish that a service is free, reliable, or traffic-aware in Iran.
- Keep independent provider fallbacks; prefer an Iranian option when suitable.
  Distinguish keyless access from an account-based free allowance. Do not activate
  paid services or embed shared credentials. Store API keys in the desktop keyring.
- Never log API keys, authenticated URLs, or precise private routes. Show baseline
  ETA and stale data honestly; do not manufacture traffic corrections or claim
  parity with Google Maps without a real comparison.
- Current location requires explicit permission. Never enable system location
  services automatically or silently substitute a saved start for live location.
- Keep map selection in the native preferences editor, outside Shell. Do not
  reintroduce WebKit sandbox workarounds. See `docs/COMMUTE.md` and `docs/WEATHER.md`.

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
  verify its allocated width at narrow card widths and enlarged text. At larger
  fonts, move the percentage below only when necessary. Measure against available
  card width, not an already oversized child; verify percentage bounds too.
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

## Runtime file changes

Follow [AGENTS.md](AGENTS.md) when adding or changing runtime files. Keep
`install.sh`, `build.sh`, and preview/test copy paths synchronized. Root `.js`
files are runtime modules and both installation scripts copy them automatically;
new directories or other assets still need explicit inclusion. Run the installer
regression test and verify ZIP contents; preview success alone is insufficient.

## Verification and installation

First compare installed source with the working tree; stale installations can
look like regressions:

```sh
diff -q ~/.local/share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io/extension.js extension.js
cat ~/.local/share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io/metadata.json
```

From the repository root:

```sh
make help
make check
make prefs-test
make weather-cache-test
make smoke
make build
# Or all checks and packaging:
make verify
```

`make preview` opens an interactive nested GNOME window with all modules and
populated notch indicators, collapsed by default. Sample device controls are
simulated. `make preview-offline` and `make preview-offline-edge` exercise the
connection designs without changing the host network;
`make preview-live` uses live data. Neither installs nor requires logout. Restart
the preview after source edits. `make preview-headless` saves a screenshot.

The smoke test uses a private headless GNOME session and fixture data. It
checks rendering, idle media, artwork decoding, repeated pointer hover/clicks,
200% scaling, rapid toggles, outside dismissal, Escape, and disable cleanup.
Artifacts stay in its printed `/tmp/ubuntu-island-smoke-*` directory. Keep
only README-linked example screenshots in the repository.

See `docs/HANDOFF.md` for the latest validation record. Automated checks do not
establish physical mixed-monitor rendering,
HDMI hotplug/routing, live MPRIS control, Bluetooth, suspend/resume, or fullscreen
behavior. Run the README hardware acceptance checks before claiming those pass.

`make install` (via `install.sh`) backs up the previous per-user installation.
Under Wayland, log out and back in to load changed code; never restart Shell with Alt+F2 `r`.
Use `journalctl --user -b` to inspect extension errors.

## Git hygiene

- Make a separate focused commit for each logical change. Keep commit messages
  short, human-written in tone, and imperative. Use Conventional Commits such as
  `fix(weather): balance notch icons`, `feat(ui): choose the opening tab`, and
  `docs: refresh development guides`. Avoid vague subjects and AI boilerplate.
- Never add `Co-authored-by` or assistant attribution trailers/messages.
- When a branch is needed, use a short descriptive name such as
  `feat/commute-eta`, `fix/notch-spacing`, or `docs/development-guide`.
- Review staged diffs and run checks appropriate to the change before committing.
  Preserve unrelated user edits. Never push or open a PR unless requested.
- Keep build ZIPs, compiled schemas, caches, and loose diagnostic captures out of
  commits. Remove obsolete generated files when requested, using explicit paths.
  Preserve user reference screenshots and README-linked assets; avoid broad cleans.

## Future work

`docs/FEATURE_ROADMAP.md` contains design targets and future proposals. Weather
and Commute are implemented; Calendar appointments and Task Progress remain
proposals. Current behavior and user requests override earlier roadmap ideas.
