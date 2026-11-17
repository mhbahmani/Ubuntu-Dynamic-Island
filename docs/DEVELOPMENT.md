# Development and troubleshooting

[Back to the README](../README.md) · [Usage and settings](USAGE.md) · [Implementation handoff](HANDOFF.md)

Run commands from the repository root. See [AGENTS.md](../AGENTS.md) for the
engineering and contribution rules.

## Preview locally without installing

```sh
make preview       # your UI preferences, sample data, all modules available
make preview-offline # disconnected Wi-Fi icon with sample local modules
make preview-offline-edge # unplugged symbol and split amber underline
make preview-live  # live Tehran weather/routes and system metrics; sample devices
make preview-headless # save a screenshot without opening a window
make preview-sun-day    # sunny sample
make preview-clouds-day # cloudy sample
make preview-rain-day
make preview-snow-day
make preview-night
make preview-clouds-night
make preview-rain-night
make preview-snow-night
```

Scene shortcuts bypass power saver only in the preview; reduced motion is still
respected. Add `PREVIEW_ARGS="--headless"` to save a screenshot instead of opening a window.

This launches a nested GNOME Shell running a temporary copy of the working tree,
using the actual St/Clutter UI and stylesheet. It starts collapsed and copies your
current theme, opacity, notch order and visibility, title/date formats, widths,
hover/motion preferences and desktop text size. All module tabs remain
available with sample data. Routes, accounts, credentials and agent configuration
are not copied. Changes in preview preferences stay in its temporary settings;
they never change your desktop settings. Restart to copy newer desktop preferences.
Use `make preview PREVIEW_ARGS="--defaults"` for the original populated demo layout.
Automated `--check-*` modes always use those fixed defaults. Explicit flags such
as `--card-width`, `--text-scale`, `--motion` and `--offline-style` override copied values.
Click the notch to explore all available module tabs and open preferences. Sample playback,
seek, volume, output selection and Bluetooth controls update simulated data.
Sample Weather, routing and network status work even when the host is offline.
Use `--live` for real Weather, routing and system metrics; media/audio/Bluetooth
controls remain simulated so the preview does not switch real devices.
Open a particular module immediately with `PREVIEW_ARGS="--tab media"` (or
`system`, `audio`, `bluetooth`, `weather`, `commute`, `agents`, `calendar`).
Weather scene shortcuts open Weather automatically. The full preview includes
sample agent sessions, a simulated Quick Ask flow, a sample commute route and Calendar.
Use `make preview PREVIEW_ARGS="--tab calendar --card-width 380 --text-scale 1.5"`
to try the calendar at narrow width with enlarged text.
Agent configuration changes from preview preferences stay in temporary folders.

To inspect expansion, closing and Quick Ask motion, use
`make preview PREVIEW_ARGS="--check-motion --duration 30"`. This isolated check
temporarily slows the animation, exercises compact/full notches at both card
widths, and checks centering, the opening/closing layer hand-off, tab page
transitions, focus, reversals and reduced motion. It saves painted
frame measurements and screenshots alongside the preview log. The same flag works
with `preview-headless` for automation; it cannot be combined with other checks.

The preview window starts at **1600×1000 with 200% UI scaling**, so text, icons
and controls are larger too. Use `--scale 1` for the original 100% UI. Set the
window size independently, for example
`make preview PREVIEW_ARGS="--size 1920x1080 --scale 2"`.
At 200%, the window must be at least 1280×960. These options work with all
windowed preview targets. Headless previews keep their 1280×960/100% defaults;
they accept `--size` but do not use `--scale`. Restart an existing preview to
apply the changes.

For offline designs, use the two shortcuts above or pass
`PREVIEW_ARGS="--connection offline --offline-style icon"`. Connection choices
are `online`, `offline`, `limited`, `portal`, and `auto` (follow the host); offline
styles are `icon`, `edge`, and `hide`. These flags simulate the notch state without
changing the host connection. The style can also be changed in preview preferences.
Choose `--scene sun|clouds|rain|snow|night|clouds-night|rain-night|snow-night` and `--motion off|subtle|live` through
`PREVIEW_ARGS`. Weather motion follows your preference, or defaults to Live with
`--defaults`; normal extension preferences default to Subtle (four seconds).
Power saver and reduced motion stop animation. The explicit
`--ignore-power-saver` flag bypasses only the preview scene’s power check and
does not change the host power profile. Reduced motion is still respected.
City search in preferences still uses the network in either mode.

No installation or logout is needed. The preview has its own session bus, settings,
and cache and does not modify the installed extension. Close its window or press
Ctrl+C in the terminal to stop. After source changes, rerun the command to load a
fresh copy (there is no automatic hot reload). Each run prints its temporary log
folder and saves `notch.png` (or the selected tab, such as `weather.png`). Preview
preferences are shared between its Shell and preferences window, but do not
persist into the next preview run.

For a screenshot without opening a window:

```sh
make preview-headless
make preview-headless PREVIEW_ARGS="--check-full --duration 30" # all tabs, sample controls, Agents
make preview-headless PREVIEW_ARGS="--check-notifications --duration 150" # layouts, peek, DND, cleanup
```

The nested window validates real rendering and interactions; it cannot establish
physical monitor, hardware integration, or production-session behavior.

## Install

### From GitHub

`scripts/install-github.sh` downloads the default branch of
`mhbahmani/Ubuntu-Dynamic-Island` and runs its `scripts/install.sh` as your desktop user. It needs
`curl`, GNU tar, GLib schema tools and Fontconfig; Git, GNU Make and Node.js are
not needed for this method. Downloads have finite timeouts and HTTPS-only
redirects. Temporary files are removed on success or failure.

From a checkout, optionally select a branch, tag or commit:

```sh
sh scripts/install-github.sh
sh scripts/install-github.sh --ref TAG_OR_COMMIT
```

Replace `TAG_OR_COMMIT` with the desired version. `--ref` selects the source
archive; omitted, it uses the repository's default branch. `--repo OWNER/REPO`
selects a public fork. Run the same command
to update. The existing per-user installer backs up the previous extension,
installs its fonts and launcher, and prints logout/enable instructions.
`INSTALL_DEPS=0` skips Calendar package installation for offline/staging work.
Download, extraction and checkout-validation errors stop before installation.

### From a local checkout

```bash
make install
# Log out and back in (Wayland; do NOT use Alt+F2 'r'), then:
make enable
```

`make install` first installs missing `gir1.2-ecal-2.0` and
`gir1.2-edataserver-1.2` packages through Ubuntu administrator authentication
(`pkexec` runs only `apt-get`). Run it as your regular desktop user. Already
installed packages are skipped; cancelling or failing package installation leaves
the existing extension untouched. For offline/staging installs, use
`make install INSTALL_DEPS=0`.

`scripts/install.sh` compiles the GSettings schema and installs per-user under
`~/.local/share/gnome-shell/extensions/`. `make build` produces a versioned,
installable ZIP under `dist/`. The installer also copies bundled Vazir fonts into
`~/.local/share/fonts/ubuntu-island-vazir-v30.1.0` and refreshes their font cache.
When installing the ZIP manually, install its `assets/fonts/*.ttf` with your font
manager as well.

## Verify

```bash
gnome-shell --version        # 46.0
make status
make logs
```

## Development checks

[GNOME compatibility CI](CI.md) runs the native checks in isolated containers for
Shell 46, 48 and 50. Shell 46 is the required baseline; other versions are
experimental and do not expand the published support list.

```sh
make help                # all commands; also the default for plain `make`
make check               # Node tests, JS/Python syntax, strict schema validation
make smoke               # isolated GNOME rendering + interaction checks
make prefs-test          # actual GTK preferences (requires a desktop display)
make weather-cache-test  # real GJS cache round trip in a temporary directory
make media-test          # real MPRIS operations on a private D-Bus session
make agents-test         # local IPC, hooks, setup preservation and literal launch arguments
make verify              # all checks above plus building the extension ZIP
```

Preview options can be passed with `PREVIEW_ARGS`, for example
`make preview PREVIEW_ARGS="--duration 15"`. `make prefs`, `make enable`,
`make disable`, `make status`, and `make logs` operate on the installed extension;
preview commands operate on a temporary copy. None of the verification targets
installs the extension. `make install` changes installed files but does not reload
running Shell code; toggling enable/disable is not a replacement for logout/login
when that code has changed.
If an upgrade reports `GSettings key agents-destination not found`, reinstall the
current version and log out/back in. Retired settings remain in the schema for
compatibility with cached Shell code; their former UI options stay removed.

The Makefile wraps the existing scripts; they remain directly runnable. The tools
required are GNU Make, Python 3, Node.js (development only), GJS, GNOME Shell 46,
GLib schema tools, `dbus-run-session`, `timeout`, and `zip`. Native GTK checks need
the Ubuntu GNOME libraries and a working display.

`tests/smoke.py` starts a separate headless Shell with a private session bus,
runtime directory, and in-memory settings. It uses fixture media/device data,
captures every module face, and checks navigation, idle media, stable audio rows,
outside dismissal, Escape, rapid toggles, and disable cleanup. It leaves logs
and screenshots in the printed `/tmp/ubuntu-island-smoke-*` directory. It does
not replace the running desktop or switch physical audio/Bluetooth devices.

### Hardware acceptance

Before release, verify click/toggle behavior, MPRIS controls, metrics, audio
routing and hotplug, Bluetooth, fullscreen hiding, suspend/resume, and mixed-scale
monitors in a live GNOME 46/Wayland session. Automated checks do not replace
these hardware acceptance checks.

## Limitations

- Matte tone uses GNOME Shell 46's `Shell.BlurEffect` in background mode on the
  expanded card only (the collapsed notch never blurs). GNOME 46 blurs rectangles,
  so the rounded corners are approximated by seven slices that stay inside the
  arc; a few corner pixels stay unfrosted. Partial repaints are widened to the
  whole card; an unexpected one can show a faint smudge for one frame before it
  is corrected. Background blur previously failed to paint on some external
  monitors: if it does, set matte tone to 0 to switch it off. At 100% opacity the
  tint hides the blur, so the effect is switched off there.
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

```text
ubuntu-dynamic-island/
  extension.js            # GNOME Shell lifecycle and service wiring
  prefs.js                # GNOME preferences entry point
  metadata.json           # extension identity and supported Shell version
  stylesheet.css          # extension-scoped native styles
  ui/                     # island, notch, card, tabs and shared Shell widgets
  preferences/            # GTK settings pages, route map and shortcut editor
  services/               # async integrations, pure models and formatting
  helpers/                # isolated runtime subprocesses (Agents bridge/setup)
  assets/                 # packaged icons, weather artwork and desktop entry
  schemas/                # GSettings XML; compiled during install/build
  scripts/                # build/install, asset generation and routing probes
  tests/                  # Node tests, native smoke checks and preview fixtures
  docs/                   # usage, module and development guides, implementation handoff
  screenshots/            # README examples
  dist/                   # generated installable ZIPs (ignored by Git)
```

Keep development commands at the repository root: `make install`, `make build`,
`make check` and the preview targets are unchanged. Installed packages retain
`ui/`, `preferences/`, `services/` and `helpers/` beside the GNOME entry points;
development scripts, tests and docs are not shipped.
