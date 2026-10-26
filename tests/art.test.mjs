import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Evaluate the real service classes with GI boundaries replaced by fakes.
// No Shell session, D-Bus changes, or developer-machine hardware is required.
function service(file, name, dependencies) {
    const source = readFileSync(new URL(`../services/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    return vm.runInNewContext(`${source}\n${name}`, {...dependencies, console});
}

test('artwork rejects an oversized streamed response before caching or decoding', () => {
    let closed = false;
    let result = 'pending';
    const Request = service('art', 'ArtworkRequest', {GLib: {PRIORITY_DEFAULT_IDLE: 0}});
    const request = new Request();
    request._cancellable = {is_cancelled: () => false};
    request._storeCache = () => assert.fail('oversized response must not enter the cache');
    request._pixbufFromStream = () => assert.fail('oversized response must not decode');
    const stream = {
        read_bytes_async: (size, priority, cancel, callback) => callback(stream, {}),
        read_bytes_finish: () => ({get_size: () => 2 * 1024 * 1024 + 1}),
        close_async: (priority, cancel, callback) => { closed = true; callback(stream, {}); },
        close_finish() {},
    };
    request._readBounded(stream, 'https://example.com/art.png', 64, value => { result = value; });
    assert.equal(closed, true);
    assert.equal(result, null);
});

test('cancelled artwork cannot update the current cover', () => {
    const pending = [];
    const Loader = service('art', 'ArtLoader', {
        GLib: {PRIORITY_DEFAULT_IDLE: 0},
        Gio: {
            Cancellable: class {
                cancel() { this.cancelled = true; }
                is_cancelled() { return Boolean(this.cancelled); }
            },
            FileQueryInfoFlags: {NONE: 0},
            File: {new_for_uri: () => ({
                query_info_async(attributes, flags, priority, cancellable, callback) {
                    pending.push(() => callback({query_info_finish() { throw new Error('old request'); }}, {}));
                },
            })},
        },
    });
    const loader = new Loader();
    let result = 'pending';
    loader.load('file:///old.png', 64, value => { result = value; });
    loader.cancel();
    result = 'unchanged';
    pending[0]();
    assert.equal(result, 'unchanged');
});
