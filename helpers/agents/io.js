import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const encoder = new TextEncoder();
export const decoder = new TextDecoder('utf-8', {fatal: true});
export function readChunk(stream, size, cancel = null) {
    return new Promise((resolve, reject) => stream.read_bytes_async(size, GLib.PRIORITY_DEFAULT, cancel,
        (s, result) => { try { resolve(s.read_bytes_finish(result).get_data()); } catch (e) { reject(e); } }));
}
export function writeBytes(stream, bytes, cancel = null) {
    return new Promise((resolve, reject) => stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel,
        (s, result) => { try { s.write_all_finish(result); resolve(); } catch (e) { reject(e); } }));
}
export async function readBounded(stream, limit, cancel = null) {
    let parts = [], count = 0;
    while (true) {
        const bytes = await readChunk(stream, Math.min(4096, limit + 1 - count), cancel);
        if (!bytes.length) break;
        count += bytes.length;
        if (count > limit) throw new Error('Input exceeds limit');
        parts.push(bytes);
    }
    const result = new Uint8Array(count); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return decoder.decode(result);
}
export function runtimePath() {
    const root = GLib.getenv('XDG_RUNTIME_DIR');
    if (!root?.startsWith('/')) throw new Error('XDG_RUNTIME_DIR is unavailable');
    return GLib.getenv('UBUNTU_ISLAND_AGENT_SOCKET') || `${root}/ubuntu-island-agents/events.sock`;
}
export function privateDirectory(path) {
    const file = Gio.File.new_for_path(path);
    try { file.make_directory_with_parents(null); } catch (e) { if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw e; }
    const info = file.query_info('standard::type,standard::is-symlink,unix::uid,unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    const me = new Gio.Credentials().get_unix_user();
    if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY || info.get_attribute_uint32('unix::uid') !== me)
        throw new Error('Unsafe runtime directory');
    file.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
}
