import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

// Small factory helpers shared by the pill and the expanded card.
export const icon = (name, size = 17) => new St.Icon({icon_name: name, icon_size: size});
export function label(text, css = 'ubuntu-island-muted') {
    const actor = new St.Label({text, style_class: css, y_align: Clutter.ActorAlign.CENTER});
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return actor;
}

export function setEnabled(actor, enabled) {
    actor.reactive = Boolean(enabled);
    actor.can_focus = Boolean(enabled);
    if (enabled) actor.remove_style_pseudo_class('disabled');
    else actor.add_style_pseudo_class('disabled');
}
export const row = (css = 'ubuntu-island-row') => new St.BoxLayout({style_class: css, vertical: false});
export const column = (css = '') => new St.BoxLayout({style_class: css, vertical: true});
export const divider = () => new St.Widget({style_class: 'ubuntu-island-separator'});
export const pct = value => value == null ? '—' : `${Math.round(value)}%`;
export const clip = (text, max) =>
    text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;

export function button(name, tooltip, action, size = 18, css = 'ubuntu-island-control') {
    const b = new St.Button({
        style_class: css, can_focus: true, reactive: true, track_hover: true,
        child: icon(name, size), accessible_name: tooltip,
    });
    b.connect('clicked', action);
    return b;
}
