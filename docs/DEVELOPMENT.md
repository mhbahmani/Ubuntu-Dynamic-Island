# Development

Run commands from the repository root. The installable extension lives in `extension/`. Its Shell widgets, GTK preferences, services and subprocesses live in `ui/`, `preferences/`, `services/` and `helpers/` within that directory. `scripts/generate/` contains the theme and artwork generators. The [editable feature tour](demo/README.md) lives alongside the documentation.

## Preview

```sh
make preview                    # isolated desktop with sample data
make preview-offline            # simulate a disconnected network
make preview-headless           # save a screenshot
make preview PREVIEW_ARGS="--defaults --tab calendar"
```

Use `make help` for scene shortcuts and `python3 tests/preview.py --help` for focused native checks. The default preview copies presentation settings. Use `--defaults` for a reproducible scene. `make preview-live` uses live providers for the sample location and route.

## Install and troubleshoot

The [README](../README.md#install) covers GitHub and clone installs. The installer needs GLib schema tools, Fontconfig and `flock`. GitHub installs also need `curl` and GNU tar. Run `make install INSTALL_DEPS=0` to skip Calendar package installation. To install a specific revision from a checkout, run `sh scripts/install.sh --ref TAG_OR_COMMIT`. Use `--help` for fork and local-source options.

The installer prints the per-user destination and the previous version's backup path. After changing code on Wayland, log out and back in to load the new version. Check `make status` and `make logs` if the extension fails to load. `make build` writes a Shell-installable ZIP under `dist/`. Manual ZIP installs also need the bundled fonts and the desktop launcher for GeoClue integration.

## Tests

```sh
make check           # Node tests, syntax and schema validation
make prefs-test      # GTK preferences (requires a display)
make media-test      # MPRIS on a private bus
make smoke           # headless GNOME Shell and simulated input
make verify          # full local suite and package build
```

Native checks need GJS, GNOME Shell 46 and its GTK/Adwaita libraries. Smoke and preview print their temporary artifact directories. Before releasing, test physical audio routing, Bluetooth, mixed-scale monitors, fullscreen windows and suspend/resume on a live Wayland desktop.

## Compatibility CI

[GitHub Actions](../.github/workflows/compatibility.yml) tests Shell 46 on Ubuntu 24.04, Shell 48 on Debian 13 and Shell 50 on Ubuntu 26.04. Shell 46 gates the workflow. The newer versions use disposable test metadata and report compatibility findings independently.

Each container runs an unprivileged headless Wayland session with software rendering, private D-Bus and fixture data. Only the GTK preferences check uses Xvfb. Open a job's summary for individual results. Its artifact contains logs, screenshots, package versions and a test ZIP.

```sh
docker build --pull --build-arg BASE_IMAGE=ubuntu:24.04 \
  --build-arg TEST_UID="$(id -u)" \
  -t ubuntu-island-ci:46 -f scripts/ci/Dockerfile scripts/ci
mkdir -p dist/ci/46
docker run --rm --init --network none --cap-drop ALL \
  --security-opt no-new-privileges --shm-size 256m \
  --memory 3g --pids-limit 1024 \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/source,readonly" \
  --mount "type=bind,source=$PWD/dist/ci/46,target=/artifacts" \
  ubuntu-island-ci:46 --shell-major 46 --artifacts /artifacts
```

For Shell 48 use `BASE_IMAGE=debian:13-slim`; for Shell 50 use
`BASE_IMAGE=ubuntu:26.04`. Change the image tag and artifact directory accordingly,
and pass `--experimental` alongside the matching `--shell-major`.
To diagnose one check, append e.g. `--check smoke` or `--check preferences` to the
container command. The workflow always runs the complete set.
