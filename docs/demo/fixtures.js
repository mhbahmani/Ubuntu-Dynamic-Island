// Fictional presentation data, used only by the private recording session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {postNotification} from './preview-data.js';
import {civilDay} from './services/calendar-model.js';
import {localDayRange} from './services/calendar-events-model.js';
import {ArtLoader} from './services/art.js';

export const DEMO_DAYS = [civilDay(2026, 3, 30), civilDay(2026, 3, 31), civilDay(2026, 4, 2)];

export async function configureDemo(preview) {
    const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    desktop.set_string('icon-theme', 'Yaru');
    desktop.set_string('font-name', 'Noto Sans 11');
    desktop.set_boolean('enable-animations', true);
    // A headless Shell has no settings daemon to synchronize font DPI with scaling.
    St.ThemeContext.get_for_stage(global.stage).scale_factor = 2;
    Clutter.Settings.get_default().font_dpi = 192 * 1024;
    const settings = preview._settings;
    settings.set_int('expanded-width', 480);
    settings.set_int('expanded-max-height', 360);
    if (!settings.set_int('animation-duration', 500)) throw new Error('Demo animation duration was rejected');
    settings.set_boolean('disable-animations', false);
    settings.set_boolean('hover-open', false);
    settings.set_int('pill-title-characters', 18);
    settings.set_strv('pill-date-calendars', ['gregorian']);
    settings.set_boolean('calendar-use-calendar-language', false);
    settings.set_strv('pill-order', ['media', 'weather', 'commute', 'agents', 'cpu', 'network', 'date', 'time', 'bluetooth']);
    for (const key of ['weather', 'date', 'time', 'commute', 'agents', 'network']) settings.set_boolean(`pill-show-${key}`, true);
    for (const key of ['event', 'notifications']) settings.set_boolean(`pill-show-${key}`, false);
    settings.set_boolean('pill-cpu-hide-idle', false);
    settings.set_string('pill-network-layout', 'stacked');
    settings.set_int('pill-cpu-idle-threshold', 95);
    settings.set_boolean('pill-time-seconds', false);
    settings.set_string('notifications-layout', 'compact');
    preview._notifications.clear();
    for (const [app, title, body, minutes, logo] of [
        ['Telegram', 'Design team', 'The new preview is ready to review.', 1, 'telegram'],
        ['Telegram', 'Alex', 'The latest build looks good!', 3, 'telegram'],
        ['WhatsApp', 'Weekend plans', 'Meet at six? I’ll bring the snacks.', 5, 'whatsapp'],
        ['Files', 'Export complete', 'Feature tour saved to Videos.', 8, null],
        ['Software', 'Updates ready', 'Three application updates are available.', 12, null],
    ]) {
        const notice = postNotification({app, title, body, minutes,
            icon: app === 'Files' ? 'org.gnome.Nautilus' : 'org.gnome.Software'});
        if (logo) {
            const gicon = new Gio.FileIcon({file: Gio.File.new_for_path(`${preview.path}/assets/video/${logo}.svg`)});
            // Same icon/id interface used by the bundled sample's installed-app adapter.
            notice.source.app = {get_icon: () => gicon, get_id: () => `demo.${logo}.desktop`};
        }
    }
    const timed = (day, uid, title, hour) => ({sourceUid: 'sample-calendar', uid, title, allDay: false,
        startMs: localDayRange(day).startMs + hour * 3600000,
        endMs: localDayRange(day).startMs + (hour + 1) * 3600000});
    preview._sampleCalendarRecords = [
        timed(DEMO_DAYS[0], 'review', 'Design review', 10),
        timed(DEMO_DAYS[0], 'focus', 'Focus session', 14),
        timed(DEMO_DAYS[1], 'planning', 'Team planning', 9),
        timed(DEMO_DAYS[1], 'walk', 'Afternoon walk', 16),
    ];
    preview._calendarEvents.publish();
    settings.set_string('calendar-primary', 'jalali');
    preview._renderMedia({...preview._states.media, title: 'Believer', artist: 'Imagine Dragons', lengthSec: 204});
    const artwork = new ArtLoader();
    await new Promise((resolve, reject) => artwork.load(
        Gio.File.new_for_path(`${preview.path}/assets/video/believer-cover.jpg`).get_uri(), 512,
        content => {
            if (!content) { reject(new Error('Believer artwork did not load')); return; }
            preview._card.renderArt(content);
            resolve();
        }));
    artwork.destroy();
}
