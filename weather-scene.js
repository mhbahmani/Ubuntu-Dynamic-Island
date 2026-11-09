import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {weatherSceneKind} from './services/weather-model.js';
import {ArtLoader} from './services/art.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Pre-rendered, licensed animation atlas. One selected texture; no runtime drawing.
// No animation source survives hiding, power saver, reduced motion or destruction.
export class WeatherScene {
    constructor(settings) {
        this.settings = settings;
        this.kind = 'clouds';
        this.phase = 0;
        this.active = false;
        this.dead = false;
        this.timer = 0;
        this.frames = 0;
        this.actor = new St.Widget({style_class: 'ubuntu-island-weather-scene weather-clouds',
            layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        this.sprite = new Clutter.Actor({width: 128, height: 128, clip_to_allocation: true,
            x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        this.theme = St.ThemeContext.get_for_stage(global.stage);
        const sizeArtwork = () => { const size = 128 * this.theme.scale_factor; this.sprite.set_size(size, size); this.sprite.translation_y = 10 * this.theme.scale_factor; };
        this.themeId = this.theme.connect('notify::scale-factor', sizeArtwork);
        sizeArtwork();
        this.image = new Clutter.Actor({reactive: false});
        this.sprite.add_child(this.image);
        this.actor.add_child(this.sprite);
        this.loader = new ArtLoader();
        this.sprite.connect('notify::allocation', () => this.paint());
        this.actor.connect('notify::mapped', () => this.sync());
        this.actor.connect('destroy', () => this.destroy());
        this.opacityId = settings.connect('changed::surface-opacity', () => this.style());
        this.ids = ['weather-motion', 'disable-animations'].map(key => settings.connect(`changed::${key}`, () => this.sync()));
        this.stSettings = St.Settings.get();
        this.motionId = this.stSettings.connect('notify::enable-animations', () => this.sync());
        this.sessionId = Main.sessionMode.connect('updated', () => this.sync());
        this.cancel = new Gio.Cancellable();
        // Missing power-profiles-daemon is allowed. Subscribe once; never poll.
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            null, 'net.hadess.PowerProfiles', '/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles',
            this.cancel, (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    if (this.dead) return;
                    this.power = proxy;
                    this.powerId = proxy.connect('g-properties-changed', () => this.sync());
                    this.sync();
                } catch { /* Optional desktop service. */ }
            });
    }
    setViewport(viewport) {
        this.viewport = viewport;
        viewport.connect('destroy', () => { this.viewport = null; this.adjustment = null; this.scrollId = 0; this.setActive(false); });
        this.adjustment = viewport.get_vscroll_bar().get_adjustment();
        this.scrollId = this.adjustment.connect('notify::value', () => {
            if (this.scrollIdle) return;
            this.scrollIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.scrollIdle = 0;
                this.sync();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    inViewport() {
        if (!this.viewport) return true;
        const y = this.sprite.get_transformed_position()[1];
        const top = this.viewport.get_transformed_position()[1];
        return y + this.sprite.get_transformed_size()[1] > top &&
            y < top + this.viewport.get_transformed_size()[1];
    }
    setActive(active) { if (this.active !== active) { this.active = active; this.sync(); } }
    setCondition(current) {
        const kind = weatherSceneKind(current);
        if (kind !== this.loadedKind) {
            this.kind = kind;
            this.loadedKind = kind;
            this.phase = 0;
            this.ready = false;
            this.image.set_content(null);
            this.actor.set_style_class_name(`ubuntu-island-weather-scene weather-${kind}`);
            this.style();
            const file = Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path(`assets/weather/${kind}.png`);
            this.loader.load(file.get_uri(), 1536, content => {
                if (this.dead) return;
                this.ready = Boolean(content);
                this.image.set_content(content);
                this.paint();
                this.sync();
            }, {cover: false});
            this.sync();
        }
    }
    style() {
        const colors = {sun: ['74,62,53', '39,43,50'], clouds: ['52,78,102', '27,43,59'],
            rain: ['38,61,85', '20,32,46'], snow: ['59,82,106', '37,53,69'], night: ['37,44,77', '19,26,43'],
            'clouds-night': ['32,42,67', '17,24,40'], 'rain-night': ['27,37,58', '13,21,35'],
            'snow-night': ['39,49,74', '22,31,49']}[this.kind];
        const alpha = this.settings.get_int('surface-opacity') / 100;
        this.actor.set_style(`background-gradient-start: rgba(${colors[0]},${alpha}); background-gradient-end: rgba(${colors[1]},${alpha});`);
        this.sprite.opacity = Math.round(220 * alpha);
    }
    isPowerSaving() { return this.power?.get_cached_property('ActiveProfile')?.deep_unpack() === 'power-saver'; }
    sync() {
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = 0;
        if (this.dead || !this.actor.mapped) return;
        this.paint();
        const mode = this.settings.get_string('weather-motion');
        const saver = this.isPowerSaving();
        if (!this.ready || !this.active || !this.inViewport() || mode === 'off' || saver || Main.sessionMode.isLocked ||
            !this.stSettings.enable_animations || this.settings.get_boolean('disable-animations')) return;
        const started = GLib.get_monotonic_time();
        const initial = this.phase;
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 84, () => {
            if (!this.actor.mapped || !this.active || !this.inViewport()) { this.timer = 0; return GLib.SOURCE_REMOVE; }
            const elapsed = (GLib.get_monotonic_time() - started) / 1e6;
            this.phase = initial + elapsed;
            this.paint();
            if (mode === 'subtle' && elapsed >= 4) { this.timer = 0; return GLib.SOURCE_REMOVE; }
            return GLib.SOURCE_CONTINUE;
        });
    }
    paint() {
        if (this.dead || !this.ready || !this.actor.mapped) return;
        const size = this.sprite.width;
        if (size <= 0) return;
        // Atlas durations match the authored SVG loops, sampled at 48 frames.
        const duration = {sun: 5.625, clouds: 5.625, rain: 0.7, snow: 4, night: 10, 'clouds-night': 10, 'rain-night': 0.7, 'snow-night': 4}[this.kind] ?? 4;
        const frame = Math.floor((this.phase % duration) / duration * 48);
        if (this.image.width !== size * 8 || this.image.height !== size * 6)
            this.image.set_size(size * 8, size * 6);
        this.image.set_translation(-(frame % 8) * size, -Math.floor(frame / 8) * size, 0);
        this.frames++;
    }
    destroy() {
        if (this.dead) return;
        this.dead = true;
        if (this.timer) GLib.Source.remove(this.timer);
        this.timer = 0;
        this.cancel.cancel();
        this.loader.destroy();
        this.theme.disconnect(this.themeId);
        this.image.set_content(null);
        if (this.scrollIdle) GLib.Source.remove(this.scrollIdle);
        this.scrollIdle = 0;
        if (this.scrollId) this.adjustment.disconnect(this.scrollId);
        for (const id of this.ids) this.settings.disconnect(id);
        this.settings.disconnect(this.opacityId);
        this.stSettings.disconnect(this.motionId);
        Main.sessionMode.disconnect(this.sessionId);
        if (this.powerId) this.power.disconnect(this.powerId);
    }
}
