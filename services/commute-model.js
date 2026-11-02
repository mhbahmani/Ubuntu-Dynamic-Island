export const PROVIDERS = ['neshan', 'mapbox', 'ors', 'graphhopper', 'fossgis', 'osrm'];
export const PROVIDER_NAMES = {neshan: 'Neshan', mapbox: 'Mapbox', ors: 'openrouteservice', graphhopper: 'GraphHopper', fossgis: 'FOSSGIS / OSRM', osrm: 'OSRM demo'};
export const intervalMs = minutes => Math.max(10, Math.min(120, Number(minutes) || 15)) * 60000;
export function point(value) {
    if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
        !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
        Math.abs(value.latitude) > 85 || Math.abs(value.longitude) > 180) return null;
    return {latitude: value.latitude, longitude: value.longitude};
}
export function routeTitle(route) {
    if (!route) return 'Add your first route';
    return String(route.name ?? '').trim() || `${route.originName?.trim() || (route.originMode === 'current' ? 'Current location' : 'Start')} → ${route.destinationName?.trim() || 'Destination'}`;
}
export function useSavedStart(route) {
    return point(route?.origin) ? {...route, originMode: 'fixed'} : null;
}
export function routesFrom(value) {
    try {
        const items = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(items)) return [];
        const ids = new Set();
        return items.slice(0, 12).flatMap(r => {
            if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !point(r.destination) ||
                (r.originMode !== 'current' && !point(r.origin))) return [];
            ids.add(r.id);
            return [{id: r.id.slice(0, 80), name: String(r.name ?? '').trim().slice(0, 60),
                originMode: r.originMode === 'current' ? 'current' : 'fixed', origin: point(r.origin),
                originName: String(r.originName || 'Start').slice(0, 80), destination: point(r.destination),
                destinationName: String(r.destinationName || 'Destination').slice(0, 80)}];
        });
    } catch { return []; }
}
export function providerOrder(preferred, keys = {}, fallback = true) {
    const usable = id => ['fossgis', 'osrm'].includes(id) || Boolean(keys[id]);
    const first = PROVIDERS.includes(preferred) ? preferred : PROVIDERS.find(usable);
    return [...new Set([first, ...(fallback ? PROVIDERS.filter(usable) : [])])].filter(Boolean);
}
export function requestFor(provider, origin, destination, key = '') {
    if (!point(origin) || !point(destination)) throw new Error('Choose valid endpoints');
    const xy = p => `${p.longitude},${p.latitude}`;
    const yx = p => `${p.latitude},${p.longitude}`;
    if (provider === 'neshan') return {url: `https://api.neshan.org/v4/direction?type=car&origin=${yx(origin)}&destination=${yx(destination)}&alternative=false`, headers: {'Api-Key': key}};
    if (provider === 'mapbox') return {url: `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${xy(origin)};${xy(destination)}?depart_at=now&overview=false&steps=false&alternatives=false&access_token=${encodeURIComponent(key)}`, headers: {}};
    if (provider === 'ors') return {url: `https://api.openrouteservice.org/v2/directions/driving-car?start=${xy(origin)}&end=${xy(destination)}`, headers: {Authorization: key}};
    if (provider === 'graphhopper') return {url: `https://graphhopper.com/api/1/route?point=${yx(origin)}&point=${yx(destination)}&profile=car&instructions=false&calc_points=false&key=${encodeURIComponent(key)}`, headers: {}};
    const base = provider === 'fossgis' ? 'https://routing.openstreetmap.de/routed-car' : 'https://router.project-osrm.org';
    return {url: `${base}/route/v1/driving/${xy(origin)};${xy(destination)}?overview=false&steps=false&alternatives=false`, headers: {}};
}
export function normalizeRoute(provider, body, now = Date.now()) {
    let seconds, meters;
    if (provider === 'graphhopper') { seconds = body.paths?.[0]?.time / 1000; meters = body.paths?.[0]?.distance; }
    else if (provider === 'ors') { const s = body.features?.[0]?.properties?.summary; seconds = s?.duration; meters = s?.distance; }
    else if (provider === 'neshan') {
        const legs = body.routes?.[0]?.legs;
        if (!legs?.length) throw new Error('No driving route found');
        seconds = legs.reduce((sum, leg) => sum + Number(leg.duration?.value), 0);
        meters = legs.reduce((sum, leg) => sum + Number(leg.distance?.value), 0);
    } else { if (body.code !== 'Ok') throw new Error('No driving route found'); seconds = body.routes?.[0]?.duration; meters = body.routes?.[0]?.distance; }
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 7 * 86400 ||
        typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) throw new Error('No valid driving estimate');
    const typical = body.routes?.[0]?.duration_typical;
    const traffic = provider === 'neshan' || (provider === 'mapbox' && Number.isFinite(typical) && typical >= 0);
    return {seconds, meters, provider, traffic, updatedAt: now};
}

// Injection keeps lifecycle, fallback and timing testable without GNOME/network.
export class CommuteController {
    constructor({fetch, cancel, locate, keys, emit, schedule, unschedule, now = Date.now}) {
        Object.assign(this, {fetch, cancel, locate, keys, emit, schedule, unschedule, now});
        this.state = {status: 'unconfigured'}; this.active = false; this.generation = 0; this.timer = 0;
        this.lastAttempt = -Infinity; this.cache = new Map();
    }
    configure(route, preferred = 'auto', minutes = 15, fallback = true) {
        const signature = JSON.stringify([route, preferred, minutes, fallback]);
        if (signature === this.signature) return;
        this.signature = signature; this.invalidate();
        this.route = route; this.preferred = preferred; this.interval = intervalMs(minutes); this.fallback = fallback;
        this.state = {status: route ? 'idle' : 'unconfigured'}; this.emit(this.state);
        if (this.active) this.refresh();
    }
    invalidate() {
        this.generation++; this.cancel(); this.busy = false;
        if (this.timer) this.unschedule(this.timer);
        this.timer = 0;
    }
    setActive(active) {
        if (this.active === active) return;
        this.active = active;
        if (active) this.refresh();
        else { this.invalidate(); if (this.state.status === 'loading') this.state.status = this.state.data ? 'ready' : 'idle'; }
    }
    arm(ms) {
        if (this.timer) this.unschedule(this.timer);
        this.timer = this.schedule(Math.max(1000, ms), () => { this.timer = 0; this.refresh(); });
    }
    async refresh(force = false) {
        if (!this.active || !this.route || this.busy) return;
        const now = this.now();
        const cached = this.cache.get(this.signature);
        if (!force && cached && now - cached.updatedAt < this.interval) {
            this.state = {status: 'ready', data: cached, stale: false}; this.emit(this.state);
            this.arm(this.interval - (now - cached.updatedAt)); return;
        }
        // Throttle route switching/retries as well as explicit refreshes.
        if (now - this.lastAttempt < 5000) { this.arm(5000 - (now - this.lastAttempt)); return; }
        this.lastAttempt = now; this.busy = true;
        const token = ++this.generation;
        this.state = {status: 'loading', data: cached, stale: Boolean(cached)}; this.emit(this.state);
        try {
            let origin = this.route.origin;
            if (this.route.originMode === 'current') {
                try { origin = await this.locate(); }
                catch (error) { if (!error.code) error.code = 'location-unavailable'; throw error; }
            }
            if (token !== this.generation) return;
            const keys = await this.keys();
            if (token !== this.generation) return;
            const failures = [];
            for (const provider of providerOrder(this.preferred, keys, this.fallback)) {
                if (token !== this.generation) return;
                try {
                    if (!['fossgis', 'osrm'].includes(provider) && !keys[provider]) throw new Error('API key missing');
                    const request = requestFor(provider, origin, this.route.destination, keys[provider]);
                    const body = await this.fetch(request.url, request.headers);
                    if (token !== this.generation) return;
                    const data = {...normalizeRoute(provider, body, this.now()), origin, destination: this.route.destination,
                        fallback: failures.length > 0};
                    this.cache.set(this.signature, data);
                    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
                    this.state = {status: 'ready', data, stale: false}; this.emit(this.state); return;
                } catch { failures.push(PROVIDER_NAMES[provider]); }
            }
            throw new Error(`Routing unavailable (${failures.join(', ')}). Check keys, connection or try later.`);
        } catch (error) {
            if (token === this.generation) { this.state = {status: 'error', data: cached, stale: Boolean(cached), error: error.message, errorCode: error.code}; this.emit(this.state); }
        } finally {
            if (token === this.generation) { this.busy = false; if (this.active) this.arm(this.interval); }
        }
    }
    stop() { this.active = false; this.invalidate(); this.cache.clear(); }
}
