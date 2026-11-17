#!/usr/bin/env python3
"""Run native compatibility checks in a disposable, unprivileged CI container."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time


def prepare_source(source, destination, major, experimental):
    # Copy only source needed by tests, never .git, credentials or video captures.
    destination.mkdir()
    for name in ('extension.js', 'prefs.js', 'metadata.json', 'stylesheet.css', 'Makefile'):
        shutil.copy2(source / name, destination / name)
    for name in ('ui', 'preferences', 'services', 'helpers', 'assets', 'schemas', 'scripts', 'tests'):
        shutil.copytree(source / name, destination / name,
                        ignore=shutil.ignore_patterns('node_modules', '__pycache__', '*.pyc',
                                                     'gschemas.compiled', 'readme-video'))
    path = destination / 'metadata.json'
    metadata = json.loads(path.read_text())
    if str(major) not in metadata['shell-version']:
        if not experimental:
            raise ValueError(f'Shell {major} is not declared supported; use --experimental to probe it')
        metadata['shell-version'].append(str(major))
        path.write_text(json.dumps(metadata, indent=2) + '\n')


def isolated_environment(root):
    env = {'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC',
           'XDG_CURRENT_DESKTOP': 'GNOME', 'XDG_SESSION_TYPE': 'wayland',
           'XDG_DATA_DIRS': '/usr/local/share:/usr/share', 'GSETTINGS_BACKEND': 'memory',
           'LIBGL_ALWAYS_SOFTWARE': '1', 'GALLIUM_DRIVER': 'llvmpipe',
           'GSK_RENDERER': 'cairo', 'NO_AT_BRIDGE': '1'}
    for key, name in [('HOME', 'home'), ('XDG_CONFIG_HOME', 'config'),
                      ('XDG_DATA_HOME', 'share'), ('XDG_CACHE_HOME', 'cache'),
                      ('XDG_STATE_HOME', 'state'), ('XDG_RUNTIME_DIR', 'runtime'), ('TMPDIR', 'tmp')]:
        path = root / name
        path.mkdir(mode=0o700)
        env[key] = str(path)
    return env


def run_check(name, command, cwd, env, artifacts, timeout=300):
    print(f'::group::{name}', flush=True)
    started = time.monotonic()
    status = 1
    with (artifacts / f'{name}.log').open('w') as log:
        try:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                status = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Include children (D-Bus, Xvfb, native helpers) in timeout cleanup.
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                log.write(f'\nCI timeout after {timeout}s\n')
                status = 124
        except OSError as error:
            log.write(str(error) + '\n')
    print((artifacts / f'{name}.log').read_text(errors='replace'), flush=True)
    print(f'::endgroup::\n{name}: {"PASS" if status == 0 else "FAIL"} ({status})', flush=True)
    return {'name': name, 'exit_code': status, 'seconds': round(time.monotonic() - started, 1)}


@contextmanager
def private_system_bus(root, env, artifacts):
    # Shell expects a system bus even without hardware services. This bus has
    # no activation directories and can never reach the host's system services.
    address = f'unix:path={root}/system-bus'
    config = root / 'system-bus.conf'
    config.write_text(f'''<busconfig><type>system</type><listen>{address}</listen>
<auth>EXTERNAL</auth><policy context="default">
<allow user="{os.getuid()}"/><allow own="*"/><allow send_destination="*"/>
<allow receive_sender="*"/></policy></busconfig>''')
    with (artifacts / 'system-bus.log').open('w') as log:
        process = subprocess.Popen(['dbus-daemon', '--nofork', '--nopidfile', f'--config-file={config}'],
                                   env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError('Private system bus exited; see system-bus.log')
                if (root / 'system-bus').exists():
                    break
                time.sleep(0.05)
            else:
                raise RuntimeError('Private system bus did not start')
            env['DBUS_SYSTEM_BUS_ADDRESS'] = address
            yield
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def checks():
    yield 'harness', ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_ci.py']
    yield 'check', ['make', 'check']
    yield 'build', ['make', 'build']
    yield 'media', ['make', 'media-test']
    yield 'weather', ['make', 'weather-cache-test']
    # Only GTK preferences use Xvfb; Shell itself uses native headless Wayland.
    yield 'preferences', ['dbus-run-session', '--', 'xvfb-run', '-a', 'make', 'prefs-test']
    yield 'smoke', ['make', 'smoke']
    for name in ('audio', 'calendar', 'notifications'):
        yield name, ['python3', 'tests/preview.py', '--headless', '--defaults',
                     f'--check-{name}', '--duration', '150']


def collect_artifacts(root, artifacts):
    for path in (root / 'tmp').glob('ubuntu-island-*/*'):
        if path.is_file() and path.suffix in ('.png', '.log'):
            destination = artifacts / 'native' / path.parent.name / path.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    for path in (root / 'source/dist').glob('*.zip'):
        # This package retains the probe's metadata; never publish it as a release.
        shutil.copy2(path, artifacts / ('test-only-' + path.name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shell-major', required=True, type=int)
    parser.add_argument('--experimental', action='store_true')
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--check', action='append', choices=[name for name, _ in checks()],
                        help='Run only this check (repeatable); default: all checks')
    args = parser.parse_args()
    if os.getuid() == 0:
        parser.error('Run tests as a regular user, not root')
    artifacts = args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    summary = {'expected_shell': args.shell_major, 'experimental': args.experimental, 'checks': results}
    with tempfile.TemporaryDirectory(prefix='ubuntu-island-ci-') as temporary:
        root = Path(temporary)
        env = isolated_environment(root)
        try:
            version = subprocess.check_output(['gnome-shell', '--version'], env=env, text=True, timeout=10).strip()
            summary['actual_shell'] = version
            print(version, flush=True)
            match = re.search(r'GNOME Shell (\d+)', version)
            if not match or int(match[1]) != args.shell_major:
                raise ValueError(f'Expected Shell {args.shell_major}, got {version}')
            source = Path(__file__).resolve().parents[2]
            work = root / 'source'
            prepare_source(source, work, args.shell_major, args.experimental)
            # Package versions make floating distro security updates traceable.
            run_check('packages', ['dpkg-query', '-W'], work, env, artifacts, 30)
            with private_system_bus(root, env, artifacts):
                for name, command in checks():
                    if args.check and name not in args.check:
                        continue
                    results.append(run_check(name, command, work, env, artifacts))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            summary['error'] = str(error)
            print(f'CI setup failed: {error}', flush=True)
        finally:
            collect_artifacts(root, artifacts)
            (artifacts / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    return int('error' in summary or not results or any(item['exit_code'] != 0 for item in results))


if __name__ == '__main__':
    raise SystemExit(main())
