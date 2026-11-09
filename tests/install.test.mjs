import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Exercise the actual installer without touching the user's installation.
test('installer includes every runtime module and preserves the previous install', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'island-install-test-'));
    const root = resolve(import.meta.dirname, '..');
    const env = {...process.env, XDG_DATA_HOME: temporary};
    const destination = join(temporary, 'gnome-shell/extensions/ubuntu-island@mhbahmani.github.io');
    try {
        execFileSync('sh', [join(root, 'install.sh')], {env});
        const modules = readdirSync(root).filter(name => name.endsWith('.js'));
        for (const name of modules) {
            assert.equal(readFileSync(join(destination, name), 'utf8'), readFileSync(join(root, name), 'utf8'), name);
        }
        assert.ok(existsSync(join(destination, 'schemas/gschemas.compiled')));
        for (const name of readdirSync(join(root, 'helpers/agents')))
            assert.equal(readFileSync(join(destination, 'helpers/agents', name), 'utf8'), readFileSync(join(root, 'helpers/agents', name), 'utf8'), name);
        for (const name of readdirSync(join(root, 'services')).filter(name => name.endsWith('.js')))
            assert.equal(readFileSync(join(destination, 'services', name), 'utf8'), readFileSync(join(root, 'services', name), 'utf8'), name);
        assert.equal(readFileSync(join(destination, 'assets/commute-driving-symbolic.svg'), 'utf8'),
            readFileSync(join(root, 'assets/commute-driving-symbolic.svg'), 'utf8'));
        assert.ok(existsSync(join(temporary, 'applications/ubuntu-island.desktop')));
        execFileSync('sh', [join(root, 'install.sh')], {env});
        const backup = readdirSync(join(temporary, 'gnome-shell/extensions')).find(name => name.includes('.backup.'));
        assert.ok(backup, 'Reinstallation must preserve the old extension');
        const backupDirectory = join(temporary, 'gnome-shell/extensions', backup);
        for (const name of modules)
            assert.equal(readFileSync(join(backupDirectory, name), 'utf8'), readFileSync(join(root, name), 'utf8'), `backup ${name}`);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
});
