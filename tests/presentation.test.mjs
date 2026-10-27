import test from 'node:test';
import assert from 'node:assert/strict';
import {containsPoint, selectPlayer, layoutSignature, mediaTitle} from '../services/presentation.js';

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

test('a playing player counts even without track metadata', () => {
    // Local video players often expose MPRIS with an empty title.
    const video = {name: 'videos', status: 'Playing', title: ''};
    assert.equal(selectPlayer([video]), video);
    assert.equal(selectPlayer([video], 'other'), video);
    // Once paused, a metadata-less player is treated as idle again.
    assert.equal(selectPlayer([{...video, status: 'Paused'}]), null);
    // When two players play at once, the titled one wins — unless the
    // metadata-less one is the current selection, which then stays put.
    const music = {name: 'music', status: 'Playing', title: 'Song'};
    assert.equal(selectPlayer([video, music]), music);
    assert.equal(selectPlayer([video, music], 'videos'), video);
    assert.equal(selectPlayer([video, music], 'music'), music);
});

test('playing wins over preferred paused player; paused track stays controllable', () => {
    const paused = {name: 'music', status: 'Paused', title: 'Song'};
    const playing = {name: 'video', status: 'Playing', title: 'Video'};
    assert.equal(selectPlayer([paused, playing], 'music'), playing);
    assert.equal(selectPlayer([paused], 'music'), paused);
});

test('mediaTitle derives the file name when the player skips xesam:title', () => {
    // Exactly what VLC exposes for an untagged local file.
    assert.equal(
        mediaTitle('', 'file:///home/user/Videos/nature_documentary.mp4', 'VLC'),
        'nature_documentary');
    assert.equal(mediaTitle('  ', 'file:///media/My%20Movie.mkv', 'VLC'), 'My Movie');
    // A real title always wins; non-file URLs carry no usable basename.
    assert.equal(mediaTitle('Song', 'file:///x/song.flac', 'Player'), 'Song');
    assert.equal(mediaTitle('', 'https://youtu.be/watch?v=x', 'Brave'), 'Brave');
    assert.equal(mediaTitle(undefined, undefined, 'Videos'), 'Videos');
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
