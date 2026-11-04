import {requestFor, normalizeRoute} from './commute-model.js';

// A single explicit test request, using public Tehran landmarks, not saved routes.
export async function validateRoutingKey(provider, key, fetch) {
    if (!['neshan', 'mapbox', 'ors', 'graphhopper'].includes(provider) || !key.trim())
        throw new Error('Enter an API key.');
    const origin = {latitude: 35.6997, longitude: 51.3380};
    const destination = {latitude: 35.7448, longitude: 51.3753};
    try {
        const request = requestFor(provider, origin, destination, key.trim());
        normalizeRoute(provider, await fetch(request.url, request.headers));
    } catch (error) {
        // Never surface raw provider/network errors: they may contain credentials.
        if (error.status === 401) throw new Error('Key rejected. Check the key and try again.');
        if (error.status === 403) throw new Error('Access denied. Check key permissions, account and region.');
        if (error.status === 429) throw new Error('Quota or rate limit reached. Try again later.');
        throw new Error('Could not verify routing access. Check your connection and account, then retry.');
    }
}
