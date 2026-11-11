import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AGENTS, TERMINALS, TERMINAL_NAMES, agentLaunchArgv} from './agents-model.js';

export function agentExecutable(provider, override = '') {
    if (!Object.hasOwn(AGENTS, provider)) return null;
    const executable = path => path?.startsWith('/') &&
        GLib.file_test(path, GLib.FileTest.IS_REGULAR) && GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE);
    if (override) return executable(override) ? override : null;
    const home = GLib.get_home_dir();
    const folders = [GLib.getenv('NVM_BIN'), GLib.getenv('NPM_CONFIG_PREFIX') && `${GLib.getenv('NPM_CONFIG_PREFIX')}/bin`,
        `${home}/.local/bin`, `${home}/.opencode/bin`, `${home}/.npm-global/bin`, `${home}/.bun/bin`, `${home}/bin`];
    return [GLib.find_program_in_path(provider), ...folders.filter(Boolean).map(dir => `${dir}/${provider}`)]
        .find(executable) || null;
}

export function agentConfigDirectory(provider) {
    const home = GLib.get_home_dir();
    if (provider === 'claude') return GLib.getenv('CLAUDE_CONFIG_DIR') || `${home}/.claude`;
    if (provider === 'codex') return GLib.getenv('CODEX_HOME') || `${home}/.codex`;
    return `${GLib.get_user_config_dir()}/opencode`;
}

// Resolve the desktop terminal without spawning shell commands. Debian/Ubuntu
// expose their default through a symlink chain, usually x-terminal-emulator.
function terminalCommand(command) {
    let args;
    try { [, args] = GLib.shell_parse_argv(command); } catch { return null; }
    if (!args?.length) return null;
    const original = GLib.find_program_in_path(args[0]);
    if (!original) return null;
    let path = original;
    try {
        for (let i = 0; i < 8; i++) {
            const file = Gio.File.new_for_path(path);
            const info = file.query_info('standard::is-symlink,standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            if (!info.get_is_symlink()) break;
            const target = info.get_symlink_target();
            path = GLib.canonicalize_filename(target, GLib.path_get_dirname(path));
        }
    } catch { return null; }
    const name = GLib.path_get_basename(path).replace(/\.wrapper$/, '');
    const id = TERMINALS.includes(name) ? name
        : GLib.path_get_basename(original) === 'x-terminal-emulator' ? 'x-terminal-emulator' : null;
    return id ? {id, executable:original, args:args.slice(1), name:TERMINAL_NAMES[id] || name} : null;
}

export function defaultTerminal() {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup('org.gnome.desktop.default-applications.terminal', true);
    if (schema?.has_key('exec')) {
        const desktop = new Gio.Settings({settings_schema:schema});
        const selected = terminalCommand(desktop.get_string('exec'));
        if (selected) return selected;
    }
    return terminalCommand('x-terminal-emulator') || TERMINALS.map(terminalCommand).find(Boolean) || null;
}

export function agentTerminal(selection = 'auto') {
    return selection === 'auto' ? defaultTerminal() : TERMINALS.includes(selection) ? terminalCommand(selection) : null;
}

// Fill only unset values, once on enable/preferences opening. No processes,
// provider configuration writes, or background scans are needed for discovery.
export function initializeAgentSettings(settings) {
    const available = [];
    for (const provider of Object.keys(AGENTS)) {
        const key = `agents-${provider}-executable`;
        const executable = agentExecutable(provider, settings.get_string(key));
        if (executable) {
            available.push(provider);
            if (!settings.get_string(key)) settings.set_string(key, executable);
        }
        const config = `agents-${provider}-config`;
        if (!settings.get_string(config)) settings.set_string(config, agentConfigDirectory(provider));
    }
    if (!settings.get_user_value('agents-provider') && available.length)
        settings.set_string('agents-provider', available[0]);
    // Earlier versions persisted the first installed terminal (usually GNOME)
    // as if the user had chosen it. Move that legacy default to system selection
    // once; subsequent explicit choices, including GNOME Terminal, stay intact.
    if (!settings.get_boolean('agents-terminal-default-migrated')) {
        if (settings.get_string('agents-terminal') === 'gnome-terminal') settings.reset('agents-terminal');
        settings.set_boolean('agents-terminal-default-migrated', true);
    }
    if (!settings.get_string('agents-project')) settings.set_string('agents-project', GLib.get_home_dir());
}

export function launchAgent(settings, {provider, prompt, cwd}) {
    if (!Object.hasOwn(AGENTS, provider)) throw new Error('Choose a harness.');
    if (!prompt.trim() || prompt.length > 16000 || prompt.includes('\0')) throw new Error('Enter a prompt of 1–16,000 characters.');
    const executable = agentExecutable(provider, settings.get_string(`agents-${provider}-executable`));
    if (!executable) throw new Error(`${AGENTS[provider]} CLI was not found. Install it or choose its executable in Agents settings.`);
    cwd = cwd?.trim() || GLib.get_home_dir();
    if (!GLib.file_test(cwd, GLib.FileTest.IS_DIR)) throw new Error('Choose an existing project folder.');
    const terminal = agentTerminal(settings.get_string('agents-terminal'));
    if (!terminal) throw new Error('No supported terminal was found. Choose a terminal in Agents settings.');
    const argv = agentLaunchArgv(provider, executable, prompt, cwd, terminal.id);
    argv[0] = terminal.executable;
    argv.splice(1, 0, ...terminal.args);
    const launcher = new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});
    launcher.set_cwd(cwd);
    launcher.setenv('UBUNTU_ISLAND_AGENT_LAUNCH', GLib.uuid_string_random(), true);
    launcher.spawnv(argv);
    return 'Session started in terminal.';
}
