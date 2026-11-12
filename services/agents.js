import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readChunk, writeBytes, encoder, decoder, runtimePath} from '../helpers/agents/io.js';

export class AgentsService {
    constructor(path, emit) { this.path = path; this.emit = emit; this.generation = 0; }
    start() {
        if (this.process) return;
        const generation = ++this.generation;
        this.cancel = new Gio.Cancellable();
        this.emit({connected:false, sessions:[], message:'Starting local observer…'});
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
            this.process = launcher.spawnv(['/usr/bin/gjs', '-m', `${this.path}/helpers/agents/bridge.js`]);
            this._read(generation, this.process.get_stdout_pipe());
            this._writeVisibility();
            this.process.wait_async(null, (p, result) => {
                try { p.wait_finish(result); } catch {}
                if (generation !== this.generation) return;
                this.process = null;
                this.emit({connected:false, sessions:[], message:'Observer stopped. Re-enable Agents to reconnect.'});
            });
        } catch {
            this.process = null;
            this.emit({connected:false, sessions:[], message:'Could not start the local observer.'});
        }
    }
    setTitlesVisible(active) {
        this.titlesVisible = Boolean(active);
        this._writeVisibility();
    }
    async _writeVisibility() {
        if (!this.process || this.visibilityWriting) return;
        this.visibilityWriting = this.process;
        const process = this.process, cancel = this.cancel;
        try {
            do {
                this.visibilitySent = Boolean(this.titlesVisible);
                await writeBytes(process.get_stdin_pipe(), encoder.encode(`${JSON.stringify({titles:this.visibilitySent})}\n`), cancel);
            } while (!cancel.is_cancelled() && this.visibilitySent !== Boolean(this.titlesVisible));
        } catch { /* Shutdown cancels writes. */ }
        finally {
            if (this.visibilityWriting === process) this.visibilityWriting = null;
            if (this.process && this.process !== process) this._writeVisibility();
        }
    }
    async _read(generation, stream) {
        let buffer = new Uint8Array();
        try {
            while (generation === this.generation) {
                const bytes = await readChunk(stream, 8192, this.cancel);
                if (!bytes.length) break;
                const combined = new Uint8Array(buffer.length + bytes.length);
                combined.set(buffer); combined.set(bytes, buffer.length); buffer = combined;
                let end;
                while ((end = buffer.indexOf(10)) >= 0) {
                    if (end > 131072) throw new Error('Snapshot too large');
                    const snapshot = JSON.parse(decoder.decode(buffer.slice(0, end)));
                    buffer = buffer.slice(end + 1);
                    if (snapshot.v !== 1 || !Array.isArray(snapshot.sessions) || snapshot.sessions.length > 32) throw new Error('Invalid snapshot');
                    if (generation === this.generation) this.emit(snapshot);
                }
                if (buffer.length > 131072) throw new Error('Snapshot too large');
            }
        } catch {
            if (generation === this.generation) {
                this.emit({connected:false, sessions:[], message:'Observer connection lost. Re-enable Agents to reconnect.'});
                this.process?.send_signal(15);
            }
        }
    }
    async send(value) {
        const cancel = this.cancel;
        if (!cancel || cancel.is_cancelled()) throw new Error('The observer is disabled.');
        const local = new Gio.Cancellable();
        let expired = false;
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { expired = true; local.cancel(); return GLib.SOURCE_REMOVE; });
        const id = cancel.connect(() => local.cancel());
        let connection;
        try {
            const client = new Gio.SocketClient({timeout:1});
            connection = await new Promise((resolve, reject) => client.connect_async(new Gio.UnixSocketAddress({path:runtimePath()}), local,
                (c, r) => { try { resolve(c.connect_finish(r)); } catch (e) { reject(e); } }));
            await writeBytes(connection.get_output_stream(), encoder.encode(JSON.stringify({v:1,...value})), local);
        } finally {
            if (!expired) GLib.Source.remove(source);
            cancel.disconnect(id);
            try { connection?.close(null); } catch {}
        }
    }
    stop() {
        this.generation++;
        this.cancel?.cancel();
        try { this.process?.get_stdin_pipe().close(null); } catch {}
        // EOF requests orderly shutdown, including unlinking only its own socket.
        this.process = null;
        this.cancel = null;
    }
}
