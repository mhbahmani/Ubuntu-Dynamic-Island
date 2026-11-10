import Gio from 'gi://Gio';

// Shared by Shell and GTK so the module has one identity at every size.
export const AGENT_ICON_NAME = 'ubuntu-island-agents-symbolic';
export const agentIconDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
    .resolve_relative_path('assets/icons');
export const agentIconFile = agentIconDirectory.resolve_relative_path(`hicolor/scalable/actions/${AGENT_ICON_NAME}.svg`);
export const agentIcon = new Gio.FileIcon({file: agentIconFile});
