import Gio from 'gi://Gio';

// Shared by Shell and GTK so the module has one identity at every size.
export const AGENT_ICON_NAME = 'ubuntu-island-agents-symbolic';
export const agentIconDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
    .resolve_relative_path('assets/icons');
export const agentIconFile = agentIconDirectory.resolve_relative_path(`hicolor/scalable/actions/${AGENT_ICON_NAME}.svg`);
export const agentIcon = new Gio.FileIcon({file: agentIconFile});

// Harness logos (assets/agents/<provider>.svg), shared by the Agents tab and
// agent notifications. Unknown providers fall back to the module icon.
const harnessIcons = new Map();
export function harnessIcon(provider) {
    if (!/^[a-z0-9-]+$/.test(provider ?? '')) return agentIcon;
    if (!harnessIcons.has(provider)) {
        const file = agentIconDirectory.get_parent().resolve_relative_path(`agents/${provider}.svg`);
        harnessIcons.set(provider, file.query_exists(null) ? new Gio.FileIcon({file}) : agentIcon);
    }
    return harnessIcons.get(provider);
}
