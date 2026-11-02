import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import {project, unproject, visibleTiles} from './services/map-model.js';
import {MapTiles} from './services/map-tiles.js';

// A native, event-driven map: no embedded browser, subprocess or frame timer.
export class RouteMap {
    constructor(onPoint, onError, {offline = false} = {}) {
        Object.assign(this, {onPoint, onError, offline});
        this.center = {latitude: 35.6892, longitude: 51.389}; this.zoom = 12;
        this.points = {}; this.selected = 'origin'; this.images = new Map(); this.pending = new Set();
        this.failed = new Set(); this.visible = []; this.dead = false;
        if (!offline) this.tiles = new MapTiles();
        this.actor = new Gtk.Overlay({vexpand: true});
        this.canvas = new Gtk.DrawingArea({vexpand: true, hexpand: true, focusable: true,
            tooltip_text: 'Click to place the selected pin. Drag a pin or pan the map. Use arrow keys to pan, +/− to zoom, Enter to place a pin at the center.'});
        this.actor.set_child(this.canvas);
        this.canvas.set_draw_func((_area, cr, width, height) => this.draw(cr, width, height));
        this.canvas.connect('resize', () => this.changed());
        const controls = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4,
            halign: Gtk.Align.START, valign: Gtk.Align.START, margin_start: 10, margin_top: 10});
        for (const [label, amount] of [['+', 1], ['−', -1]]) {
            const button = new Gtk.Button({label, tooltip_text: amount > 0 ? 'Zoom in' : 'Zoom out'});
            button.connect('clicked', () => this.setZoom(this.zoom + amount)); controls.append(button);
        }
        this.actor.add_overlay(controls);
        const credit = new Gtk.LinkButton({label: '© OpenStreetMap contributors', uri: 'https://www.openstreetmap.org/copyright',
            halign: Gtk.Align.END, valign: Gtk.Align.END});
        credit.add_css_class('card'); this.actor.add_overlay(credit);
        const drag = new Gtk.GestureDrag(); this.drag = drag;
        drag.connect('drag-begin', (_g, x, y) => this.beginDrag(x, y));
        drag.connect('drag-update', (_g, dx, dy) => this.moveDrag(dx, dy));
        drag.connect('drag-end', (_g, dx, dy) => this.endDrag(dx, dy));
        this.canvas.add_controller(drag);
        const key = new Gtk.EventControllerKey();
        key.connect('key-pressed', (_k, value) => {
            const pan = {[Gdk.KEY_Left]: [-80, 0], [Gdk.KEY_Right]: [80, 0], [Gdk.KEY_Up]: [0, -80], [Gdk.KEY_Down]: [0, 80]}[value];
            if (pan) { const p = project(this.center, this.zoom); this.center = unproject(p.x + pan[0], p.y + pan[1], this.zoom); this.changed(); }
            else if ([Gdk.KEY_plus, Gdk.KEY_equal, Gdk.KEY_KP_Add].includes(value)) this.setZoom(this.zoom + 1);
            else if ([Gdk.KEY_minus, Gdk.KEY_KP_Subtract].includes(value)) this.setZoom(this.zoom - 1);
            else if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(value)) this.place(this.selected, this.center);
            else return false;
            return true;
        }); this.canvas.add_controller(key);
        const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
        scroll.connect('scroll', (_c, _dx, dy) => { this.setZoom(this.zoom + (dy < 0 ? 1 : -1)); return true; });
        this.canvas.add_controller(scroll);
    }
    screen(point) {
        const c = project(this.center, this.zoom), p = project(point, this.zoom), size = 256 * 2 ** this.zoom;
        let dx = p.x - c.x; dx -= Math.round(dx / size) * size;
        return {x: dx + this.canvas.get_width() / 2, y: p.y - c.y + this.canvas.get_height() / 2};
    }
    pointAt(x, y) {
        const c = project(this.center, this.zoom);
        return unproject(c.x + x - this.canvas.get_width() / 2, c.y + y - this.canvas.get_height() / 2, this.zoom);
    }
    beginDrag(x, y) {
        this.canvas.grab_focus();
        const pin = Object.keys(this.points).find(id => { const p = this.screen(this.points[id]); return Math.hypot(p.x - x, p.y - y) < 20; });
        this.gesture = {x, y, pin, center: project(this.center, this.zoom)};
    }
    moveDrag(dx, dy) {
        const g = this.gesture; if (!g) return;
        if (g.pin) this.points[g.pin] = this.pointAt(g.x + dx, g.y + dy);
        else this.center = unproject(g.center.x - dx, g.center.y - dy, this.zoom);
        this.changed();
    }
    endDrag(dx, dy) {
        const g = this.gesture; if (!g) return;
        if (Math.hypot(dx, dy) < 4) this.place(this.selected, this.pointAt(g.x, g.y));
        else { this.moveDrag(dx, dy); if (g.pin) this.onPoint(g.pin, this.points[g.pin]); }
        this.gesture = null; this.changed();
    }
    place(id, point) { this.points[id] = {...point}; this.onPoint(id, point); this.changed(); }
    select(id) { this.selected = id; }
    set(id, point) { this.points[id] = {...point}; this.center = {...point}; this.zoom = Math.max(this.zoom, 14); this.changed(); }
    load(points) {
        this.points = Object.fromEntries(Object.entries(points).filter(([_id, p]) => p));
        const values = Object.values(this.points);
        if (values.length) this.center = {...values[0]};
        if (values.length === 2) {
            // Fit both pins, including routes crossing the antimeridian.
            const a = project(values[0], 0), b = project(values[1], 0);
            let dx = b.x - a.x; dx -= Math.round(dx / 256) * 256;
            this.center = unproject(a.x + dx / 2, (a.y + b.y) / 2, 0);
            this.zoom = Math.max(2, Math.min(15, Math.floor(Math.log2(220 / Math.max(Math.abs(dx), Math.abs(a.y - b.y), .001)))));
        }
        this.changed();
    }
    setZoom(zoom) { this.zoom = Math.max(2, Math.min(19, zoom)); this.changed(); }
    changed() {
        if (this.dead) return;
        this.canvas.queue_draw();
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this.timer = 0; this.updateTiles(); return GLib.SOURCE_REMOVE;
        });
    }
    updateTiles() {
        if (this.dead || this.offline || !this.canvas.get_mapped()) return;
        this.visible = visibleTiles(this.center, this.zoom, this.canvas.get_width(), this.canvas.get_height());
        this.pump();
    }
    pump() {
        if (this.dead) return;
        for (const tile of this.visible) {
            if (this.pending.size >= 4) break;
            if (this.pending.has(tile.key) || this.images.has(tile.key) || this.failed.has(tile.key)) continue;
            this.pending.add(tile.key);
            this.tiles.get(tile.key).then(image => {
                if (this.dead) return;
                this.images.set(tile.key, image);
                if (this.images.size > 96) this.images.delete(this.images.keys().next().value);
                this.canvas.queue_draw();
            }).catch(() => {
                if (!this.dead) { this.failed.add(tile.key); this.onError('Some map tiles could not load. You can still search or enter coordinates.'); }
            }).finally(() => { this.pending.delete(tile.key); this.pump(); });
        }
    }
    draw(cr, width, height) {
        cr.setSourceRGB(.86, .9, .92); cr.paint();
        for (const tile of visibleTiles(this.center, this.zoom, width, height)) {
            const image = this.images.get(tile.key);
            if (image) { Gdk.cairo_set_source_pixbuf(cr, image, Math.round(tile.x), Math.round(tile.y)); cr.paint(); }
        }
        const a = this.points.origin && this.screen(this.points.origin), b = this.points.destination && this.screen(this.points.destination);
        if (a && b) { cr.setSourceRGB(.2, .36, .5); cr.setLineWidth(2); cr.setDash([5, 7], 0); cr.moveTo(a.x, a.y); cr.lineTo(b.x, b.y); cr.stroke(); cr.setDash([], 0); }
        for (const [id, point] of Object.entries(this.points)) {
            const p = this.screen(point);
            cr.arc(p.x, p.y, 15, 0, Math.PI * 2); cr.setSourceRGB(...(id === 'origin' ? [.05, .47, .76] : [.88, .29, .2])); cr.fillPreserve();
            cr.setSourceRGB(1, 1, 1); cr.setLineWidth(3); cr.stroke();
            cr.setFontSize(15); cr.moveTo(p.x - 5, p.y + 5); cr.showText(id === 'origin' ? 'A' : 'B');
        }
        if (this.canvas.has_focus) { cr.setSourceRGBA(.1, .4, .8, .7); cr.setLineWidth(2); cr.rectangle(1, 1, width - 2, height - 2); cr.stroke(); }
    }
    stop() {
        this.dead = true; if (this.timer) GLib.Source.remove(this.timer); this.timer = 0;
        this.tiles?.stop(); this.images.clear(); this.pending.clear(); this.failed.clear();
        this.canvas.set_draw_func(null);
    }
}
