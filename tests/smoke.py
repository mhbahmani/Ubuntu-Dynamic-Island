#!/usr/bin/env python3
"""Render/test the real extension in an isolated GNOME headless session.

Uses fixture model data, a private session bus and temporary settings/runtime.
Does not replace the running desktop or write its extension installation.
Keeps screenshots and logs in the printed temporary directory for inspection.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import re
import signal
import tempfile
import time
from shell_command import shell_command

SMOKE_TIMEOUT = 240
# The fixture's last line: the overall PASS summary or the first failure.
FINAL_RESULT = re.compile(r"\[Island Smoke\] (PASS:|FAIL)")
EXTENSION_ERROR = re.compile(r"Extension ubuntu-island@mhbahmani\.github\.io: (?:\w*Error:|Exception:)")


def stop_session(session):
    """End timeout, dbus-run-session and gnome-shell together."""
    for sig, wait in ((signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(session.pid, sig)
        except ProcessLookupError:
            return
        try:
            session.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def main():
    source = Path(__file__).resolve().parents[1]
    root = Path(tempfile.mkdtemp(prefix="ubuntu-island-smoke-"))
    extension = root / "share/gnome-shell/extensions/ubuntu-island@mhbahmani.github.io"
    extension.mkdir(parents=True)
    for path in source.glob("*.js"):
        shutil.copy2(path, extension / path.name)
    for name in ("ui", "preferences", "services", "schemas", "assets", "helpers"):
        shutil.copytree(source / name, extension / name)
    for name in ("metadata.json", "stylesheet.css"):
        shutil.copy2(source / name, extension / name)
    shutil.copytree(source / 'assets/fonts', root / 'share/fonts/ubuntu-island', dirs_exist_ok=True)
    (extension / "tests").mkdir()
    shutil.copy2(source / "tests/fixtures/preview-window.mjs", extension / "tests/preview-window.mjs")
    (extension / "extension.js").rename(extension / "implementation.js")
    shutil.copy2(source / "tests/fixtures/smoke-extension.js", extension / "extension.js")
    subprocess.run(["glib-compile-schemas", "--strict", str(extension / "schemas")], check=True)
    mode = root / "share/gnome-shell/modes/island-smoke.json"
    mode.parent.mkdir(parents=True)
    mode.write_text(json.dumps({"parentMode": "user", "enabledExtensions": ["ubuntu-island@mhbahmani.github.io"],
                                "showWelcomeDialog": False, "components": []}))
    runtime = root / "runtime"
    runtime.mkdir(mode=0o700)
    environment = dict(os.environ, XDG_CURRENT_DESKTOP="GNOME", XDG_RUNTIME_DIR=str(runtime),
                       XDG_DATA_HOME=str(root / "share"), XDG_CONFIG_HOME=str(root / "config"),
                       XDG_CACHE_HOME=str(root / "cache"), GSETTINGS_BACKEND="memory",
                       XDG_DATA_DIRS=f"{root}/share:/usr/local/share:/usr/share", ISLAND_SMOKE_OUTPUT=str(root))
    print(f"Screenshots and logs: {root}", flush=True)
    log_path = root / "runtime.log"
    timed_out = False
    with log_path.open("w") as output:
        # The fixture never ends the Shell itself. End the session shortly
        # after its final PASS/FAIL line. Software-rendered CI can take longer
        # than a desktop; SMOKE_TIMEOUT is only the backstop for a hung session.
        session = subprocess.Popen(["timeout", f"{SMOKE_TIMEOUT}s", *shell_command(
                        'island-smoke', 'island-smoke', headless=True, size='1280x960', test_animations=True)],
                       env=environment, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        finished_at = None
        while session.poll() is None:
            time.sleep(0.5)
            if finished_at is None:
                log = log_path.read_text(errors="replace")
                if FINAL_RESULT.search(log) or EXTENSION_ERROR.search(log):
                    finished_at = time.monotonic()
            # Leave time for trailing JS errors or unref assertions to be logged.
            if finished_at is not None and time.monotonic() - finished_at >= 2:
                stop_session(session)
        timed_out = session.returncode == 124
    log = log_path.read_text(errors="replace")
    results = [line for line in log.splitlines() if "[Island Smoke]" in line or EXTENSION_ERROR.search(line)]
    print("\n".join(results) or "No smoke results; inspect runtime.log")
    if timed_out:
        print(f"Smoke session timed out after {SMOKE_TIMEOUT} s before finishing", flush=True)
    return 0 if ("[Island Smoke] PASS:" in log and "[Island Smoke] FAIL" not in log
                 and not EXTENSION_ERROR.search(log) and "JS ERROR" not in log
                 and "g_object_unref: assertion" not in log) else 1


if __name__ == "__main__":
    raise SystemExit(main())
