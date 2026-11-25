import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME 46's Quick Settings already caches the active power profile. Read it
// when motion starts instead of opening another D-Bus client or polling.
export function powerSaverActive() {
    return Main.panel?.statusArea?.quickSettings?._powerProfiles?.quickSettingsItems?.[0]?._proxy
        ?.ActiveProfile === 'power-saver';
}
