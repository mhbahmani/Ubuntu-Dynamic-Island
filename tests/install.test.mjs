import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, cpSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {execFileSync} from 'node:child_process';

// Exercise the actual installer without touching the user's installation.
test('installer includes every runtime module and preserves the previous install', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'island-install-test-'));
    const project = resolve(import.meta.dirname, '..');
    const root = join(project, 'extension');
    const env = {...process.env, XDG_DATA_HOME: temporary, INSTALL_DEPS: '0'};
    const destination = join(temporary, 'gnome-shell/extensions/ubuntu-island@mhbahmani.github.io');
    try {
        execFileSync('sh', [join(project, 'scripts/install.sh'), '--local', project], {env});
        const modules = runtimeFiles(root);
        for (const name of ['services/connectivity.js', 'assets/notch/unplug-symbolic.svg'])
            assert.ok(modules.includes(name), `Missing offline status file: ${name}`);
        verifyRuntime(root, destination, modules);
        assert.ok(existsSync(join(destination, 'schemas/gschemas.compiled')));
        verifyLegacySettings(destination);
        assert.ok(existsSync(join(temporary, 'applications/ubuntu-island.desktop')));
        for (const name of ['Vazir-Regular.ttf','Vazir-Medium.ttf','Vazir-Bold.ttf','OFL.txt'])
            assert.deepEqual(readFileSync(join(temporary,'fonts/ubuntu-island-vazir-v30.1.0',name)),
                readFileSync(join(root,'assets/fonts',name)));
        execFileSync('sh', [join(project, 'scripts/install.sh'), '--local', project], {env});
        const backup = readdirSync(join(temporary, 'gnome-shell/extensions')).find(name => name.includes('.backup.'));
        assert.ok(backup, 'Reinstallation must preserve the old extension');
        const backupDirectory = join(temporary, 'gnome-shell/extensions', backup);
        verifyRuntime(root, backupDirectory, modules);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
});

const runtimeDirectories = ['ui', 'preferences', 'services', 'helpers', 'assets'];

function runtimeFiles(root) {
    return ['extension.js', 'prefs.js', 'metadata.json', 'stylesheet.css',
        ...runtimeDirectories.flatMap(directory => readdirSync(join(root, directory), {recursive: true, withFileTypes: true})
            .filter(entry => entry.isFile())
            .map(entry => relative(root, join(entry.parentPath, entry.name))))];
}

function verifyRuntime(root, destination, files) {
    for (const name of files) {
        assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(root, name)), name);
        if (!name.endsWith('.js')) continue;
        const source = readFileSync(join(destination, name), 'utf8');
        for (const [, relative] of source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+\.js)['"]/g)) {
            assert.ok(existsSync(resolve(destination, name, '..', relative)), `${name}: missing ${relative}`);
        }
    }
}

// Shell keeps loaded modules across extension toggles. After an in-session
// install, the old Agents view can read the newly compiled schema on enable.
function verifyLegacySettings(destination) {
    execFileSync('gjs', ['-c', `
        const Gio = imports.gi.Gio;
        const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0], Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup('org.gnome.shell.extensions.ubuntu-island', false);
        const settings = new Gio.Settings({settings_schema: schema});
        const expected = {
            'agents-destination': 'terminal',
            'agents-claude-desktop': '',
            'agents-codex-desktop': '',
            'agents-opencode-desktop': '',
        };
        for (const [key, value] of Object.entries(expected)) {
            if (settings.get_string(key) !== value)
                throw new Error('Legacy settings changed: ' + key);
            const signal = settings.connect('changed::' + key, () => {});
            settings.disconnect(signal);
        }
        for (const destination of ['terminal', 'copy-terminal', 'desktop', 'web']) {
            if (!settings.set_string('agents-destination', destination) || settings.get_string('agents-destination') !== destination)
                throw new Error('Legacy destination no longer supported: ' + destination);
        }
    `, join(destination, 'schemas')], {env: {...process.env, GSETTINGS_BACKEND: 'memory'}, timeout: 5000});
}

test('ZIP preserves the runtime layout and replaces stale archive entries', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'island-build-test-'));
    const project = resolve(import.meta.dirname, '..');
    const root = join(project, 'extension');
    const files = runtimeFiles(root);
    try {
        // Build from a private checkout so the test does not replace release artifacts.
        cpSync(root, join(temporary, 'extension'), {recursive: true});
        mkdirSync(join(temporary, 'scripts'));
        cpSync(join(project, 'scripts/build.sh'), join(temporary, 'scripts/build.sh'));
        const build = () => execFileSync('sh', [join(temporary, 'scripts/build.sh')], {cwd: tmpdir()});
        build();
        const archive = join(temporary, 'dist', readdirSync(join(temporary, 'dist')).find(name => name.endsWith('.zip')));
        writeFileSync(join(temporary, 'retired-module.js'), '// no longer shipped');
        execFileSync('zip', ['-q', archive, 'retired-module.js'], {cwd: temporary});
        build();
        const destination = join(temporary, 'unpacked');
        execFileSync('unzip', ['-q', archive, '-d', destination]);
        verifyRuntime(root, destination, files);
        assert.ok(existsSync(join(destination, 'schemas/gschemas.compiled')));
        verifyLegacySettings(destination);
        assert.ok(!existsSync(join(destination, 'retired-module.js')));
        for (const name of ['scripts', 'tests', 'docs', 'dist', 'AGENTS.md'])
            assert.ok(!existsSync(join(destination, name)), `${name} must not be packaged`);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
});
