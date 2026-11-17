import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseLyrics, lyricsKey, lyricsUrl} from '../extension/services/lyrics-model.js';
import {roundedCover} from '../extension/services/artwork-model.js';

const source = readFileSync(new URL('../extension/services/lyrics.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
const Lyrics = vm.runInNewContext(`${source}\nLyricsService`, {parseLyrics, lyricsKey, lyricsUrl});
const song = {title: 'A & B', artist: 'Singer', album: 'Album', lengthSec: 180};

test('lyrics parsing supports multiple stamps, offsets within seconds, plain text and instrumentals', () => {
    const result = parseLyrics({syncedLyrics: '[00:03.50][00:01.250]Hi <there>\n[00:99.0]Invalid\n[00:05.10]'});
    assert.deepEqual(result.lines, [{time: 1.25, text: 'Hi <there>'}, {time: 3.5, text: 'Hi <there>'}, {time: 5.1, text: ''}]);
    assert.equal(parseLyrics({instrumental: true}).message, 'Instrumental track');
    assert.equal(parseLyrics({plainLyrics: 'Hello\nworld'}).lines.length, 2);
    assert.equal(parseLyrics({}).lines.length, 0);
    assert.equal(parseLyrics({plainLyrics: 'Line\n'.repeat(800)}).lines.length, 600);
    const url = new URL(lyricsUrl(song));
    assert.equal(url.searchParams.get('track_name'), 'A & B');
    assert.equal(url.searchParams.get('duration'), '180');
    assert.equal(lyricsUrl({title: 'No artist'}), null);
});

test('lyrics coalesces requests, caches successful lookups and ignores hidden/old-track responses', async () => {
    let now = 0, output, requests = 0, resolve;
    const http = {cancel() {}, get() { requests++; return new Promise(done => { resolve = done; }); }};
    const service = new Lyrics(state => { output = state; }, http, () => now);
    const first = service.load(song);
    service.load(song);
    assert.equal(requests, 1);
    service.cancel();
    resolve({plainLyrics: 'Old'});
    await first;
    assert.equal(output.lines.length, 0);
    now = 1000;
    const second = service.load(song);
    resolve({plainLyrics: 'New'});
    await second;
    assert.equal(output.lines[0].text, 'New');
    service.cancel();
    await service.load(song);
    assert.equal(requests, 2);
    service.stop();
    assert.equal(service._cache.size, 0);
});

test('lyrics honors rate limiting across tracks, without automatic retries', async () => {
    let now = 0, requests = 0, output;
    const service = new Lyrics(state => { output = state; }, {cancel() {}, async get() {
        requests++; throw Object.assign(new Error('rate limited'), {status: 429, retryAfterMs: 120000});
    }}, () => now);
    await service.load(song);
    now = 10000;
    await service.load({...song, title: 'Next'});
    assert.equal(requests, 1);
    assert.equal(output.retry, true);
    assert.match(output.message, /cooling/);
    now = 200000;
    await service.load(song);
    assert.equal(requests, 2);
});

test('cover rounding crops the center, handles padded RGB rows and preserves alpha', () => {
    const pixels = new Uint8Array(24 * 16 * 3).fill(220);
    const {data, side} = roundedCover(pixels, 20, 16, 24 * 3, 3);
    assert.equal(side, 16);
    assert.equal(data.length, 16 * 16 * 4);
    assert.ok(data[3] < 255);
    assert.equal(data[(8 * side + 8) * 4 + 3], 255);
    const transparent = roundedCover(new Uint8Array(16 * 16 * 4), 16, 16, 64, 4);
    assert.equal(transparent.data[3], 0);
});
