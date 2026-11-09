import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AGENTS, AGENT_SITES, agentLaunchArgv} from './agents-model.js';

export function agentExecutable(provider, override = '') {
    if (!Object.hasOwn(AGENTS, provider)) return null;
    if (override) return override.startsWith('/') && GLib.file_test(override, GLib.FileTest.IS_EXECUTABLE) ? override : null;
    const home = GLib.get_home_dir();
    return GLib.find_program_in_path(provider) || [`${home}/.local/bin/${provider}`, `${home}/.opencode/bin/${provider}`]
        .find(path => GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) || null;
}
export function desktopTarget(settings, provider) {
    const id = settings.get_string(`agents-${provider}-desktop`);
    return id ? Gio.DesktopAppInfo.new(id) : null;
}
export function launchAgent(settings, {provider, destination, prompt, cwd, copy}, context) {
    if (!Object.hasOwn(AGENTS, provider)) throw new Error('Choose an agent.');
    if (!prompt.trim() || prompt.length > 16000 || prompt.includes('\0')) throw new Error('Enter a prompt of 1–16,000 characters.');
    if (destination === 'terminal') {
        const executable = agentExecutable(provider, settings.get_string(`agents-${provider}-executable`));
        if (!executable) throw new Error(`${AGENTS[provider]} CLI was not found. Set its executable in preferences.`);
        if (!GLib.file_test(cwd, GLib.FileTest.IS_DIR)) throw new Error('Choose an existing project folder.');
        const terminal = settings.get_string('agents-terminal');
        if (!GLib.find_program_in_path(terminal)) throw new Error(`${terminal} is not installed. Choose a terminal in preferences.`);
        const argv = agentLaunchArgv(provider, executable, prompt, cwd, terminal);
        const launcher = new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});
        launcher.set_cwd(cwd);
        launcher.setenv('UBUNTU_ISLAND_AGENT_LAUNCH', GLib.uuid_string_random(), true);
        launcher.spawnv(argv);
        return 'Terminal launched. The agent handles sign-in and permissions.';
    }
    if (destination === 'desktop') {
        const app = desktopTarget(settings, provider);
        if (!app) throw new Error('Choose an installed desktop app in Agents preferences.');
        app.launch([], context); copy(prompt);
        return 'Prompt copied. Paste it in the app.';
    }
    if (destination === 'web') {
        if (provider === 'opencode') throw new Error('OpenCode has no hosted chat destination here. Choose Terminal or Desktop.');
        Gio.AppInfo.launch_default_for_uri(AGENT_SITES[provider], context);
        copy(prompt);
        return 'Prompt copied. Paste it in the browser.';
    }
    if (destination === 'copy-terminal') {
        const executable = agentExecutable(provider, settings.get_string(`agents-${provider}-executable`));
        if (!executable || !GLib.file_test(cwd, GLib.FileTest.IS_DIR)) throw new Error('Choose an installed CLI and existing project folder.');
        const terminal = settings.get_string('agents-terminal');
        const argv = agentLaunchArgv(provider, executable, 'placeholder', cwd, terminal);
        if (provider === 'opencode') argv.pop();
        else { argv.pop(); argv.pop(); }
        const launcher = new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});
        launcher.set_cwd(cwd); launcher.spawnv(argv); copy(prompt);
        return 'Prompt copied. Paste it in the terminal.';
    }
    throw new Error('Choose a destination.');
}
