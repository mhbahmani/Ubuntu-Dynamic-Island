#!/usr/bin/env python3
"""Render/test the real extension in an isolated GNOME 46 headless session.

Uses fixture model data, a private session bus and temporary settings/runtime.
Does not replace the running desktop or write its extension installation.
Keeps screenshots and logs in the printed temporary directory for inspection.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


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
    with (root / "runtime.log").open("w") as output:
        subprocess.run(["timeout", "90s", "dbus-run-session", "--", "gnome-shell", "--headless",
                        "--wayland", "--wayland-display=island-smoke", "--no-x11", "--mode=island-smoke", "--virtual-monitor=1280x960"],
                       env=environment, stdout=output, stderr=subprocess.STDOUT, check=False)
    log = (root / "runtime.log").read_text()
    results = [line for line in log.splitlines() if "[Island Smoke]" in line]
    print("\n".join(results) or "No smoke results; inspect runtime.log")
    return 0 if ("[Island Smoke] PASS:" in log and "[Island Smoke] FAIL" not in log
                 and "JS ERROR" not in log and "g_object_unref: assertion" not in log) else 1


if __name__ == "__main__":
    raise SystemExit(main())
