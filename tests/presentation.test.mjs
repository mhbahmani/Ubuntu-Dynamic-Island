import test from 'node:test';
import assert from 'node:assert/strict';
import {containsPoint, selectPlayer, layoutSignature} from '../services/presentation.js';

test('outside dismissal uses global geometry, including negative monitor origins', () => {
    assert.equal(containsPoint(-900, 30, -1000, 0, 440, 500), true);
    assert.equal(containsPoint(-1001, 30, -1000, 0, 440, 500), false);
    assert.equal(containsPoint(-560, 30, -1000, 0, 440, 500), false);
    assert.equal(containsPoint(-900, 500, -1000, 0, 440, 500), false);
});

test('idle browser registrations never create a media section', () => {
    assert.equal(selectPlayer([{name: 'browser', status: 'Stopped', title: 'Old tab'}]), null);
    assert.equal(selectPlayer([{name: 'browser', status: 'Paused', title: '   '}]), null);
    assert.equal(selectPlayer([]), null);
});

test('playing wins over preferred paused player; paused track stays controllable', () => {
    const paused = {name: 'music', status: 'Paused', title: 'Song'};
    const playing = {name: 'video', status: 'Playing', title: 'Video'};
    assert.equal(selectPlayer([paused, playing], 'music'), playing);
    assert.equal(selectPlayer([paused], 'music'), paused);
});

test('layout signature stays stable across interleaved model events and volume changes', () => {
    const states = {media: {available: false}, audio: {available: true, volume: .5, outputs: [{id: 1}]}};
    const initial = layoutSignature(states);
    states.audio.volume = .7;
    assert.equal(layoutSignature(states), initial);
    states.bluetooth = {available: true, powered: false, devices: []};
    const bluetooth = layoutSignature(states);
    assert.notEqual(bluetooth, initial);
    assert.equal(layoutSignature(states), bluetooth);
    states.media.available = true;
    assert.notEqual(layoutSignature(states), bluetooth);
});
