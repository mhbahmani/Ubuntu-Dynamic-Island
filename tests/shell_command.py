"""Build native Shell commands without assuming X11 is compiled in."""
import subprocess


def shell_command(mode, display, *, headless, size, test_animations=False):
    help_text = subprocess.check_output(['gnome-shell', '--help'], text=True, timeout=10)
    backend = '--headless' if headless else ('--devkit' if '--devkit' in help_text else '--nested')
    if backend not in help_text:
        raise RuntimeError(f'This GNOME Shell does not provide {backend}')
    command = ['dbus-run-session', '--', 'gnome-shell', backend, '--wayland',
               f'--wayland-display={display}', f'--mode={mode}']
    # Newer Mutter builds can omit Xwayland entirely (and this option with it).
    if '--no-x11' in help_text:
        command.append('--no-x11')
    # Shell normally inhibits animations on llvmpipe. Its test flag bypasses
    # that renderer heuristic while leaving the desktop preference effective.
    if test_animations and '--force-animations' in help_text:
        command.append('--force-animations')
    if headless:
        command.append(f'--virtual-monitor={size}')
    return command
