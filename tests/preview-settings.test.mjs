import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('preview copies presentation values into a separate backend without private service settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'island-preview-settings-'));
    try {
        cpSync('extension/schemas', join(root, 'schemas'), {recursive:true});
        execFileSync('glib-compile-schemas', ['--strict', join(root, 'schemas')]);
        const output = execFileSync('gjs', ['-m', 'tests/preview-settings-native.mjs', join(root, 'schemas')], {encoding:'utf8', timeout:5000});
        assert.match(output, /PREVIEW SETTINGS PASS/);
    } finally { rmSync(root, {recursive:true, force:true}); }
});
