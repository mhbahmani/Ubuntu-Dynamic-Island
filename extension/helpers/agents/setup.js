// Explicitly invoked by preferences. Only owned hook entries/plugin files change.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {AGENTS} from '../../services/agents-model.js';
import {agentConfigDirectory} from '../../services/agent-launch.js';
import {hasAgentHooks, hookEntries, mergeAgentHooks, openCodePlugin} from '../../services/agents-setup-model.js';
import {runtimePath, encoder, decoder} from './io.js';

const [action, provider, directory = '', major = '1'] = ARGV;
function read(file) {
    let info;
    try { info = file.query_info('standard::size,standard::is-symlink,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null); }
    catch (error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return {text:'', etag:null};
        throw error;
    }
    if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > 1048576)
        throw new Error('Configuration must be a regular file smaller than 1 MiB.');
    const [, bytes, etag] = file.load_contents(null);
    return {text: decoder.decode(bytes), etag};
}
try {
    if (!Object.hasOwn(AGENTS, provider) || !['plan','status','install','remove'].includes(action)) throw new Error('Invalid setup action.');
    const config = directory || agentConfigDirectory(provider);
    if (!config.startsWith('/')) throw new Error('Configuration directory must be absolute.');
    const relay = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('relay.js').get_path();
    const path = provider === 'opencode' ? `${config}/plugins/ubuntu-island-status.js`
        : `${config}/${provider === 'claude' ? 'settings.json' : 'hooks.json'}`;
    const file = Gio.File.new_for_path(path);
    const old = read(file);
    let next, installed;
    if (provider === 'opencode') {
        installed = old.text.startsWith('// ubuntu-island-agent-v1\n');
        if (old.text && !installed) throw new Error('A different plugin already uses this filename.');
        if (!['1','2'].includes(major)) throw new Error('Choose OpenCode V1 or V2.');
        next = openCodePlugin(runtimePath(), Number(major));
    } else {
        let parsed; try { parsed = old.text ? JSON.parse(old.text) : {}; }
        catch { throw new Error('Configuration is not plain JSON. Convert it to valid JSON before using this setup helper; the file was not changed.'); }
        installed = hasAgentHooks(parsed);
        next = `${JSON.stringify(mergeAgentHooks(parsed, provider, relay, action !== 'remove'), null, 2)}\n`;
    }
    if (['install','remove'].includes(action)) {
        if (action === 'remove' && !installed) { /* No mutation for an absent integration. */ }
        else {
            // Never chmod an existing provider directory. Only create missing parents.
            if (!file.get_parent().query_exists(null)) {
                file.get_parent().make_directory_with_parents(null);
            }
            if (provider === 'opencode' && action === 'remove') {
                // Preserve a recoverable backup before deleting our plugin.
                const latest = read(file);
                if (latest.etag !== old.etag) throw new Error('Configuration changed; inspect and retry.');
                file.copy(Gio.File.new_for_path(`${path}.bak`), Gio.FileCopyFlags.OVERWRITE, null, null);
                file.delete(null);
            } else if (next !== old.text) {
                file.replace_contents(encoder.encode(next), old.etag, Boolean(old.text), Gio.FileCreateFlags.PRIVATE, null);
            }
            installed = action === 'install';
        }
    }
    print(JSON.stringify({ok:true, installed, path,
        note: provider === 'codex' ? 'Review and trust the new hooks in Codex /hooks, then start a new session.' : 'Restart the agent to load the integration.',
        snippet: action === 'plan' ? provider === 'opencode' ? next : JSON.stringify({hooks:hookEntries(provider,relay)},null,2) : undefined}));
} catch (error) { print(JSON.stringify({ok:false,error:error.message})); System.exit(1); }
