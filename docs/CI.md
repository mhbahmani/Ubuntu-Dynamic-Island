# GNOME compatibility CI

[The GitHub Actions workflow](../.github/workflows/compatibility.yml) runs on
pushes, pull requests, manual dispatch and a weekly schedule.

| Shell | Environment | Policy |
|---|---|---|
| 46 | Ubuntu 24.04 | Required baseline |
| 48 | Debian 13 | Experimental; reports failures without blocking the baseline |
| 50 | Ubuntu 26.04 | Experimental; reports failures without blocking the baseline |

A Shell 46 failure fails the workflow. Repository branch-protection rules are
separate; this workflow does not configure them.

Only Shell 46 is declared supported in `metadata.json`. Experimental jobs append
their version to a disposable source copy, leaving the checkout and published
metadata unchanged. Each job checks the actual installed Shell major before
testing; a changed or unavailable package cannot silently count as a pass.

## Environment

The image installs Shell, Mutter, GJS and GTK from one distribution's repositories.
Distro tags and the Node 22 image receive updates; `packages.log` records the
exact installed packages. Actions are pinned to commit hashes. The weekly run
detects regressions from package updates even when the extension has not changed.

Tests run as a non-root user with software rendering, separate HOME/XDG directories,
private D-Bus sessions and fixture data. Shell uses native headless Wayland with
a virtual monitor and an unprivileged private system bus with no host services or
service activation. Only the GTK preferences test uses Xvfb. The container has no
network, host desktop sockets, extra capabilities or privileged access; its source
mount is read-only. Credentials and host environment variables are not forwarded.
Each native run starts a fresh Shell process so cached JavaScript cannot hide a
failure. This follows GNOME's
[headless testing approach](https://blogs.gnome.org/shell-dev/2022/12/02/automated-testing-of-gnome-shell/)
and [fresh-process debugging guidance](https://gjs.guide/extensions/development/debugging.html).

## Checks and results

Every version runs the harness regression tests, `make check`, ZIP packaging,
private MPRIS and weather-cache integration tests, GTK preferences, the native
smoke suite, and focused audio, Calendar and Notifications checks. The smoke
suite exercises native animation lifecycle and reduced motion. The separate
`--check-motion` preview inspects painted frames and is best run on a desktop
where software rendering and shared runner load cannot mask those frames.
Checks continue after a failure so the report can distinguish individual failures.
Timeouts and missing PASS markers fail their respective checks.

The job summary lists each check. The `gnome-VERSION-results` artifact contains
`summary.json`, command output, native logs and screenshots, and a **test-only** ZIP.
An experimental ZIP contains probe metadata; do not distribute it as a release.
Artifacts are retained for 14 days. A green workflow does not imply every
experimental version passed: inspect its job summary and artifact.

CI tests API usage and automated interactions. It does not establish Bluetooth,
HDMI, GPU-driver, mixed-monitor or live account/provider compatibility. Promote a
version only after its checks pass and the applicable
[desktop acceptance checks](DEVELOPMENT.md#hardware-acceptance) are completed.

## Reproduce locally

Docker must already be available. Builds install dependencies inside the image;
tests do not install the extension or system packages on the host.

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

The harness regression tests also run without Docker:

```sh
python3 -m unittest discover -s tests -p test_ci.py
```
