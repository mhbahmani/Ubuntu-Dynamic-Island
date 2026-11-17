import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const installer = join(root, 'scripts/install-github.sh');
const uuid = 'ubuntu-island@mhbahmani.github.io';

// Only HTTP and UID detection are stubbed. Extraction and the regular installer
// run for real, with isolated data/cache/temp paths and package installation off.
function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'island github test '));
    const bin = join(directory, 'bin'), temporary = join(directory, 'temporary');
    const checkout = join(directory, 'owner-project-abcd');
    for (const path of [bin, temporary, checkout]) mkdirSync(path);
    for (const name of ['extension.js', 'prefs.js', 'metadata.json', 'stylesheet.css',
        'ui', 'preferences', 'services', 'helpers', 'assets', 'schemas'])
        cpSync(join(root, name), join(checkout, name), {recursive: true});
    mkdirSync(join(checkout, 'scripts'));
    for (const name of ['install.sh', 'install-dependencies.sh'])
        cpSync(join(root, 'scripts', name), join(checkout, 'scripts', name));
    const archive = join(directory, 'source.tar.gz');
    const pack = () => execFileSync('tar', ['-czf', archive, '-C', directory, 'owner-project-abcd']);
    pack();
    const calls = join(directory, 'curl.json');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_CURL_CALLS, JSON.stringify(args));
const output = args[args.indexOf('--output') + 1];
if (process.env.TEST_DOWNLOAD === 'corrupt') fs.writeFileSync(output, 'not an archive');
else fs.copyFileSync(process.env.TEST_ARCHIVE, output);
if (process.env.TEST_DOWNLOAD === 'failed') process.exit(22);
`, {mode: 0o755});
    writeFileSync(join(bin, 'id'), '#!/bin/sh\nprintf "%s\\n" "${TEST_UID:-1001}"\n', {mode: 0o755});
    const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary,
        XDG_DATA_HOME: join(directory, 'data'), XDG_CACHE_HOME: join(directory, 'cache'),
        INSTALL_DEPS: '0', TEST_ARCHIVE: archive, TEST_CURL_CALLS: calls};
    const base = join(env.XDG_DATA_HOME, 'gnome-shell/extensions');
    const destination = join(base, uuid);
    return {directory, checkout, archive, pack, calls, env, base, destination,
        run: (...args) => spawnSync('sh', [installer, ...args],
            {env, encoding: 'utf8', timeout: 20000}),
        assertClean: () => assert.deepEqual(readdirSync(temporary), [], 'Temporary downloads must be removed'),
        seed: () => { mkdirSync(destination, {recursive: true}); writeFileSync(join(destination, 'previous'), 'keep me'); },
        cleanup: () => rmSync(directory, {recursive: true, force: true})};
}

test('GitHub installer installs a default-branch archive and backs up updates', () => {
    const f = fixture();
    try {
        let result = f.run();
        assert.equal(result.status, 0, result.stderr);
        const args = JSON.parse(readFileSync(f.calls, 'utf8'));
        assert.equal(args.at(-1), 'https://api.github.com/repos/mhbahmani/Ubuntu-Dynamic-Island/tarball');
        for (const flag of ['--fail', '--location', '--connect-timeout', '--max-time', '--proto-redir'])
            assert.ok(args.includes(flag), flag);
        for (const name of ['extension.js', 'ui/pill.js', 'helpers/agents/bridge.js'])
            assert.deepEqual(readFileSync(join(f.destination, name)), readFileSync(join(root, name)));
        assert.ok(existsSync(join(f.destination, 'schemas/gschemas.compiled')));
        assert.ok(existsSync(join(f.env.XDG_DATA_HOME, 'applications/ubuntu-island.desktop')));
        assert.ok(existsSync(join(f.env.XDG_DATA_HOME, 'fonts/ubuntu-island-vazir-v30.1.0/Vazir-Regular.ttf')));
        assert.ok(!existsSync(join(f.destination, 'scripts')));
        f.assertClean();
        writeFileSync(join(f.destination, 'previous'), 'keep me');
        result = f.run('--repo', 'example/ubuntu-island', '--ref', 'refs/tags/v11');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(readFileSync(f.calls, 'utf8')).at(-1),
            'https://api.github.com/repos/example/ubuntu-island/tarball/refs/tags/v11');
        const backup = readdirSync(f.base).find(name => name.startsWith(`${uuid}.backup.`));
        assert.ok(backup);
        assert.equal(readFileSync(join(f.base, backup, 'previous'), 'utf8'), 'keep me');
        assert.ok(!existsSync(join(f.destination, 'previous')));
        assert.match(result.stdout, /log out and back in/);
        f.assertClean();
    } finally { f.cleanup(); }
});

test('failed, corrupt and incomplete downloads leave the installed extension untouched', () => {
    const f = fixture();
    try {
        f.seed();
        for (const mode of ['failed', 'corrupt', 'incomplete', 'wrong-extension']) {
            f.env.TEST_DOWNLOAD = mode;
            if (mode === 'incomplete') rmSync(join(f.checkout, 'scripts/install.sh'));
            if (mode === 'wrong-extension') {
                cpSync(join(root, 'scripts/install.sh'), join(f.checkout, 'scripts/install.sh'));
                writeFileSync(join(f.checkout, 'metadata.json'), '{"uuid":"different-extension"}');
            }
            if (['incomplete', 'wrong-extension'].includes(mode)) f.pack();
            const result = f.run();
            assert.notEqual(result.status, 0, mode);
            assert.match(result.stderr, /Nothing was installed/);
            assert.equal(readFileSync(join(f.destination, 'previous'), 'utf8'), 'keep me');
            assert.deepEqual(readdirSync(f.base), [uuid]);
            f.assertClean();
        }
    } finally { f.cleanup(); }
});

test('invalid options and root execution fail before fetching or changing files', () => {
    const f = fixture();
    try {
        f.seed();
        for (const args of [['--repo', '../wrong'], ['--repo', 'a/b/c'], ['--repo', 'https://github.com/a/b'],
            ['--ref', 'main?redirect=other'], ['--ref', '../../main'], ['--ref'], ['--unknown']]) {
            assert.notEqual(f.run(...args).status, 0, args.join(' '));
            assert.ok(!existsSync(f.calls));
        }
        f.env.TEST_UID = '0';
        assert.match(f.run().stderr, /regular desktop user/);
        f.env.TEST_UID = '1001'; f.env.INSTALL_DEPS = 'invalid';
        assert.match(f.run().stderr, /INSTALL_DEPS/);
        assert.ok(!existsSync(f.calls));
        assert.equal(readFileSync(join(f.destination, 'previous'), 'utf8'), 'keep me');
        assert.equal(f.run('--help').status, 0);
        f.assertClean();
    } finally { f.cleanup(); }
});
