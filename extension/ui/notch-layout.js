import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import {notchExtent, notchSlots} from '../services/notch-motion.js';

// A row of collapsed notch items at their natural widths. `presence` (0–1,
// set by ui/pill.js while an item enters or leaves) scales its share of the
// row, so neighbours glide with the surface instead of jumping.
export const NotchLayout = GObject.registerClass(
class NotchLayout extends Clutter.LayoutManager {
    _init() {
        super._init();
        this.spacing = 0;
        this.presence = new Map();
    }

    _items(container) {
        return container.get_children().filter(child => child.visible).map(child => ({child,
            width: child.get_preferred_width(-1)[1], presence: this.presence.get(child) ?? 1}));
    }

    vfunc_get_preferred_width(container, _forHeight) {
        const width = notchExtent(this._items(container), this.spacing);
        return [width, width];
    }

    vfunc_get_preferred_height(container, _forWidth) {
        let minimum = 0, natural = 0;
        for (const child of container.get_children()) {
            if (!child.visible) continue;
            const [min, nat] = child.get_preferred_height(-1);
            minimum = Math.max(minimum, min);
            natural = Math.max(natural, nat);
        }
        return [minimum, natural];
    }

    vfunc_allocate(container, box) {
        const items = this._items(container);
        const rtl = container.get_text_direction() === Clutter.TextDirection.RTL;
        const childBox = new Clutter.ActorBox();
        notchSlots(items, box.get_width(), this.spacing, rtl).forEach((x, i) => {
            childBox.x1 = Math.round(box.x1 + x);
            childBox.x2 = childBox.x1 + items[i].width;
            childBox.y1 = box.y1;
            childBox.y2 = box.y2;
            items[i].child.allocate(childBox);
        });
    }
});
