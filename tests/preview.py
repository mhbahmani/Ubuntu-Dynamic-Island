#!/usr/bin/env python3
"""Run the working tree in a private, windowed GNOME Shell (no installation)."""
import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def preview_size(value):
    match = re.fullmatch(r'(\d{3,4})x(\d{3,4})', value)
    if not match or not (640 <= int(match[1]) <= 3840 and 480 <= int(match[2]) <= 2160):
        raise argparse.ArgumentTypeError('use WIDTHxHEIGHT, from 640x480 to 3840x2160')
    return f'{int(match[1])}x{int(match[2])}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ignore-power-saver', action='store_true', help='Allow animation in this preview even on power saver; does not change the host profile')
    parser.add_argument('--scene', choices=['sun', 'clouds', 'rain', 'snow', 'night', 'clouds-night', 'rain-night', 'snow-night'], default='clouds', help='Sample weather scene')
    parser.add_argument('--motion', choices=['off', 'subtle', 'live'], help='Override the copied weather animation preference')
    parser.add_argument('--defaults', action='store_true', help='Use fixed demo UI settings instead of copying your current preferences')
    parser.add_argument('--edit-route', action='store_true', help='Open the Commute map editor immediately')
    parser.add_argument('--preferences', choices=['appearance', 'notch', 'calendar', 'agents'], help='Open an isolated preferences page alongside the preview')
    parser.add_argument('--tab', choices=['notch', 'media', 'system', 'audio', 'bluetooth', 'weather', 'commute', 'agents', 'notifications', 'calendar'], default='notch', help='Start collapsed (notch, default), or open a module')
    parser.add_argument('--connection', choices=['auto', 'online', 'offline', 'limited', 'portal'], help='Simulate connection status; defaults to online for samples, auto with --live')
    parser.add_argument('--offline-style', choices=['icon', 'edge', 'hide'], help='Override the copied offline notch design')
    parser.add_argument('--check-full', action='store_true', help='Check populated notch, all tabs and sample device controls (headless sample mode)')
    parser.add_argument('--check-audio', action='store_true', help='Check Sound controls and headphone battery layouts (headless samples)')
    parser.add_argument('--check-calendar', action='store_true', help='Check calendar modes, keyboard access and scaled layouts (headless)')
    parser.add_argument('--check-notifications', action='store_true', help='Check notification rows, peek, policy and cleanup (headless samples)')
    parser.add_argument('--check-commute', action='store_true', help='Check provider credits and traffic tooltips (headless samples)')
    parser.add_argument('--check-motion', action='store_true', help='Check centered expansion, Quick Ask and interrupted motion (sample mode)')
    parser.add_argument('--check-input', action='store_true', help='Exercise dismissal, reopening and the top-bar menu')
    parser.add_argument('--live', action='store_true', help='Use live weather, routing and system metrics; media/audio/Bluetooth remain simulated')
    parser.add_argument('--headless', action='store_true', help='Render without a window; saves notch.png or the selected tab')
    parser.add_argument('--size', type=preview_size, metavar='WIDTHxHEIGHT', help='Preview resolution (default: 1600x1000 windowed, 1280x960 headless)')
    parser.add_argument('--scale', type=int, choices=[1, 2], help='Windowed UI scale: 1 = 100%%, 2 = 200%% (default: 2)')
    parser.add_argument('--card-width', type=int, choices=[380, 440, 480], help='Override the copied card width in logical pixels')
    parser.add_argument('--text-scale', type=float, choices=[1, 1.5, 2], help='Override the copied desktop text size multiplier')
    parser.add_argument('--calendar-date', type=date.fromisoformat, metavar='YYYY-MM-DD', help='Select a civil date in the calendar preview')
    parser.add_argument('--duration', type=int, default=0, help='Exit after N seconds (default: until window closes or Ctrl+C)')
    args = parser.parse_args()
    if args.check_audio and (not args.headless or args.live or any(value for key, value in vars(args).items() if key.startswith('check_') and key != 'check_audio')):
        parser.error('--check-audio requires headless sample mode without other checks')
    if args.check_commute and (not args.headless or args.live or args.check_full or args.check_calendar or args.check_input or args.check_motion):
        parser.error('--check-commute requires headless sample mode without other checks')
    if args.check_notifications and (not args.headless or args.live or args.check_full or args.check_calendar or args.check_input or args.check_motion or args.check_commute):
        parser.error('--check-notifications requires headless sample mode without other checks')
    if args.edit_route and args.tab == 'notch':
        args.tab = 'commute'
    if args.check_full and (not args.headless or args.live or args.tab != 'notch' or args.check_input):
        parser.error('--check-full requires --headless sample mode with the default notch and without --check-input')
    if args.check_input and not args.headless:
        parser.error('--check-input requires --headless (nested virtual-pointer coordinates differ)')
    if args.check_calendar and (not args.headless or args.check_full or args.check_input):
        parser.error('--check-calendar requires --headless without other check modes')
    if args.check_motion and (args.live or args.tab != 'notch' or args.check_full or args.check_calendar or args.check_input):
        parser.error('--check-motion requires sample mode with the default notch and no other check mode')
    if args.duration < 0:
        parser.error('--duration must be nonnegative')
    if args.headless and args.scale is not None:
        parser.error('--scale applies to windowed previews; headless previews use their normal test scale')
    scale = args.scale or 2
    size = args.size or ('1280x960' if args.headless else '1600x1000')
    width, height = map(int, size.split('x'))
    if not args.headless and (width < 640 * scale or height < 480 * scale):
        parser.error(f'--scale {scale} needs at least {640 * scale}x{480 * scale}; increase --size or use --scale 1')
    source = Path(__file__).resolve().parents[1]
    root = Path(tempfile.mkdtemp(prefix='ubuntu-island-preview-'))
    uuid = 'ubuntu-island@mhbahmani.github.io'
    extension = root / 'share/gnome-shell/extensions' / uuid
    extension.mkdir(parents=True)
    for path in source.glob('*.js'):
        shutil.copy2(path, extension / path.name)
    for name in ('ui', 'preferences', 'services', 'schemas', 'assets', 'helpers'):
        shutil.copytree(source / name, extension / name)
    for name in ('metadata.json', 'stylesheet.css'):
        shutil.copy2(source / name, extension / name)
    shutil.copytree(source / 'assets/fonts', root / 'share/fonts/ubuntu-island', dirs_exist_ok=True)
    # Retain the user's Persian font in this isolated session, without changing
    # or installing any host fonts. Other machines exercise the CSS fallback.
    fonts = subprocess.run(['fc-list', '-f', '%{family}\t%{file}\n'],
                           capture_output=True, text=True, check=True).stdout
    for entry in fonts.splitlines():
        family, path = entry.split('\t', 1)
        if any(name in ('Vazir', 'Vazirmatn') for name in family.split(',')):
            destination = root / 'share/fonts'
            destination.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination / Path(path).name)
    (extension / 'extension.js').rename(extension / 'implementation.js')
    shutil.copy2(source / 'tests/fixtures/local-preview.js', extension / 'extension.js')
    shutil.copy2(source / 'tests/fixtures/preview-data.js', extension / 'preview-data.js')
    shutil.copy2(source / 'tests/fixtures/preview-settings.js', extension / 'preview-settings.js')
    shutil.copy2(source / 'tests/fixtures/motion-check.js', extension / 'motion-check.js')
    shutil.copy2(source / 'tests/fixtures/local-preferences.mjs', extension / 'local-preferences.mjs')
    subprocess.run(['glib-compile-schemas', '--strict', str(extension / 'schemas')], check=True)
    # Check modes must stay reproducible regardless of the developer's desktop.
    checks = any(value for key, value in vars(args).items() if key.startswith('check_')) or any(
        value == '1' for key, value in os.environ.items() if key.startswith('ISLAND_PREVIEW_CHECK_'))
    ui_settings = ''
    if not args.defaults and not checks:
        result = subprocess.run(['gjs', '-m', str(source / 'scripts/preview-settings.mjs'), str(extension / 'schemas')],
                                capture_output=True, text=True, check=True, timeout=5)
        ui_settings = json.dumps(json.loads(result.stdout))
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
                       ISLAND_PREVIEW_CHECK_AUDIO='1' if args.check_audio else '0',
                       ISLAND_PREVIEW_CHECK_CALENDAR='1' if args.check_calendar else '0',
                       ISLAND_PREVIEW_CHECK_COMMUTE='1' if args.check_commute else '0',
                       ISLAND_PREVIEW_CHECK_MOTION='1' if args.check_motion else '0',
                       ISLAND_PREVIEW_CHECK_NOTIFICATIONS='1' if args.check_notifications else '0',
                       ISLAND_PREVIEW_UI_SETTINGS=ui_settings,
                       ISLAND_PREVIEW_CARD_WIDTH=str(args.card_width) if args.card_width is not None else '',
                       ISLAND_PREVIEW_TEXT_SCALE=str(args.text_scale) if args.text_scale is not None else '',
                       ISLAND_PREVIEW_CALENDAR_DATE=args.calendar_date.isoformat() if args.calendar_date else '',
                       ISLAND_PREVIEW_PREFERENCES=args.preferences or '',
                       ISLAND_PREVIEW_CONNECTION=args.connection or ('auto' if args.live else 'online'),
                       ISLAND_PREVIEW_OFFLINE_STYLE=args.offline_style or '',
                       ISLAND_PREVIEW_CHECK_INPUT='1' if args.check_input else '0',
                       ISLAND_PREVIEW_IGNORE_POWER='1' if args.ignore_power_saver else '0', ISLAND_PREVIEW_SCENE=args.scene, ISLAND_PREVIEW_MOTION=args.motion or '',
                       ISLAND_PREVIEW_EDIT_ROUTE='1' if args.edit_route else '0', ISLAND_PREVIEW_TAB=args.tab, ISLAND_PREVIEW_LIVE='1' if args.live else '0')
    command = ['dbus-run-session', '--', 'gnome-shell',
               '--headless' if args.headless else '--nested', '--wayland', '--no-x11',
               '--wayland-display=island-preview', '--mode=island-preview']
    if args.headless:
        command.append(f'--virtual-monitor={size}')
    else:
        # GNOME 46's nested backend otherwise selects its 800x600 default mode.
        # This only changes the private child compositor, never the host display.
        environment['MUTTER_DEBUG_DUMMY_MODE_SPECS'] = size
        environment['MUTTER_DEBUG_DUMMY_MONITOR_SCALES'] = str(scale)
    print(f"{'Live' if args.live else 'Sample'} {args.tab} preview ({size}, {100 if args.headless else scale * 100}% UI). Logs/screenshots: {root}", flush=True)
    print('UI settings: ' + ('copied from your desktop; preview edits are temporary.' if ui_settings else 'fixed demo defaults.'), flush=True)
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
    if args.check_audio and ('[Island Preview] AUDIO PASS' not in output or '[Island Preview] AUDIO FAIL' in output):
        return 1
    if args.check_full and ('[Island Preview] FULL PASS' not in output or '[Island Preview] FULL FAIL' in output):
        return 1
    if args.check_calendar and ('[Island Preview] CALENDAR PASS' not in output or '[Island Preview] CALENDAR FAIL' in output):
        return 1
    if args.check_commute and ('[Island Preview] COMMUTE PASS' not in output or '[Island Preview] COMMUTE FAIL' in output):
        return 1
    if args.check_notifications and ('[Island Preview] NOTIFICATIONS PASS' not in output or '[Island Preview] NOTIFICATIONS FAIL' in output):
        return 1
    if args.check_motion and ('[Island Preview] MOTION PASS' not in output or '[Island Preview] MOTION FAIL' in output):
        return 1
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    raise SystemExit(main())
