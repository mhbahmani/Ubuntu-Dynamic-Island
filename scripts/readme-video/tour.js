// Loaded only into capture.py's temporary GNOME session. Never installed.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {configureDemo, DEMO_DAYS} from './readme-fixtures.js';

const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const call = (method, parameters) => new Promise((resolve, reject) => Gio.DBus.session.call(
    'org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast', 'org.gnome.Shell.Screencast',
    method, parameters, null, Gio.DBusCallFlags.NONE, 25000, null, (bus, result) => {
        try { resolve(bus.call_finish(result).deepUnpack()); } catch (error) { reject(error); }
    }));
const readJSON = path => JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1]));
function waitForFile(path, timeout = 40000) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(path);
        const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
            monitor.cancel(); reject(new Error(`Timed out waiting for ${file.get_basename()}`)); return GLib.SOURCE_REMOVE;
        });
        monitor.connect('changed', (_monitor, _file, _other, event) => {
            if (event !== Gio.FileMonitorEvent.CHANGES_DONE_HINT) return;
            GLib.Source.remove(timer); monitor.cancel(); resolve(readJSON(path));
        });
    });
}

export async function recordTour(preview) {
    const output = GLib.getenv('ISLAND_VIDEO_OUTPUT');
    const probe = GLib.getenv('ISLAND_VIDEO_PROBE') === '1';
    await configureDemo(preview);
    Main.panel.statusArea.dateMenu.container.hide();
    const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    background.set_string('picture-uri', 'file:///usr/share/backgrounds/warty-final-ubuntu.png');
    background.set_string('picture-uri-dark', 'file:///usr/share/backgrounds/warty-final-ubuntu.png');
    background.set_string('picture-options', 'zoom');
    new Gio.Settings({schema_id: 'org.gnome.shell'}).set_strv('favorite-apps',
        ['org.gnome.Nautilus.desktop', 'org.gnome.Terminal.desktop', 'org.gnome.Calendar.desktop', 'org.gnome.Settings.desktop']);
    const dockSettings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.dash-to-dock'});
    dockSettings.set_boolean('dock-fixed', true);
    dockSettings.set_boolean('intellihide', false);
    dockSettings.set_boolean('autohide', false);
    dockSettings.set_int('dash-max-icon-size', 40);
    const dockModule = await import('file:///usr/share/gnome-shell/extensions/ubuntu-dock@ubuntu.com/extension.js');
    const neutral = new St.Widget({width: 2560, height: 1440, opacity: 0,
        style: 'background-color: #111318;'});
    Main.layoutManager._backgroundGroup.add_child(neutral);
    const fadeDesktop = opacity => {
        neutral.ease({opacity, duration: 1800, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
        Main.panel.ease({opacity: 255 - opacity, duration: 1800, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
        for (const dock of dockModule.dockManager?._allDocks ?? [])
            dock.ease({opacity: 255 - opacity, duration: 1800, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
    };
    const click = async actor => { actor.emit('clicked', 1); await delay(40); };
    const page = async name => {
        await click(preview._card._tabs.get(name));
        if (preview._card._page !== name) throw new Error(`Tab ${name} did not activate`);
    };
    // No hardware discovery and no host PipeWire socket in this private runtime.
    for (const directory of ['main.lua.d', 'bluetooth.lua.d']) {
        const path = `${GLib.get_user_config_dir()}/wireplumber/${directory}`;
        GLib.mkdir_with_parents(path, 0o700);
        GLib.file_set_contents(`${path}/89-video-no-hardware.lua`,
            ['alsa_monitor', 'v4l2_monitor', 'libcamera_monitor', 'bluez_monitor', 'bluez_midi_monitor']
                .map(name => `if ${name} then ${name}.enabled = false end`).join('\n'));
    }
    const pipewire = Gio.Subprocess.new(['pipewire'], Gio.SubprocessFlags.NONE);
    const sessionManager = Gio.Subprocess.new(['wireplumber'], Gio.SubprocessFlags.NONE);
    await delay(1500);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('WAYLAND_DISPLAY', 'island-preview', true);
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    const recorder = launcher.spawnv(['gjs', '-m', '/usr/share/gnome-shell/org.gnome.Shell.Screencast']);
    await delay(400);
    // Keep this isolated headless recording painting after GTK preferences close.
    // It is bounded to the capture lifetime and never runs in the installed extension.
    const captureFrames = new Clutter.Timeline({actor: global.stage, duration: 90000});
    const paintId = captureFrames.connect('new-frame', () => global.stage.queue_redraw());
    captureFrames.start();
    const result = await call('Screencast', new GLib.Variant('(sa{sv})', [
        `${output}/tour`, {'draw-cursor': new GLib.Variant('b', false),
            framerate: new GLib.Variant('i', 60),
            pipeline: new GLib.Variant('s', 'videoconvert ! video/x-raw,format=I420 ! x264enc tune=zerolatency speed-preset=ultrafast pass=qual quantizer=16 bitrate=50000 threads=4 ! mp4mux')},
    ]));
    if (!result[0]) throw new Error('Screencast did not start');
    const started = GLib.get_monotonic_time() / 1000000;
    const chapters = [], cues = {}, motion = [];
    const morph = async open => {
        const start = GLib.get_monotonic_time() / 1000000 - started;
        St.Settings.get().slow_down_factor = 6;
        if (open) preview._island.expand(); else preview._island.collapse();
        console.log(`[README Motion] ${open ? 'expand' : 'collapse'}: ${preview._island.actor.get_transition('height')?.get_duration()}ms`);
        await delay((open ? 500 : 375) * 6 + 300);
        St.Settings.get().slow_down_factor = 1;
        const end = GLib.get_monotonic_time() / 1000000 - started;
        motion.push({start, end, speed: 5, captureScale: 6, kind: open ? 'expand' : 'collapse'});
    };
    const chapter = name => {
        const at = GLib.get_monotonic_time() / 1000000 - started;
        chapters.push({name, at}); console.log(`[README Video] ${name}: ${at.toFixed(3)}s`);
    };
    const cue = name => { cues[name] = GLib.get_monotonic_time() / 1000000 - started; };
    const shot = name => preview._capture(`video-${name}`);
    chapter('desktop');
    await delay(1700); await shot('desktop');
    Gio.File.new_for_path(`${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/video-desktop.png`)
        .copy(Gio.File.new_for_path(`${output}/desktop.png`), Gio.FileCopyFlags.OVERWRITE, null, null);
    await morph(true); await delay(900);
    await morph(false); await delay(500);
    cue('zoom'); fadeDesktop(255); await delay(2300);
    chapter('opening');
    await shot('notch');
    await delay(650); await morph(true); await delay(600);
    await shot('media');
    if (probe) {
        await page('weather'); await delay(1200); await shot('weather');
        await page('notifications'); await delay(900); await shot('notifications');
    } else {
        chapter('media');
        await delay(2400);
        chapter('system'); await page('system'); await delay(2500); await shot('system');
        chapter('audio'); await page('audio'); await delay(800);
        preview._audio.selectOutput(2); await delay(1800);
        if (preview._states.audio.volume !== 0.64) throw new Error('Demo volume changed');
        await shot('audio');
        chapter('bluetooth'); await page('bluetooth'); await delay(900);
        preview._bluetooth.toggle(preview._states.bluetooth.devices[1]); await delay(1700); await shot('bluetooth');
        chapter('weather'); await page('weather'); await delay(3200); await shot('weather');
        chapter('commute'); await page('commute'); await delay(2600); await shot('commute');
        chapter('agents'); await page('agents'); await delay(3000); await shot('agents');
        chapter('notifications'); await page('notifications'); await delay(2800);
        await shot('notifications');
        chapter('calendar'); await page('calendar');
        const calendar = preview._card._calendarView;
        calendar.select(DEMO_DAYS[0]); await delay(1200); await shot('calendar-first');
        const first = [...calendar.agenda.rows.values()].map(row => row.title.text).join('|');
        await click(calendar.cells.find(cell => cell.day === DEMO_DAYS[1]).control); await delay(1400);
        const second = [...calendar.agenda.rows.values()].map(row => row.title.text).join('|');
        if (first === second || !second.includes('Team planning')) throw new Error('Calendar selection did not change events');
        await shot('calendar-second');
        await click(calendar.cells.find(cell => cell.day === DEMO_DAYS[2]).control); await delay(1800);
        if (!calendar.agenda.holiday.visible || calendar.agenda.rows.size !== 0)
            throw new Error('Weekday holiday should show its name and no demo events');
        await shot('calendar-holiday');
    }
    chapter('settings');
    await morph(false);
    const completed = waitForFile(`${output}/preferences-complete.json`);
    preview._settings.set_string('preferences-page', 'appearance');
    preview._openPreferencesLive();
    await delay(1500); await shot('settings');
    const preferences = await completed;
    chapter('personalize');
    preview._card.selectPage('media');
    preview._settings.set_string('color-theme', 'ocean');
    await delay(1800);
    await morph(true);
    cue('theme-ocean'); await delay(550);
    for (const theme of ['forest', 'ember', 'lagoon', 'amethyst', 'berry', 'graphite']) {
        preview._settings.set_string('color-theme', theme);
        cue(`theme-${theme}`); await delay(theme === 'graphite' ? 350 : 550);
    }
    await morph(false); await delay(200);
    cue('return'); fadeDesktop(0); await delay(2800);
    const stopped = await call('StopScreencast', null);
    captureFrames.stop(); captureFrames.disconnect(paintId);
    if (!stopped[0]) throw new Error('Screencast did not stop cleanly');
    pipewire.force_exit(); sessionManager.force_exit(); recorder.force_exit();
    GLib.file_set_contents(`${output}/complete.json`, JSON.stringify({
        source: 'Private GNOME; empty HOME; fictional notifications and events; private D-Bus/PipeWire',
        path: result[1], width: 2560, height: 1440, fps: 60, chapters, cues, motion,
        preferences: preferences.chapters.map(item => ({name: item.name, at: item.at - started})),
    }, null, 2));
    console.log('[README Video] COMPLETE');
}
