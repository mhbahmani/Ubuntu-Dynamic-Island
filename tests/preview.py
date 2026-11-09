#!/usr/bin/env python3
"""Run the working tree in a private, windowed GNOME Shell (no installation)."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ignore-power-saver', action='store_true', help='Allow animation in this preview even on power saver; does not change the host profile')
    parser.add_argument('--scene', choices=['sun', 'clouds', 'rain', 'snow', 'night', 'clouds-night', 'rain-night', 'snow-night'], default='clouds', help='Sample weather scene')
    parser.add_argument('--motion', choices=['off', 'subtle', 'live'], default='live', help='Preview animation mode')
    parser.add_argument('--edit-route', action='store_true', help='Open the Commute map editor immediately')
    parser.add_argument('--tab', choices=['notch', 'media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents'], default='notch', help='Start collapsed (notch, default), or open a module')
    parser.add_argument('--connection', choices=['auto', 'online', 'offline', 'limited', 'portal'], help='Simulate connection status; defaults to online for samples, auto with --live')
    parser.add_argument('--offline-style', choices=['icon', 'edge', 'hide'], default='icon', help='Initial offline notch design; can also change it in preferences')
    parser.add_argument('--check-full', action='store_true', help='Check populated notch, all tabs and sample device controls (headless sample mode)')
    parser.add_argument('--check-input', action='store_true', help='Exercise dismissal, reopening and the top-bar menu')
    parser.add_argument('--live', action='store_true', help='Use live weather, routing and system metrics; media/audio/Bluetooth remain simulated')
    parser.add_argument('--headless', action='store_true', help='Render without a window; saves notch.png or the selected tab')
    parser.add_argument('--duration', type=int, default=0, help='Exit after N seconds (default: until window closes or Ctrl+C)')
    args = parser.parse_args()
    if args.edit_route and args.tab == 'notch':
        args.tab = 'commute'
    if args.check_full and (not args.headless or args.live or args.tab != 'notch' or args.check_input):
        parser.error('--check-full requires --headless sample mode with the default notch and without --check-input')
    if args.check_input and not args.headless:
        parser.error('--check-input requires --headless (nested virtual-pointer coordinates differ)')
    if args.duration < 0:
        parser.error('--duration must be nonnegative')
    source = Path(__file__).resolve().parents[1]
    root = Path(tempfile.mkdtemp(prefix='ubuntu-island-preview-'))
    uuid = 'ubuntu-island@mhbahmani.github.io'
    extension = root / 'share/gnome-shell/extensions' / uuid
    extension.mkdir(parents=True)
    for path in source.glob('*.js'):
        shutil.copy2(path, extension / path.name)
    for name in ('services', 'schemas', 'assets', 'helpers'):
        shutil.copytree(source / name, extension / name)
    for name in ('metadata.json', 'stylesheet.css'):
        shutil.copy2(source / name, extension / name)
    (extension / 'extension.js').rename(extension / 'implementation.js')
    shutil.copy2(source / 'tests/fixtures/local-preview.js', extension / 'extension.js')
    shutil.copy2(source / 'tests/fixtures/preview-data.js', extension / 'preview-data.js')
    shutil.copy2(source / 'tests/fixtures/local-preferences.mjs', extension / 'local-preferences.mjs')
    subprocess.run(['glib-compile-schemas', '--strict', str(extension / 'schemas')], check=True)
    apps = root / 'share/applications'
    apps.mkdir(parents=True)
    shutil.copy2(source / 'assets/ubuntu-island.desktop', apps / 'ubuntu-island.desktop')
    mode = root / 'share/gnome-shell/modes/island-preview.json'
    mode.parent.mkdir(parents=True)
    mode.write_text(json.dumps({'parentMode': 'user', 'enabledExtensions': [uuid],
                               'showWelcomeDialog': False, 'components': []}))
    runtime = root / 'runtime'
    runtime.mkdir(mode=0o700)
    environment = dict(os.environ)
    # Mutter must still find the host compositor after isolating XDG_RUNTIME_DIR.
    display = environment.get('WAYLAND_DISPLAY')
    if display and not os.path.isabs(display):
        environment['WAYLAND_DISPLAY'] = str(Path(environment.get('XDG_RUNTIME_DIR', '/run/user/' + str(os.getuid()))) / display)
    environment.update(XDG_RUNTIME_DIR=str(runtime), XDG_DATA_HOME=str(root / 'share'),
                       XDG_CONFIG_HOME=str(root / 'config'), XDG_CACHE_HOME=str(root / 'cache'),
                       XDG_DATA_DIRS=f'{root}/share:/usr/local/share:/usr/share', XDG_CURRENT_DESKTOP='GNOME',
                       GSETTINGS_BACKEND='keyfile', ISLAND_PREVIEW_OUTPUT=str(root),
                       ISLAND_PREVIEW_CHECK_FULL='1' if args.check_full else '0',
                       ISLAND_PREVIEW_CONNECTION=args.connection or ('auto' if args.live else 'online'),
                       ISLAND_PREVIEW_OFFLINE_STYLE=args.offline_style,
                       ISLAND_PREVIEW_CHECK_INPUT='1' if args.check_input else '0',
                       ISLAND_PREVIEW_IGNORE_POWER='1' if args.ignore_power_saver else '0', ISLAND_PREVIEW_SCENE=args.scene, ISLAND_PREVIEW_MOTION=args.motion,
                       ISLAND_PREVIEW_EDIT_ROUTE='1' if args.edit_route else '0', ISLAND_PREVIEW_TAB=args.tab, ISLAND_PREVIEW_LIVE='1' if args.live else '0')
    command = ['dbus-run-session', '--', 'gnome-shell',
               '--headless' if args.headless else '--nested', '--wayland', '--no-x11',
               '--wayland-display=island-preview', '--mode=island-preview']
    if args.headless:
        command.append('--virtual-monitor=1280x960')
    print(f"{'Live' if args.live else 'Sample'} {args.tab} preview. Logs/screenshots: {root}", flush=True)
    print('Close the preview window or press Ctrl+C to stop. Rerun after editing source.', flush=True)
    with (root / 'runtime.log').open('w') as log:
        process = subprocess.Popen(command, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=args.duration or (12 if args.headless else None))
        except (KeyboardInterrupt, subprocess.TimeoutExpired):
            import signal
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = 0
    output = (root / 'runtime.log').read_text()
    ready = '[Island Preview] READY' in output
    print('\n'.join(line for line in output.splitlines() if '[Island Preview]' in line))
    if not ready:
        print(f'Preview did not initialize. See {root / "runtime.log"}')
        return 1
    if 'Clutter:ERROR' in output or 'Bail out!' in output or 'JS ERROR' in output:
        print(f'Preview crashed. See {root / "runtime.log"}')
        return 1
    if args.check_input and '[Island Preview] INPUT PASS' not in output:
        return 1
    if args.check_full and ('[Island Preview] FULL PASS' not in output or '[Island Preview] FULL FAIL' in output):
        return 1
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    raise SystemExit(main())
