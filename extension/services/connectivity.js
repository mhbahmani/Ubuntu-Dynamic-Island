import Gio from 'gi://Gio';

// Share the system monitor; notifications cost no extra polling or HTTP probes.
export class ConnectivityService {
    constructor(emit, monitor = Gio.NetworkMonitor.get_default()) {
        this.monitor = monitor;
        this.emit = emit;
        this.ids = [];
    }

    start() {
        if (this.ids.length) return;
        const update = () => {
            const state = !this.monitor.network_available ? 'offline'
                : this.monitor.connectivity === Gio.NetworkConnectivity.PORTAL ? 'portal'
                : this.monitor.connectivity === Gio.NetworkConnectivity.LIMITED ? 'limited'
                : this.monitor.connectivity === Gio.NetworkConnectivity.LOCAL ? 'offline' : 'online';
            if (state === this.state) return;
            this.state = state;
            this.emit(state);
        };
        this.ids = ['network-available', 'connectivity']
            .map(property => this.monitor.connect(`notify::${property}`, update));
        update();
    }

    stop() {
        for (const id of this.ids) this.monitor.disconnect(id);
        this.ids = [];
        this.state = null;
    }
}
