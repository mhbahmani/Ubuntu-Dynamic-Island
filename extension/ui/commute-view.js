import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';
import {label, row, column, icon, button, setEnabled} from './widgets.js';
import {HoverTip} from './hover-tip.js';
import {openLocationSettings} from '../services/commute-location.js';
import {PROVIDERS, KEYLESS_PROVIDERS, PROVIDER_NAMES, PROVIDER_CREDITS, ROUTE_APPS, routeLink, routeTitle, point} from '../services/commute-model.js';

function textButton(text, action, primary = false) {
    const control = new St.Button({label: text, can_focus: true, reactive: true, track_hover: true,
        style_class: `ubuntu-island-commute-action${primary ? ' ubuntu-island-commute-primary' : ''}`});
    control.connect('clicked', action);
    return control;
}

function endpoint(text, destination = false) {
    const chip = row(`ubuntu-island-commute-endpoint${destination ? ' ubuntu-island-commute-endpoint-to' : ''}`);
    chip.add_child(new St.Widget({style_class: `ubuntu-island-commute-stop${destination ? ' ubuntu-island-commute-stop-to' : ''}`,
        y_align: Clutter.ActorAlign.CENTER}));
    const name = label(text, destination ? 'ubuntu-island-commute-destination' : 'ubuntu-island-commute-origin');
    chip.add_child(name);
    return {chip, name};
}

export class CommuteView {
    constructor(section, actions, viewport) {
        this._relayout = () => actions.relayout?.();
        this.viewport = viewport;
        section.header.hide();
        const content = this.main = column('ubuntu-island-commute');
        section.content.add_child(content);

        const heading = row('ubuntu-island-commute-heading');
        this.name = label('Add your first route', 'ubuntu-island-track');
        this.name.x_expand = true;
        heading.add_child(this.name);
        this.refresh = button('view-refresh-symbolic', 'Refresh driving estimate',
            () => actions.commuteRefresh?.(), 15, 'ubuntu-island-commute-icon-button');
        heading.add_child(this.refresh);
        content.add_child(heading);

        this.summary = row('ubuntu-island-commute-summary');
        this.driving = new St.Bin({style_class: 'ubuntu-island-commute-driving', y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.REDUNDANT_OBJECT,
            child: new St.Icon({icon_size: 25, gicon: new Gio.FileIcon({file: Gio.File.new_for_uri(import.meta.url)
                .get_parent().get_parent().get_child('assets').get_child('commute-driving-symbolic.svg')})})});
        this.summary.add_child(this.driving);
        const duration = column('ubuntu-island-commute-duration');
        this.duration = duration;
        duration.x_expand = true;
        const estimate = row('ubuntu-island-commute-estimate');
        this.eta = label('—', 'ubuntu-island-commute-eta');
        this.unit = label('min', 'ubuntu-island-commute-unit');
        this.unit.y_align = Clutter.ActorAlign.END;
        estimate.add_child(this.eta);
        estimate.add_child(this.unit);
        duration.add_child(estimate);
        this.distance = label('Driving estimate', 'ubuntu-island-commute-distance');
        this.summary.add_child(duration);

        const arrival = column('ubuntu-island-commute-arrival');
        arrival.x_align = Clutter.ActorAlign.END;
        arrival.y_align = Clutter.ActorAlign.CENTER;
        this.arrival = label('', 'ubuntu-island-commute-time');
        this.arrival.x_align = Clutter.ActorAlign.END;
        arrival.add_child(label('EST. ARRIVAL', 'ubuntu-island-commute-eyebrow'));
        arrival.add_child(this.arrival);
        arrival.add_child(this.distance);
        this.arrivalBox = arrival;
        this.summary.add_child(arrival);
        content.add_child(this.summary);

        this.journey = row('ubuntu-island-commute-journey');
        const from = endpoint('Start');
        const to = endpoint('Destination', true);
        this.origin = from.name;
        this.destination = to.name;
        this.journey.add_child(from.chip);
        this.journey.add_child(new St.Widget({style_class: 'ubuntu-island-commute-route-line',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this.journey.add_child(to.chip);
        this.swap = button('object-flip-horizontal-symbolic', 'Reverse route', () => actions.commuteSwap?.(),
            15, 'ubuntu-island-commute-icon-button');
        this.swap.y_align = Clutter.ActorAlign.CENTER;
        this.journey.add_child(this.swap);
        content.add_child(this.journey);

        const feedback = row('ubuntu-island-commute-feedback');
        this.feedback = feedback;
        this.statusIcon = icon('dialog-information-symbolic', 12);
        this.statusInfo = new St.Button({child: this.statusIcon, track_hover: true,
            style_class: 'ubuntu-island-commute-info', y_align: Clutter.ActorAlign.START});
        this.statusTip = new HoverTip(content);
        this.statusTip.addTarget(this.statusInfo, () => this.unverified ? 'Live traffic freshness not confirmed' : '');
        this.statusInfo.connect('clicked', () => this.statusInfo.grab_key_focus());
        feedback.add_child(this.statusInfo);
        const messages = column('ubuntu-island-commute-messages');
        this.messages = messages;
        messages.x_expand = true;
        this.status = label('', 'ubuntu-island-commute-status', false);
        this.status.clutter_text.line_wrap = true;
        this.status.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        messages.add_child(this.status);
        this.metadataDivider = label('·', 'ubuntu-island-commute-metadata');
        this.metadataDivider.accessible_role = Atk.Role.REDUNDANT_OBJECT;
        messages.add_child(this.metadataDivider);
        this.freshness = label('', 'ubuntu-island-commute-metadata');
        messages.add_child(this.freshness);
        feedback.add_child(messages);
        content.add_child(feedback);

        this.controls = row('ubuntu-island-commute-actions');
        this.configure = textButton('Add a route', () => actions.preferences?.('commute'), true);
        this.controls.add_child(this.configure);
        this.savedStart = textButton('Use saved start', () => actions.commuteUseSavedStart?.(), true);
        this.controls.add_child(this.savedStart);
        this.locationSettings = textButton('Location settings', () => openLocationSettings());
        this.savedStart.x_align = this.locationSettings.x_align = Clutter.ActorAlign.START;
        this.controls.add_child(this.locationSettings);
        const source = column('ubuntu-island-commute-source');
        source.x_expand = true;
        this.provider = textButton('', () => this.showProviders(true));
        this.provider.set({x_expand: true, y_expand: true});
        this.provider.add_style_class_name('ubuntu-island-commute-provider');
        // Matches Open route: same padding and type, label left, chevron right.
        const providerFace = row('ubuntu-island-commute-provider-face');
        providerFace.x_expand = true;
        this.providerLabel = label('Automatic', 'ubuntu-island-commute-provider-label');
        this.providerLabel.x_expand = true;
        providerFace.add_child(this.providerLabel);
        const providerIcon = icon('pan-down-symbolic', 12);
        providerIcon.accessible_role = Atk.Role.REDUNDANT_OBJECT;
        providerFace.add_child(providerIcon);
        this.provider.set_child(providerFace);
        source.add_child(this.provider);
        this.credit = label('', 'ubuntu-island-commute-credit', false);
        this.credit.x_expand = true;
        this.credit.clutter_text.line_wrap = true;
        this.credit.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.creditLink = new St.Button({child: this.credit, reactive: true, can_focus: true, track_hover: true,
            style_class: 'ubuntu-island-commute-credit-link', x_expand: true});
        this.creditLink.connect('clicked', () => {
            const url = PROVIDER_CREDITS[this.state.data?.provider]?.url;
            if (url) Gio.AppInfo.launch_default_for_uri(url, null);
        });
        this.controls.add_child(source);
        this.open = textButton('Open route', () => this._openRoute(), true);
        const openFace = row('ubuntu-island-commute-open-face');
        openFace.add_child(label('Open route', 'ubuntu-island-commute-open-label'));
        const openIcon = icon('go-next-symbolic', 12);
        openIcon.accessible_role = Atk.Role.REDUNDANT_OBJECT;
        openFace.add_child(openIcon);
        this.open.set_child(openFace);
        this.controls.add_child(this.open);
        content.add_child(this.controls);
        this.providerPanel = column('ubuntu-island-commute-provider-panel');
        section.content.add_child(this.providerPanel);
        const providerHeading = row('ubuntu-island-commute-heading');
        this.providerBack = button('go-previous-symbolic', 'Back to route', () => this.showProviders(false),
            15, 'ubuntu-island-commute-icon-button');
        providerHeading.add_child(this.providerBack);
        providerHeading.add_child(label('ETA provider', 'ubuntu-island-track'));
        this.providerPanel.add_child(providerHeading);
        this.providerRows = new Map();
        for (const id of ['auto', ...PROVIDERS]) {
            const control = textButton('', () => {
                actions.commuteProvider?.(id);
                this.showProviders(false);
            });
            control.x_expand = true;
            control.add_style_class_name('ubuntu-island-commute-provider-choice');
            this.providerRows.set(id, control);
            this.providerPanel.add_child(control);
        }
        this.fallback = textButton('', () => actions.commuteFallback?.(!this.state.allowFallback));
        this.providerPanel.add_child(this.fallback);
        this.providerPanel.add_child(textButton('Set up API keys in Settings', () => actions.preferences?.('commute')));
        this.providerPanel.add_child(this.creditLink);
        this.providerPanel.hide();
        section.box.connect('notify::mapped', () => {
            if (!section.box.mapped) this.showProviders(false, false);
        });
        content.connect('style-changed', this._relayout);
        this.render({});
    }

    showProviders(show, focus = true) {
        this.main.visible = !show;
        this.providerPanel.visible = show;
        const adjustment = this.viewport.get_vscroll_bar().get_adjustment();
        adjustment.value = adjustment.lower;
        this._relayout();
        if (focus) (show ? this.providerBack : this.provider).grab_key_focus();
    }

    _openRoute() {
        if (!this.open.reactive || !this.openUrl) return;
        Gio.AppInfo.launch_default_for_uri(this.openUrl, null);
    }

    fit(width) {
        // Use the card's available width; child minimums may already overflow it.
        width -= this.main.get_theme_node().get_horizontal_padding();
        const needed = this.duration.get_preferred_width(-1)[1]
            + (this.arrivalBox.visible ? this.arrivalBox.get_preferred_width(-1)[1] : 0)
            + this.driving.get_preferred_width(-1)[1]
            + 2 * this.summary.get_theme_node().get_length('spacing');
        this.summary.vertical = needed > width;
        this.driving.visible = !this.summary.vertical;
        this.arrivalBox.x_align = this.summary.vertical ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
        const messageWidth = (this.status.visible ? this.status.get_preferred_width(-1)[1] : 0)
            + (this.freshness.visible ? this.freshness.get_preferred_width(-1)[1]
                + (this.status.visible ? this.metadataDivider.get_preferred_width(-1)[1]
                    + 2 * this.messages.get_theme_node().get_length('spacing') : 0) : 0);
        const messageSpace = width - this.feedback.get_theme_node().get_horizontal_padding()
            - this.statusInfo.get_preferred_width(-1)[1] - this.feedback.get_theme_node().get_length('spacing');
        this.messages.vertical = messageWidth > messageSpace;
        this.metadataDivider.visible = this.status.visible && this.freshness.visible && !this.messages.vertical;
    }

    render(state) {
        this.state = state;
        const {data, route} = state;
        const loading = state.status === 'loading';
        const locationFailure = String(state.errorCode ?? '').startsWith('location-');
        this.name.text = routeTitle(route);
        this.name.accessible_name = this.name.text;
        this.summary.visible = this.journey.visible = Boolean(route);
        this.eta.text = data ? `${Math.max(1, Math.round(data.seconds / 60))}` : '—';
        this.eta.accessible_name = data ? `${this.eta.text} minutes${state.stale ? ', saved estimate' : ''}` : 'No estimate available';
        this.unit.visible = Boolean(data);
        this.distance.text = data ? `${(data.meters / 1000).toFixed(1)} km` : '';
        this.arrivalBox.visible = Boolean(data);
        this.arrival.text = data ? new Date(Date.now() + data.seconds * 1000)
            .toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
        this.arrival.accessible_name = `Estimated arrival ${this.arrival.text}`;
        this.origin.text = route?.originMode === 'current' ? 'Current location' : route?.originName || 'Start';
        this.destination.text = route?.destinationName || 'Destination';
        this.origin.accessible_name = `From ${this.origin.text}`;
        this.destination.accessible_name = `To ${this.destination.text}`;

        const age = data ? Math.floor(Math.max(0, Date.now() - data.updatedAt) / 60000) : 0;
        const traffic = data?.traffic ? (data.provider === 'mapbox' ? 'Traffic-aware estimate' : 'Live traffic')
            : data?.trafficUnverified ? 'Traffic unverified' : 'No live traffic';
        this.status.text = loading ? 'Updating driving estimate…'
            : state.error ? `${state.stale ? 'Saved estimate · ' : ''}${state.error}`
            : data ? traffic
            : route ? 'Your driving estimate will appear here.' : 'Choose your start and destination in Settings.';
        if (locationFailure) this.status.text = state.errorCode === 'location-disabled'
            ? 'Location Services are off.' : 'Location unavailable. Select a start in Settings.';
        this.unverified = Boolean(data?.trafficUnverified && !loading && !state.error && !locationFailure);
        this.status.visible = !this.unverified;
        this.statusInfo.reactive = this.statusInfo.can_focus = this.unverified;
        this.statusInfo.accessible_name = this.unverified ? 'Live traffic freshness not confirmed' : '';
        if (!this.unverified) this.statusInfo.accessible_description = '';
        this.statusInfo.accessible_role = this.unverified ? Atk.Role.PUSH_BUTTON : Atk.Role.REDUNDANT_OBJECT;
        this.statusTip.refresh();
        this.freshness.text = [state.sample ? 'Sample' : '', state.stale && !state.error ? 'Saved estimate' : '',
            data ? age === 0 ? 'Updated just now' : `Updated ${age} min ago` : '',
            data?.fallback ? 'Backup source' : ''].filter(Boolean).join(' · ');
        this.freshness.visible = Boolean(this.freshness.text);
        this.status.accessible_name = [data?.trafficUnverified && !state.error && !loading
            ? 'Traffic freshness unverified' : this.status.text, this.freshness.text].filter(Boolean).join('. ');
        this.statusIcon.icon_name = state.error || state.stale || this.unverified ? 'dialog-warning-symbolic'
            : loading ? 'view-refresh-symbolic' : 'dialog-information-symbolic';
        this.statusIcon.set_style_class_name(`ubuntu-island-commute-status-icon${state.error || state.stale ? ' ubuntu-island-commute-warning' : ''}`);
        this.statusIcon.accessible_role = Atk.Role.REDUNDANT_OBJECT;
        this.feedback.set_style_class_name(`ubuntu-island-commute-feedback${state.error || state.stale
            ? ' ubuntu-island-commute-feedback-warning' : loading ? ' ubuntu-island-commute-feedback-loading'
                : data?.traffic ? ' ubuntu-island-commute-feedback-live' : data ? ' ubuntu-island-commute-feedback-estimate' : ''}`);
        this.savedStart.visible = locationFailure && Boolean(point(route?.origin));
        this.locationSettings.visible = locationFailure;
        this.controls.vertical = locationFailure;
        this.open.visible = Boolean(route) && !locationFailure;
        this.configure.visible = !route;
        this.refresh.visible = Boolean(route);
        const preferred = state.preferred ?? 'auto';
        const providerName = id => id === 'auto' ? 'Automatic' : PROVIDER_NAMES[id] ?? id;
        const actual = data ? providerName(data.provider) : '';
        this.providerLabel.text = preferred === 'auto' ? `Auto${actual ? ` · ${actual}` : ''}`
            : actual && data.provider !== preferred ? `${providerName(preferred)} → ${actual}` : providerName(preferred);
        this.provider.accessible_name = `Choose ETA provider. Preferred: ${providerName(preferred)}${actual ? `. Estimate from ${actual}` : ''}`;
        this.provider.visible = Boolean(route);
        for (const [id, control] of this.providerRows) {
            const available = id === 'auto' || (state.availableProviders ?? KEYLESS_PROVIDERS).includes(id);
            control.label = `${id === preferred ? '✓ ' : ''}${providerName(id)}${available ? '' : ' · API key required'}`;
            control.child.ellipsize = Pango.EllipsizeMode.END;
            control.child.x_align = Clutter.ActorAlign.START;
            control.accessible_name = `${providerName(id)}${id === preferred ? ', selected' : ''}${available ? '' : ', API key required'}`;
            if (id === preferred) control.add_style_pseudo_class('checked');
            else control.remove_style_pseudo_class('checked');
            if (id === preferred) control.add_accessible_state(Atk.StateType.SELECTED);
            else control.remove_accessible_state(Atk.StateType.SELECTED);
            setEnabled(control, available);
        }
        this.fallback.label = `Backup providers: ${state.allowFallback !== false ? 'On' : 'Off'}`;
        this.fallback.accessible_name = `${this.fallback.label}. ${state.allowFallback !== false ? 'Disable to use only the selected provider' : 'Enable automatic fallback if the selected provider fails'}`;
        this.credit.text = PROVIDER_CREDITS[data?.provider]?.text || '';
        this.creditLink.visible = Boolean(this.credit.text);
        this.creditLink.accessible_name = `${this.credit.text}. Open attribution details`;
        this.credit.accessible_name = this.credit.text;
        this.refresh.accessible_name = loading ? 'Updating driving estimate' : 'Refresh driving estimate';
        setEnabled(this.refresh, Boolean(route) && !loading);
        setEnabled(this.swap, route?.originMode === 'fixed');
        this.openUrl = routeLink(state.openWith, route?.originMode === 'fixed' ? route.origin : data?.origin, route?.destination);
        setEnabled(this.open, Boolean(this.openUrl) && !locationFailure);
        this.open.accessible_name = this.openUrl ? `Open route in ${ROUTE_APPS[state.openWith] ?? ROUTE_APPS.google}, from ${this.origin.text} to ${this.destination.text}`
            : 'Route endpoints unavailable';
        this._relayout();
    }
}
