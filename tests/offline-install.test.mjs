import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('installer delivers offline status assets and preserves them on reinstall', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'island-offline-install-'));
    const root = resolve(import.meta.dirname, '..');
    const env = {...process.env, XDG_DATA_HOME: temporary};
    const extensions = join(temporary, 'gnome-shell/extensions');
    const destination = join(extensions, 'ubuntu-island@mhbahmani.github.io');
    const files = ['services/connectivity.js', 'assets/notch/unplug-symbolic.svg'];
    try {
        execFileSync('sh', [join(root, 'scripts/install.sh')], {env});
        for (const file of files)
            assert.equal(readFileSync(join(destination, file), 'utf8'), readFileSync(join(root, file), 'utf8'));
        execFileSync('sh', [join(root, 'scripts/install.sh')], {env});
        const backup = readdirSync(extensions).find(name => name.includes('.backup.'));
        assert.ok(backup, 'Reinstall must preserve the previous extension');
        for (const file of files)
            assert.equal(readFileSync(join(extensions, backup, file), 'utf8'), readFileSync(join(root, file), 'utf8'));
    } finally { rmSync(temporary, {recursive: true, force: true}); }
});
