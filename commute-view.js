import St from 'gi://St';
import Gio from 'gi://Gio';
import {label, row, button, setEnabled} from './widgets.js';
import {openLocationSettings} from './services/commute-location.js';
import {PROVIDER_NAMES, routeTitle, point} from './services/commute-model.js';

export class CommuteView {
    constructor(section, actions) {
        section.header.hide();
        const content = section.content;
        content.add_style_class_name('ubuntu-island-commute');
        const heading = row();
        this.name = label('Add your first route', 'ubuntu-island-track'); this.name.x_expand = true;
        heading.add_child(this.name);
        heading.add_child(button('go-next-symbolic', 'Next saved route', () => actions.commuteNext?.(), 14));
        this.swap = button('object-flip-horizontal-symbolic', 'Reverse route', () => actions.commuteSwap?.(), 14);
        heading.add_child(this.swap);
        heading.add_child(button('preferences-system-symbolic', 'Commute settings', () => actions.preferences('commute'), 14));
        content.add_child(heading);
        const hero = row();
        this.eta = label('—', 'ubuntu-island-commute-eta'); this.eta.x_expand = true;
        this.arrival = label('', 'ubuntu-island-muted'); hero.add_child(this.eta); hero.add_child(this.arrival);
        content.add_child(hero);
        this.endpoints = label('Choose start and destination on the map in Settings.', 'ubuntu-island-muted'); content.add_child(this.endpoints);
        this.status = label('', 'ubuntu-island-source'); content.add_child(this.status);
        const controls = row();
        this.refresh = button('view-refresh-symbolic', 'Refresh driving estimate', () => actions.commuteRefresh?.(), 15);
        controls.add_child(this.refresh);
        const open = new St.Button({label: 'Open route', style_class: 'ubuntu-island-commute-link', can_focus: true});
        open.connect('clicked', () => {
            const d = this.state?.data;
            if (!d) return;
            Gio.AppInfo.launch_default_for_uri(`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${d.origin.latitude}%2C${d.origin.longitude}%3B${d.destination.latitude}%2C${d.destination.longitude}`, null);
        });
        this.open = open; controls.add_child(open);
        const fix = new St.Button({label: 'Fix map', style_class: 'ubuntu-island-commute-link', can_focus: true});
        fix.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://www.openstreetmap.org/fixthemap', null));
        controls.add_child(fix); this.fix = fix;
        this.savedStart = new St.Button({label: 'Use saved start', style_class: 'ubuntu-island-commute-link', can_focus: true});
        this.savedStart.connect('clicked', () => actions.commuteUseSavedStart?.());
        controls.add_child(this.savedStart);
        this.locationSettings = new St.Button({label: 'Location settings', style_class: 'ubuntu-island-commute-link', can_focus: true});
        this.locationSettings.connect('clicked', () => openLocationSettings());
        controls.add_child(this.locationSettings);
        content.add_child(controls);
        this.credit = label('Map data © OpenStreetMap contributors', 'ubuntu-island-source'); content.add_child(this.credit);
        this.render({});
    }
    render(state) {
        this.state = state;
        const data = state.data;
        this.name.text = routeTitle(state.route);
        this.eta.text = data ? `${Math.max(1, Math.round(data.seconds / 60))} min` : '—';
        this.arrival.text = data ? `${(data.meters / 1000).toFixed(1)} km · Arrive ${new Date(Date.now() + data.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '';
        this.endpoints.text = state.route ? `${state.route.originMode === 'current' ? 'Current location' : state.route.originName} → ${state.route.destinationName}` : 'Choose start and destination on the map in Settings.';
        const age = data ? Math.floor(Math.max(0, Date.now() - data.updatedAt) / 60000) : 0;
        this.status.text = state.status === 'loading' ? 'Updating driving estimate…' : (state.error ? `${state.stale ? 'Stale estimate · ' : ''}${state.error}` : null) || (data ? `${data.traffic ? (data.provider === 'mapbox' ? 'Traffic-aware' : 'Live traffic') : 'No live traffic'} · ${state.stale ? 'Stale · ' : ''}Updated ${age} min ago${data.fallback ? ' · Backup source' : ''}` : 'Configure a route to begin');
        const locationFailure = String(state.errorCode ?? '').startsWith('location-');
        if (locationFailure) this.status.text = state.errorCode === 'location-disabled'
            ? 'Location Services are off.' : 'Location unavailable. Select a start in settings.';
        this.savedStart.visible = locationFailure && Boolean(point(state.route?.origin));
        this.locationSettings.visible = locationFailure;
        this.open.visible = this.fix.visible = !locationFailure;
        if (state.sample) this.status.text = `Sample · ${this.status.text}`;
        this.status.accessible_name = this.status.text;
        this.credit.text = data ? `${PROVIDER_NAMES[data.provider] ?? data.provider} · © OpenStreetMap${data.provider === 'neshan' ? ' / Neshan' : data.provider === 'mapbox' ? ' / Mapbox' : ''}` : 'Map data © OpenStreetMap contributors';
        setEnabled(this.refresh, Boolean(state.route) && state.status !== 'loading');
        setEnabled(this.swap, state.route?.originMode === 'fixed');
        setEnabled(this.open, Boolean(data));
    }
}
