import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoutingKey} from '../services/commute-validation.js';

test('validation uses one public test route with correct provider credentials', async () => {
    for (const provider of ['mapbox', 'neshan', 'ors', 'graphhopper']) {
        let calls = 0;
        await validateRoutingKey(provider, ' test-key ', async (url, headers) => {
            calls++;
            assert.match(url + JSON.stringify(headers), /test-key/);
            if (provider === 'graphhopper') return {paths: [{time: 60000, distance: 100}]};
            if (provider === 'ors') return {features: [{properties: {summary: {duration: 60, distance: 100}}}]};
            if (provider === 'neshan') return {routes: [{legs: [{duration: {value: 60}, distance: {value: 100}}]}]};
            return {code: 'Ok', routes: [{duration: 60, distance: 100}]};
        });
        assert.equal(calls, 1);
    }
});
test('validation errors are specific and never expose credentials', async () => {
    for (const [status, message] of [[401, /Key rejected/], [403, /Access denied/], [429, /Quota/], [500, /Could not verify/]]) {
        await assert.rejects(validateRoutingKey('mapbox', 'secret', async () => {
            throw Object.assign(new Error('secret authenticated URL'), {status});
        }), error => message.test(error.message) && !error.message.includes('secret'));
    }
    await assert.rejects(validateRoutingKey('ors', 'key', async () => ({})), /Could not verify/);
    await assert.rejects(validateRoutingKey('ors', '', async () => { throw Error('must not call'); }), /Enter an API key/);
});
