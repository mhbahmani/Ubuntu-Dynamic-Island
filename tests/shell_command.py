"""Build native Shell commands without assuming X11 is compiled in."""
import os
import signal
import subprocess
import time


def stop_process_group(process, grace=5):
    """Stop a session started with start_new_session and wait for all of it.

    Waiting only for the leader lets Shell children keep writing into TMPDIR
    while the caller (or the CI harness) removes it.
    """
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        else:
            continue
        break
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass


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
