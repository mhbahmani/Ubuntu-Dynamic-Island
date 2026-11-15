# AGENTS.md — Ubuntu Island working guide

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
  reintroduce WebKit sandbox workarounds. See `docs/MODULES.md`.

## Tab layout

- Keep the regular expanded island the same width and height when switching tabs
  or sections. Use spare space for useful content (especially the Agents prompt)
  rather than shrinking the surface. Keep navigation fixed and overflow reachable.
  The standalone shortcut Quick Ask is intentionally a separate compact surface.
- Aim for the common tab layout to fit without scrolling. Improve grouping,
  spacing and progressive disclosure before adding more height or scroll areas.
- Preserve readable text and usable controls; never hide or clip overflow to
  make a tab appear to fit. Keep scrolling available for long lists, enlarged
  text and small displays, with navigation and primary actions outside it.
- Verify native layouts at narrow and default card widths, 100% and 200% scale,
  and enlarged text. Check that overflowing content remains reachable.

## Design and interaction

- Keep Ricelin’s compact artwork-and-controls composition and separate module
  tabs. Current direction is matte graphite, 98–99% opacity, Noto Sans, and
  restrained vermilion controls. Do not restore the old brown palette or clear glass.
- Theme and background opacity preferences apply live. Keep text fully opaque.
- Palettes live in `services/themes.js`: each theme is a dark tint gradient and
  one accent; all other tokens are derived. Add themes at the end of the list (saved
  indices), add the schema choice, then run `node scripts/theme-css.mjs` to regenerate the
  stylesheet block. Tests enforce contrast (text ≥ 7:1, secondary/accent ≥ 4.5:1,
  button text ≥ 4.5:1) and that the generated CSS is current. Never hand-edit it.
- Charts use the existing metrics sampler and four 60-sample typed buffers.
  Never add a per-frame animation, independent polling, or hidden repaint loop.
  CPU/memory use fixed percentage scales; network shares an automatic scale,
  with download above the baseline and upload below. Reset on interface changes.
- Keep navigation outside scrolling content so switching pages leaves the
  footer stable. Preserve device rows and focus across service updates.
- Keep per-session actions in an anchored menu; do not add intermediate options
  or window-chooser pages. Only offer window activation for an unambiguous process
  match. Expire inactive agent records lazily when the Agents tab opens, never
  through a cleanup timer or a new background worker.
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
- Opening focuses the surface; Tab then enters the controls. The selected tab
  shows its theme accent (icon colour and one shared `ubuntu-island-tab-slider`
  marker that glides between tabs at 75% of the opening duration, instant with
  reduced motion, snapped on layout changes). The incoming page fades in and
  settles from the selected tab's side on the same timing through one shared
  transition; never add per-tab copies. Per-tab markers are only for
  keyboard focus on unselected tabs; the selected tab's own marker stays clear
  even when focused, so no second line appears before the slider arrives.
  Never show selection as a ring or button shadow.
- Focus rings, headings and the navigation bar use theme tokens (`focus`,
  `heading`, `bottom`/`accent`) from `services/themes.js`; never hardcode them.
- Opacity supports 0–100% and only sets the tint layer's alpha (never the
  container). Handle zero alpha without dividing by zero; matte tone sets blur
  strength and gradient flatness, never final alpha or the opacity range. Tab markers are separate actors,
  not rounded shadows that change with focus.
- Opening preferences keeps the panel open and suspends its modal grab and
  hover-close behavior. Track the actual preferences window by title (including
  late title updates), reuse the watcher when raised, and clean up on failure,
  close, and disable. Do not add continuous window polling.
- Use explicit hover, focus, selected, disabled, pending, and error states.
  Respect reduced motion and interrupted animations.
- Use the accepted notch expansion as the baseline for future features and
  animations, including any later tab transitions. Preserve centered movement,
  stable text layout, restrained scaling, smooth deceleration and continuous
  reversals. Reuse native transitions and respect both reduced-motion settings.
  See [Motion baseline](docs/HANDOFF.md#motion-baseline) for behavior and checks.

## Verified GNOME API details

- Preferences import `ExtensionPreferences` from
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`.
  The lowercase Shell resource path is wrong for the preferences process.
- Scale explicit actor dimensions by `St.ThemeContext.scale_factor`, matching
  CSS lengths. Recalculate on scale and monitor changes.
- Matte tone is real background blur: one `IslandBackdrop` (`ui/backdrop.js`)
  with `Shell.BlurEffect` in `BACKGROUND` mode, below the tint layer and content.
  Never `ACTOR` mode, `backdrop-filter`, or wallpaper screenshots. It runs only
  while the card is open and matte > 0 and opacity < 100. Rounded corners use
  non-overlapping slices from `backdropSlices()`. Background blur reads back the
  framebuffer, so partial repaints must be widened: call `invalidateBackdrop()`
  from new periodic updaters. It once failed to paint on external monitors;
  verify mixed-monitor setups before claiming it works there.
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
  GObject property, not CSS. `Clutter.Actor.ease()` is a GJS override; its
  `onComplete` runs only for finished transitions. Avoid `delay`: timeline
  delays use a wall-clock source and can lose to frame-clock progress (a
  delayed fade never started in the nested preview); stagger with curves.
- Calendar relocation uses private panel boxes; test other panel extensions.

## Installation and packaging

- Whenever adding, renaming, moving, or removing a runtime module or asset,
  update `scripts/install.sh` and `scripts/build.sh` as needed so both deliver the
  complete runtime.
- Keep only GNOME entry points (`extension.js` and `prefs.js`) in the root. Shell
  components belong in `ui/`, GTK preferences in `preferences/`, service/model
  code in `services/`, subprocess helpers in `helpers/`, and assets in `assets/`.
  Both scripts copy those directories recursively. Development/test helpers
  belong under `scripts/` or `tests/`; build ZIPs belong in ignored `dist/`.
- If new runtime files live outside the existing copied directories, explicitly
  include them in both scripts. Update other copy paths used by previews/tests.
- Run `node --test tests/install.test.mjs` and verify ZIP contents after changing
  runtime file layout. A successful source preview does not verify installation.
- Keep installation per-user and preserve the previous install. Test with a
  temporary `XDG_DATA_HOME`; never replace the user's install merely to run tests.
- Retain retired GSettings keys as deprecated compatibility entries when removing
  controls. Shell can re-enable cached JavaScript against the newly installed
  schema before logout; removing keys can break the running desktop extension.

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

`make install` (via `scripts/install.sh`) backs up the previous per-user installation.
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

`docs/GOOGLE_CALENDAR_PLAN.md` is the accepted plan for read-only account events
in the existing Calendar UI. Date browsing is already implemented; event sync
is not. Do not implement the plan until requested. Current behavior and user
requests override historical proposals retained in Git history.
