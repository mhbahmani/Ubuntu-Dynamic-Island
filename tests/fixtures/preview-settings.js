// Presentation settings only: never copy routes, accounts, provider credentials,
// executable/config paths or permissions into the sample environment.
import GLib from 'gi://GLib';

const UI_KEYS = new Set([
    'color-theme', 'surface-opacity', 'surface-matte', 'pill-width', 'expanded-width',
    'animation-duration', 'disable-animations', 'hover-open', 'hover-open-delay',
    'hover-close-delay', 'move-clock', 'expand-tab', 'weather-units', 'weather-motion',
    'calendar-primary', 'calendar-additional', 'calendar-show-holidays',
    'calendar-use-calendar-language', 'calendar-event-title-size', 'calendar-event-lead-minutes',
]);
const isUiKey = key => key.startsWith('pill-') || UI_KEYS.has(key);
const DESKTOP_KEYS = ['text-scaling-factor', 'enable-animations'];
const values = (settings, keys) => Object.fromEntries(keys.map(key => {
    const value = settings.get_value(key);
    return [key, [value.get_type_string(), value.deep_unpack()]];
}));

export function capturePreviewSettings(settings, desktop) {
    return {
        extension: values(settings, settings.settings_schema.list_keys().filter(isUiKey)),
        desktop: values(desktop, DESKTOP_KEYS),
    };
}

export function applyPreviewSettings(settings, desktop, snapshot) {
    if (!snapshot) return;
    for (const [target, entries, allowed] of [
        [settings, snapshot.extension, isUiKey],
        [desktop, snapshot.desktop, key => DESKTOP_KEYS.includes(key)],
    ]) for (const [key, [type, value]] of Object.entries(entries)) {
        if (!allowed(key)) continue;
        if (!target.set_value(key, new GLib.Variant(type, value)))
            throw new Error(`Could not copy preview setting ${key}`);
    }
}
