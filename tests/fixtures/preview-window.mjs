// Real preferences-window lifecycle fixture, without the Extensions app service.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
Adw.init();
const loop = new GLib.MainLoop(null, false);
const window = new Adw.PreferencesWindow({title: 'Ubuntu Island'});
window.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2400, () => {
    window.close();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
