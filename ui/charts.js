import St from 'gi://St';
import {History} from '../services/history.js';

// One native drawing actor per chart. Samples use the existing metrics clock;
// only mapped charts request repaints. No animation or extra sampling timer.
export class HistoryChart {
    constructor(network = false) {
        this.network = network;
        this.series = network ? [new History(), new History()] : [new History()];
        this.actor = new St.DrawingArea({style_class: network
            ? 'ubuntu-island-history ubuntu-island-history-network' : 'ubuntu-island-history',
        x_expand: true});
        this.actor.connect('repaint', () => this._paint());
        this.actor.connect('notify::mapped', () => this._redraw());
    }

    push(...values) {
        this.series.forEach((history, index) => history.push(values[index]));
        this._redraw();
    }

    clear() {
        this.series.forEach(history => history.clear());
    }

    _redraw() {
        if (this.actor.mapped) this.actor.queue_repaint();
    }

    _paint() {
        const [width, height] = this.actor.get_surface_size();
        const cr = this.actor.get_context();
        try {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const pad = scale;
            const baseline = this.network ? height / 2 : height - pad;
            const range = this.network ? Math.max(1024, ...this.series.map(s => s.peak())) : 100;
            cr.setSourceRGBA(0.8, 0.85, 0.9, 0.16);
            cr.setLineWidth(scale);
            cr.moveTo(0, baseline);
            cr.lineTo(width, baseline);
            cr.stroke();
            const foreground = this.actor.get_theme_node().get_foreground_color();
            const colors = this.network ? [[0.42, 0.8, 0.92], [0.85, 0.66, 0.98]]
                : [[foreground.red / 255, foreground.green / 255, foreground.blue / 255]];
            this.series.forEach((history, seriesIndex) => {
                const amplitude = this.network ? height / 2 - pad : height - 2 * pad;
                const direction = seriesIndex === 1 ? 1 : -1;
                const points = [];
                const flush = () => {
                    if (!points.length) return;
                    cr.moveTo(points[0][0], baseline);
                    for (const [x, y] of points) cr.lineTo(x, y);
                    cr.lineTo(points[points.length - 1][0], baseline);
                    cr.closePath();
                    cr.setSourceRGBA(...colors[seriesIndex], 0.16);
                    cr.fill();
                    cr.moveTo(...points[0]);
                    for (const point of points.slice(1)) cr.lineTo(...point);
                    cr.setSourceRGBA(...colors[seriesIndex], 0.95);
                    cr.setLineWidth(1.5 * scale);
                    if (points.length === 1) {
                        // A fresh history has one point, which Cairo cannot
                        // stroke as a line. Make the first valid sample visible.
                        cr.newPath();
                        cr.arc(points[0][0], points[0][1], 1.5 * scale, 0, 2 * Math.PI);
                        cr.fill();
                    } else cr.stroke();
                    points.length = 0;
                };
                for (let i = 0; i < history.count; i++) {
                    const value = history.at(i);
                    if (!Number.isFinite(value)) { flush(); continue; }
                    const x = pad + (history.capacity - history.count + i) / (history.capacity - 1) * (width - 2 * pad);
                    points.push([x, baseline + direction * Math.min(1, value / range) * amplitude]);
                }
                flush();
            });
        } finally {
            cr.$dispose();
        }
    }
}
