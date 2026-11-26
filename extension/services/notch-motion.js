// Collapsed notch item motion. Entering items fade in while their neighbours
// make room; leaving items fade out before the gap closes. ui/pill.js drives
// these from one frame-clock timeline per glide; ui/notch-layout.js places items.

export const SHRUNK_SCALE = 0.85;

export const glideCurve = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const unit = t => Math.max(0, Math.min(1, t));

// An item's presence, opacity (0–1) and scale at fraction `t` of a glide that
// started from `from`. Presence follows the surface's curve; the fade starts
// late when entering and finishes early when leaving.
export function itemFrame(from, to, t) {
    t = unit(t);
    const entering = to === 1;
    const fade = entering
        ? (from.opacity >= 1 ? 1 : glideCurve(unit((t - 0.3) / 0.7)))
        : glideCurve(unit(t / 0.45));
    return {
        presence: from.presence + (to - from.presence) * glideCurve(t),
        opacity: from.opacity + ((entering ? 1 : 0) - from.opacity) * fade,
        scale: from.scale + ((entering ? 1 : SHRUNK_SCALE) - from.scale) * fade,
    };
}

const gap = (items, i, spacing) => i > 0 ? spacing * Math.min(items[i].presence, items[i - 1].presence) : 0;

// Row width of `items` ({width, presence}): presence scales each item's share
// and the spacing beside it.
export function notchExtent(items, spacing) {
    return items.reduce((sum, item, i) => sum + item.presence * item.width + gap(items, i, spacing), 0);
}

// Left edges of `items` in a row `available` wide. Items keep their natural
// widths so labels never reflow; spare width is shared by presence, and an
// overflowing row stays centred for the surface to clip.
export function notchSlots(items, available, spacing, rtl = false) {
    const spare = available - notchExtent(items, spacing);
    const weight = items.reduce((sum, item) => sum + item.presence, 0);
    let cursor = spare > 0 ? 0 : spare / 2;
    return items.map((item, i) => {
        cursor += gap(items, i, spacing);
        const slot = item.presence * item.width + (spare > 0 && weight > 0 ? spare * item.presence / weight : 0);
        const x = cursor + (slot - item.width) / 2;
        cursor += slot;
        return rtl ? available - x - item.width : x;
    });
}
