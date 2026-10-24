import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const unpack = value => value?.deep_unpack?.() ?? value;

export class BluetoothService {
    constructor(onChange) {
        this._onChange = onChange;
        this._timer = 0;
        this._alive = false;
        this._busy = false;
        this._cancellable = null;
    }

    start() {
        this._alive = true;
        this._cancellable = new Gio.Cancellable();
        this.refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    refresh() {
        if (!this._alive || this._busy) return;
        this._busy = true;
        Gio.DBus.system.call('org.bluez', '/', 'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects', null, new GLib.VariantType('(a{oa{sa{sv}}})'),
            Gio.DBusCallFlags.NONE, 3000, this._cancellable, (connection, result) => {
                this._busy = false;
                if (!this._alive) return;
                try {
                    const [objects] = connection.call_finish(result).deep_unpack();
                    let powered = false;
                    const devices = [];
                    for (const [path, interfaces] of Object.entries(objects)) {
                        const adapter = interfaces['org.bluez.Adapter1'];
                        if (adapter && unpack(adapter.Powered)) powered = true;
                        const d = interfaces['org.bluez.Device1'];
                        if (!d || !unpack(d.Paired)) continue;
                        devices.push({
                            path,
                            name: String(unpack(d.Alias) || unpack(d.Name) || 'Bluetooth device'),
                            connected: Boolean(unpack(d.Connected)),
                            battery: interfaces['org.bluez.Battery1']?.Percentage == null
                                ? null : Number(unpack(interfaces['org.bluez.Battery1'].Percentage)),
                        });
                    }
                    devices.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
                    this._onChange({available: true, powered, devices: devices.slice(0, 8)});
                } catch (e) {
                    console.warn(`[Ubuntu Island] Bluetooth: ${e.message}`);
                    this._onChange({available: false, powered: false, devices: []});
                }
            });
    }

    toggle(device) {
        if (!this._alive || !device?.path?.startsWith('/org/bluez/')) return;
        const method = device.connected ? 'Disconnect' : 'Connect';
        Gio.DBus.system.call('org.bluez', device.path, 'org.bluez.Device1',
            method, null, null, Gio.DBusCallFlags.NONE, 10000,
            this._cancellable, (connection, result) => {
                if (!this._alive) return;
                try { connection.call_finish(result); } catch (e) {
                    console.warn(`[Ubuntu Island] Bluetooth ${method}: ${e.message}`);
                }
                this.refresh();
            });
    }

    stop() {
        this._alive = false;
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
        this._cancellable?.cancel();
        this._cancellable = null;
    }
}
