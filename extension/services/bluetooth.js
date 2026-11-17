import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BLUEZ = 'org.bluez';
const MANAGER = 'org.freedesktop.DBus.ObjectManager';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const DEVICE = 'org.bluez.Device1';
const ADAPTER = 'org.bluez.Adapter1';
const BATTERY = 'org.bluez.Battery1';
const unpack = value => value?.deep_unpack?.() ?? value;
const unpackValues = dict => {
    const out = {};
    for (const [key, value] of Object.entries(dict ?? {})) out[key] = unpack(value);
    return out;
};

// Event-driven BlueZ state: one initial GetManagedObjects snapshot, then
// InterfacesAdded/InterfacesRemoved plus per-interface PropertiesChanged
// subscriptions keep the model current without polling. Pairing is left to
// GNOME Settings; nothing here auto-pairs or auto-trusts.
export class BluetoothService {
    constructor(onChange) {
        this._onChange = onChange;
        this._alive = false;
        this._available = false;
        this._busy = false;
        this._cancellable = null;
        this._watch = 0;
        this._subscriptions = [];
        this._adapter = null; // {path, powered}
        this._devices = new Map(); // path -> {path, name, connected, battery}
        this._pending = new Set();
        this._powerPending = false;
        this._error = '';
    }

    start() {
        this._alive = true;
        this._cancellable = new Gio.Cancellable();
        this._watch = Gio.DBus.system.watch_name(BLUEZ, Gio.BusNameWatcherFlags.NONE,
            () => this._appeared(), () => this._vanished());
        this._emit();
    }

    _appeared() {
        this._available = true;
        this._subscribe();
        this._snapshot();
    }

    _vanished() {
        this._available = false;
        this._adapter = null;
        this._devices.clear();
        this._unsubscribe();
        this._emit();
    }

    _subscribe() {
        if (this._subscriptions.length) return;
        this._subscriptions.push(
            Gio.DBus.system.signal_subscribe(BLUEZ, MANAGER, 'InterfacesAdded', '/', null,
                Gio.DBusSignalFlags.NONE, (c, s, path, iface, name, params) => {
                    const [objectPath, interfaces] = params.deep_unpack();
                    this._applyInterfaces(objectPath, interfaces);
                    this._emit();
                }),
            Gio.DBus.system.signal_subscribe(BLUEZ, MANAGER, 'InterfacesRemoved', '/', null,
                Gio.DBusSignalFlags.NONE, (c, s, path, iface, name, params) => {
                    const [objectPath, interfaces] = params.deep_unpack();
                    this._removeInterfaces(objectPath, interfaces);
                    this._emit();
                }),
            this._propertiesChanged(DEVICE, (path, changed) => {
                const device = this._devices.get(path);
                if (!device) return;
                if ('Alias' in changed || 'Name' in changed)
                    device.name = String(changed.Alias ?? changed.Name ?? device.name);
                if ('Connected' in changed) device.connected = Boolean(changed.Connected);
                if ('Address' in changed) device.address = String(changed.Address ?? '');
                if ('Paired' in changed && !changed.Paired) this._devices.delete(path);
                this._emit();
            }),
            this._propertiesChanged(ADAPTER, (path, changed) => {
                if (this._adapter?.path !== path || !('Powered' in changed)) return;
                this._adapter.powered = Boolean(changed.Powered);
                this._emit();
            }),
            this._propertiesChanged(BATTERY, (path, changed, invalidated) => {
                const device = this._devices.get(path);
                if (!device || (!('Percentage' in changed) && !invalidated.includes('Percentage'))) return;
                device.battery = changed.Percentage == null ? null : Number(changed.Percentage);
                this._emit();
            }),
        );
    }

    _propertiesChanged(ifaceName, apply) {
        return Gio.DBus.system.signal_subscribe(BLUEZ, PROPERTIES, 'PropertiesChanged', null, ifaceName,
            Gio.DBusSignalFlags.NONE, (connection, sender, path, iface, signal, params) => {
                const [, changed, invalidated = []] = params.deep_unpack();
                apply(path, unpackValues(changed), invalidated);
            });
    }

    _applyInterfaces(path, interfaces) {
        // D-Bus dictionaries have no ordering guarantee: create the device
        // before applying Battery1 when both arrive in the initial snapshot.
        for (const name of [ADAPTER, DEVICE, BATTERY]) {
            const props = interfaces?.[name];
            if (!props) continue;
            const value = key => unpack(props?.[key]);
            if (name === ADAPTER) {
                this._adapter = {path, powered: Boolean(value('Powered'))};
            } else if (name === DEVICE) {
                if (!value('Paired')) continue; // unpaired devices are invisible to the island
                this._devices.set(path, {
                    path,
                    address: String(value('Address') ?? ''),
                    name: String(value('Alias') || value('Name') || 'Bluetooth device'),
                    connected: Boolean(value('Connected')),
                    battery: null,
                });
            } else if (name === BATTERY) {
                const device = this._devices.get(path);
                if (device && value('Percentage') != null) device.battery = Number(value('Percentage'));
            }
        }
    }

    _removeInterfaces(path, names) {
        for (const name of names ?? []) {
            if (name === DEVICE) this._devices.delete(path);
            else if (name === ADAPTER && this._adapter?.path === path) this._adapter = null;
            else if (name === BATTERY) {
                const device = this._devices.get(path);
                if (device) device.battery = null;
            }
        }
    }

    _snapshot() {
        if (!this._alive || this._busy) return;
        this._busy = true;
        Gio.DBus.system.call(BLUEZ, '/', MANAGER, 'GetManagedObjects', null,
            new GLib.VariantType('(a{oa{sa{sv}}})'), Gio.DBusCallFlags.NONE, 3000, this._cancellable,
            (connection, result) => {
                this._busy = false;
                if (!this._alive) return;
                try {
                    const [objects] = connection.call_finish(result).deep_unpack();
                    this._devices.clear();
                    this._adapter = null;
                    for (const [path, interfaces] of Object.entries(objects))
                        this._applyInterfaces(path, interfaces);
                    this._available = true;
                } catch (e) {
                    console.warn(`[Ubuntu Island] Bluetooth: ${e.message}`);
                    this._available = false;
                }
                this._emit();
            });
    }

    _emit() {
        if (!this._alive) return;
        const devices = [...this._devices.values()]
            .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
            .slice(0, 8);
        this._onChange({
            available: this._available,
            hasAdapter: Boolean(this._adapter),
            powered: Boolean(this._adapter?.powered),
            devices: devices.map(device => ({...device, pending: this._pending.has(device.path)})),
            powerPending: this._powerPending,
            error: this._error,
        });
    }

    toggle(device) {
        if (!this._alive || !this._adapter?.powered || !this._devices.has(device?.path) ||
            this._pending.has(device.path)) return;
        this._pending.add(device.path);
        this._error = '';
        this._emit();
        const method = device.connected ? 'Disconnect' : 'Connect';
        Gio.DBus.system.call(BLUEZ, device.path, DEVICE, method, null, null,
            Gio.DBusCallFlags.NONE, 10000, this._cancellable, (connection, result) => {
                if (!this._alive) return;
                this._pending.delete(device.path);
                try {
                    connection.call_finish(result);
                } catch (e) {
                    console.warn(`[Ubuntu Island] Bluetooth ${method}: ${e.message}`);
                    this._error = `Could not ${method.toLowerCase()} ${device.name}. Try again in Bluetooth Settings.`;
                    this._snapshot(); // resync in case events were missed
                }
                this._emit();
            });
    }

    setPowered(on) {
        if (!this._alive || !this._adapter?.path || this._powerPending) return;
        this._powerPending = true;
        this._error = '';
        this._emit();
        Gio.DBus.system.call(BLUEZ, this._adapter.path, PROPERTIES, 'Set',
            new GLib.Variant('(ssv)', [ADAPTER, 'Powered', new GLib.Variant('b', Boolean(on))]),
            null, Gio.DBusCallFlags.NONE, 5000, this._cancellable, (connection, result) => {
                if (!this._alive) return;
                this._powerPending = false;
                try {
                    connection.call_finish(result);
                } catch (e) {
                    console.warn(`[Ubuntu Island] Bluetooth power: ${e.message}`);
                    this._error = 'Could not change Bluetooth power. Check Bluetooth Settings.';
                }
                this._emit();
                this._snapshot();
            });
    }

    _unsubscribe() {
        for (const id of this._subscriptions) Gio.DBus.system.signal_unsubscribe(id);
        this._subscriptions = [];
    }

    stop() {
        this._alive = false;
        if (this._watch) Gio.DBus.system.unwatch_name(this._watch);
        this._watch = 0;
        this._unsubscribe();
        this._cancellable?.cancel();
        this._cancellable = null;
        this._devices.clear();
        this._adapter = null;
        this._available = false;
        this._pending.clear();
        this._powerPending = false;
    }
}
