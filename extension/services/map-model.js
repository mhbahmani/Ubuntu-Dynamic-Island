// Web Mercator pixel coordinates, independent of GTK and network access.
export const MAX_LATITUDE = 85.05112878;
export function project(point, zoom) {
    const size = 256 * 2 ** zoom;
    const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.latitude)) * Math.PI / 180;
    return {x: (point.longitude + 180) / 360 * size,
        y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size};
}
export function unproject(x, y, zoom) {
    const size = 256 * 2 ** zoom;
    return {longitude: ((x / size * 360) % 360 + 360) % 360 - 180,
        latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(size, y)) / size))) * 180 / Math.PI};
}
export function visibleTiles(center, zoom, width, height) {
    const p = project(center, zoom), n = 2 ** zoom, result = [];
    const left = p.x - width / 2, top = p.y - height / 2;
    for (let y = Math.max(0, Math.floor(top / 256)); y <= Math.min(n - 1, Math.floor((top + height) / 256)); y++)
        for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
            const wrapped = ((x % n) + n) % n;
            result.push({key: `${zoom}/${wrapped}/${y}`, x: x * 256 - left, y: y * 256 - top});
        }
    return result;
}
