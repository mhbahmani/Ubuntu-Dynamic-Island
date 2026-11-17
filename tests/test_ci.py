"""Regression checks for isolation, version gates, failures and Shell launch flags."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

from shell_command import shell_command

spec = importlib.util.spec_from_file_location('ci_runner', Path(__file__).resolve().parents[1] / 'scripts/ci/run.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class CompatibilityHarness(unittest.TestCase):
    def test_wrong_shell_version_fails_before_running_tests(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch('sys.argv', ['run.py', '--shell-major', '46', '--artifacts', directory]), \
                patch.object(runner.os, 'getuid', return_value=1000), \
                patch.object(runner.subprocess, 'check_output', return_value='GNOME Shell 50.1\n'), \
                patch.object(runner, 'prepare_source') as prepare:
            self.assertEqual(runner.main(), 1)
            prepare.assert_not_called()
            report = json.loads((Path(directory) / 'summary.json').read_text())
            self.assertEqual(report['checks'], [])
            self.assertIn('Expected Shell 46', report['error'])

    def test_system_bus_is_private_and_stops_after_use(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = runner.isolated_environment(root)
            with runner.private_system_bus(root, env, root):
                command = ['gdbus', 'call', '--address', env['DBUS_SYSTEM_BUS_ADDRESS'],
                           '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
                           '--method', 'org.freedesktop.DBus.ListNames']
                names = subprocess.check_output(command, env=env, text=True, timeout=5)
                self.assertIn('org.freedesktop.DBus', names)
                self.assertNotIn('org.freedesktop.login1', names)
                self.assertNotIn('org.freedesktop.NetworkManager', names)
            self.assertNotEqual(subprocess.run(command, env=env, capture_output=True, timeout=5).returncode, 0)

    def test_environment_does_not_inherit_desktop_or_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                'DISPLAY': ':0', 'DBUS_SESSION_BUS_ADDRESS': 'private', 'GH_TOKEN': 'test-secret'}):
            env = runner.isolated_environment(Path(directory))
            for name in ('DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'GH_TOKEN'):
                self.assertNotIn(name, env)
            self.assertEqual(Path(env['XDG_RUNTIME_DIR']).stat().st_mode & 0o777, 0o700)
            self.assertEqual(env['HOME'], str(Path(directory) / 'home'))

    def test_experimental_metadata_is_only_changed_in_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'original'
            source.mkdir()
            for name in ('extension.js', 'prefs.js', 'stylesheet.css', 'Makefile'):
                (source / name).write_text('')
            for name in ('ui', 'preferences', 'services', 'helpers', 'assets', 'schemas', 'scripts', 'tests'):
                (source / name).mkdir()
            original = '{"shell-version": ["46"]}\n'
            (source / 'metadata.json').write_text(original)
            with self.assertRaisesRegex(ValueError, 'not declared supported'):
                runner.prepare_source(source, root / 'rejected', 48, False)
            runner.prepare_source(source, root / 'probe', 48, True)
            self.assertEqual(json.loads((root / 'probe/metadata.json').read_text())['shell-version'], ['46', '48'])
            self.assertEqual((source / 'metadata.json').read_text(), original)
            runner.prepare_source(source, root / 'baseline', 46, False)
            self.assertEqual((root / 'baseline/metadata.json').read_text(), original)

    def test_failing_and_timed_out_checks_keep_logs_and_failure_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = runner.run_check('failure', ['sh', '-c', 'echo diagnostic; exit 7'],
                                      root, os.environ.copy(), root)
            self.assertEqual(result['exit_code'], 7)
            self.assertIn('diagnostic', (root / 'failure.log').read_text())
            result = runner.run_check('timeout', ['sleep', '30'], root, os.environ.copy(), root, timeout=0.05)
            self.assertEqual(result['exit_code'], 124)
            self.assertIn('CI timeout', (root / 'timeout.log').read_text())

    def test_launch_flags_follow_available_backend(self):
        with patch('shell_command.subprocess.check_output', return_value='--headless --nested --no-x11 --force-animations'):
            command = shell_command('test', 'test', headless=True, size='1280x960', test_animations=True)
            self.assertIn('--headless', command)
            self.assertIn('--no-x11', command)
            self.assertIn('--force-animations', command)
            self.assertIn('--virtual-monitor=1280x960', command)
        with patch('shell_command.subprocess.check_output', return_value='--headless --devkit'):
            command = shell_command('test', 'test', headless=False, size='1280x960')
            self.assertIn('--devkit', command)
            self.assertNotIn('--no-x11', command)
        with patch('shell_command.subprocess.check_output', return_value='--nested'):
            with self.assertRaisesRegex(RuntimeError, 'headless'):
                shell_command('test', 'test', headless=True, size='1280x960')


if __name__ == '__main__':
    unittest.main()
