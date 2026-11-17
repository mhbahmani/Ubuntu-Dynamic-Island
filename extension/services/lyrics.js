import {WeatherHttp} from './weather-http.js';
import {lyricsKey, lyricsUrl, parseLyrics} from './lyrics-model.js';

// On-demand, bounded, session-only cache. No background polling or disk history.
export class LyricsService {
    constructor(onChange, http = null, now = () => Date.now()) {
        this._http = http ?? new WeatherHttp('ubuntu-island-lyrics/1 (https://github.com/mhbahmani/ubuntu-dynamic-island)');
        this._onChange = onChange;
        this._now = now;
        this._cache = new Map();
        this._generation = 0;
        this._nextRequest = 0;
    }

    cancel() { this._generation++; this._http.cancel(); this._key = null; }
    stop() { this.cancel(); this._cache.clear(); }

    async load(track) {
        const key = lyricsKey(track);
        if (key === this._key) return;
        this.cancel();
        this._key = key;
        const generation = this._generation;
        const url = lyricsUrl(track);
        if (!url) { this._onChange({message: 'This player needs to provide a title and artist to find lyrics.', lines: []}); return; }
        if (this._cache.has(key)) { this._onChange(this._cache.get(key)); return; }
        if (this._now() < this._nextRequest) {
            this._onChange({message: 'Lyrics lookup is cooling down. Please try again shortly.', lines: [], retry: true});
            return;
        }
        this._nextRequest = this._now() + 500;
        this._onChange({message: 'Finding lyrics on LRCLIB…', lines: []});
        try {
            const record = await this._http.get(url, {Accept: 'application/json'});
            if (generation !== this._generation) return;
            const state = parseLyrics(record);
            this._cache.set(key, state);
            if (this._cache.size > 20) this._cache.delete(this._cache.keys().next().value);
            this._onChange(state);
        } catch (error) {
            if (generation !== this._generation) return;
            if (error.status === 429 || error.status === 503)
                this._nextRequest = this._now() + Math.max(60000, error.retryAfterMs || 0) * (1 + Math.random() * 0.3);
            const state = {message: error.status === 404 ? 'Lyrics not found for this track.' : 'Lyrics are unavailable. Try again later.',
                lines: [], retry: error.status !== 404};
            if (error.status === 404) {
                this._cache.set(key, state);
                if (this._cache.size > 20) this._cache.delete(this._cache.keys().next().value);
            }
            this._onChange(state);
        }
    }
}
