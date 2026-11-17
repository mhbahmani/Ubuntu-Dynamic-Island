#!/usr/bin/env python3
"""Record only a private GNOME session with bundled fictional fixture data."""
import os
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    project = Path(__file__).resolve().parent
    repository = project.parent.parent
    root = Path(tempfile.mkdtemp(prefix='ubuntu-island-video-'))
    source = root / 'source'
    source.mkdir()
    for name in ('ui', 'preferences', 'services', 'schemas', 'assets', 'helpers', 'tests'):
        shutil.copytree(repository / name, source / name)
    for name in ('extension.js', 'prefs.js', 'metadata.json', 'stylesheet.css'):
        shutil.copy2(repository / name, source / name)
    # Clean presentation labels in the private fixture copy; keep data isolated.
    for name in ('preview-data.js', 'local-preview.js', 'local-preferences.mjs'):
        path = source / 'tests/fixtures' / name
        path.write_text(re.sub(r" \(sample\)(?=['\"])", '', path.read_text())
                        .replace('Preview player', 'Music player')
                        .replace("'sample-1'", "'4c9e7a2f'")
                        .replace("'sample-2'", "'b8d3f601'")
                        .replace("'sample-3'", "'a7e2c9d4'")
                        .replace('emitCommute({...state, sample: true})', 'emitCommute({...state, sample: false})'))
    fixture = source / 'tests/fixtures/local-preview.js'
    text = fixture.read_text()
    text = "import {recordTour} from './readme-tour.js';\n" + text
    marker = '            const monitor = Main.layoutManager.primaryMonitor;'
    assert marker in text
    text = text.replace(marker, "            recordTour(this).catch(error => console.error(`[README Video] FAIL: ${error.message}: ${error.stack}`));\n" + marker, 1)
    # Explicitly empty event selection before the real extension constructs any services.
    text = text.replace('        super.enable();', "        settings.set_strv('calendar-event-sources', []);\n        settings.set_boolean('calendar-events-enabled', false);\n        super.enable();")
    fixture.write_text(text)
    preview = source / 'tests/preview.py'
    text = preview.read_text().replace("    shutil.copy2(source / 'tests/fixtures/preview-data.js', extension / 'preview-data.js')", "    shutil.copy2(source / 'tests/fixtures/preview-data.js', extension / 'preview-data.js')\n    for name in ('readme-tour.js', 'readme-fixtures.js', 'preferences-tour.js'):\n        shutil.copy2(source / 'tests/fixtures' / name, extension / name)")
    text = text.replace("'enabledExtensions': [uuid]", "'enabledExtensions': [uuid, 'ubuntu-dock@ubuntu.com']")
    preview.write_text(text)
    shutil.copy2(project / 'tour.js', source / 'tests/fixtures/readme-tour.js')
    shutil.copy2(project / 'fixtures.js', source / 'tests/fixtures/readme-fixtures.js')
    shutil.copy2(project / 'preferences-tour.js', source / 'tests/fixtures/preferences-tour.js')
    shutil.copytree(project / 'assets', source / 'assets/video')
    preferences = source / 'tests/fixtures/local-preferences.mjs'
    preferences.write_text("import {runPreferencesTour} from './preferences-tour.js';\n" + preferences.read_text().replace(
        'window.present();', "window.present();\nrunPreferencesTour(window, new Preferences(metadata).getSettings()).catch(error => console.error(error));"))
    fixture.write_text(fixture.read_text().replace("WAYLAND_DISPLAY: 'island-preview', GDK_BACKEND: 'wayland',", "WAYLAND_DISPLAY: 'island-preview', GDK_BACKEND: 'wayland', GDK_SCALE: '2', GDK_DPI_SCALE: '1',"))
    for name in ('preview-data.js', 'local-preview.js', 'local-preferences.mjs'):
        subprocess.run(['node', '--check', str(source / 'tests/fixtures' / name)], check=True)
    isolated_home = root / 'home'
    isolated_home.mkdir()
    env = dict(os.environ)
    for key in ('DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY', 'PULSE_SERVER', 'PIPEWIRE_REMOTE'):
        env.pop(key, None)
    env.update(HOME=str(isolated_home), XDG_CONFIG_HOME=str(root / 'config'),
               XDG_CACHE_HOME=str(root / 'cache'), XDG_DATA_HOME=str(root / 'data'),
               ISLAND_VIDEO_OUTPUT=str(root), ISLAND_VIDEO_PROBE=os.environ.get('ISLAND_VIDEO_PROBE', '0'))
    print(f'Private capture: {root}', flush=True)
    result = subprocess.run(['python3', str(preview), '--headless', '--defaults', '--size', '2560x1440',
                    '--ignore-power-saver', '--duration', '55' if env['ISLAND_VIDEO_PROBE'] == '1' else '90'], env=env, check=False, start_new_session=True)
    if not (root / 'complete.json').exists():
        raise RuntimeError(f'Recording did not complete; inspect logs in {root}')
    if result.returncode not in (0, 143, -15):
        raise RuntimeError(f'Private preview exited with {result.returncode}; inspect {root}')
    destination = project / 'public'
    destination.mkdir(exist_ok=True)
    metadata = json.loads((root / 'complete.json').read_text())
    suffix = '-probe' if env['ISLAND_VIDEO_PROBE'] == '1' else ''
    shutil.copy2(metadata['path'], destination / f'tour{suffix}.raw.mp4')
    shutil.copy2(root / 'complete.json', destination / f'capture{suffix}.json')
    shutil.copy2(root / 'desktop.png', destination / f'desktop{suffix}.png')
    print(f'Recorded fictional demo: {destination / f"tour{suffix}.raw.mp4"}')


if __name__ == '__main__':
    main()
