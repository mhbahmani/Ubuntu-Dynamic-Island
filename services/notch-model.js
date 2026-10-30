export const NOTCH_ITEMS = ['media', 'weather', 'network', 'cpu', 'bluetooth'];

// Tolerate stale/hand-edited settings while keeping every item exactly once.
export function notchOrder(value) {
    return [...new Set([...value.filter(id => NOTCH_ITEMS.includes(id)), ...NOTCH_ITEMS])];
}
