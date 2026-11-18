import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

export const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

export async function waitFor(condition, message, timeoutMs = 5000) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    while (!condition()) {
        if (GLib.get_monotonic_time() >= deadline) throw new Error(message);
        await delay(20);
    }
}

export async function moveToControl(pointer, actor, fraction = 0.5) {
    await waitFor(() => {
        const [left, top] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        const x = left + width * fraction, y = top + height / 2;
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        const [px, py] = global.get_pointer();
        return Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1 && (!actor.track_hover || actor.hover) &&
            (picked === actor || (picked && actor.contains(picked)));
    }, `Pointer did not reach ${actor.accessible_name || actor}`);
}
