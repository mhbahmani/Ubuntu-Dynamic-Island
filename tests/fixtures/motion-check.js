// Frame-by-frame checks in the isolated native preview; never installed.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const box = actor => {
    const [x, y] = actor.get_transformed_position(), [width, height] = actor.get_transformed_size();
    return {x, y, width, height, cx: x + width / 2, cy: y + height / 2};
};
async function settled(surface, state) {
    for (let i = 0; i < 200 && surface.state !== state; i++) await delay(20);
    assert(surface.state === state, `Motion did not settle ${state}`);
    await delay(40);
}

export async function checkMotion(app) {
    const surface = app._island, pill = app._pill.actor, card = app._card.actor;
    const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const tolerance = 1.5 * scale;
    const indicators = ['weather', 'commute', 'agents', 'date'];
    const saved = {duration: app._settings.get_int('animation-duration'),
        disabled: app._settings.get_boolean('disable-animations'),
        width: app._settings.get_int('expanded-width'),
        animations: desktop.get_boolean('enable-animations'),
        indicators: indicators.map(id => app._settings.get_boolean(`pill-show-${id}`))};
    const frames = [];
    let paintId = 0, capture = null;
    app._system?.stop(); // Keep fixture text stable while measuring its motion.
    try {
        desktop.set_boolean('enable-animations', true);
        app._settings.set_boolean('disable-animations', false);
        // Slow enough to inspect intermediate frames even in a nested compositor.
        app._settings.set_int('animation-duration', 500);
        // The nested compositor stalls on its first transition after startup
        // (no frames for >100 ms); warm it up before measuring.
        surface.expand(); await settled(surface, 'expanded');
        surface.collapse(); await settled(surface, 'collapsed');
        for (const density of ['compact', 'full']) {
            surface._snapCollapsed();
            indicators.forEach((id, i) => app._settings.set_boolean(`pill-show-${id}`,
                density === 'full' && saved.indicators[i]));
            for (const width of [380, 440]) {
                app._settings.set_int('expanded-width', width);
                for (const mode of ['card', 'quick-ask']) {
                    surface.collapse(); await settled(surface, 'collapsed');
                    app._card.selectPage('media');
                    if (mode === 'quick-ask') app._card.showQuickAsk();
                    await delay(80);
                    const groups = app._pill._content.get_children().filter(actor => actor.visible);
                    const start = {surface: box(surface.actor), pill: box(pill),
                        left: box(groups[0]), right: box(groups.at(-1))};
                    const samples = [];
                    const startTime = GLib.get_monotonic_time();
                    let captured = false;
                    // Observe actual painted frames, not wall-clock polling: the
                    // headless compositor's presentation clock can advance faster.
                    paintId = global.stage.connect('after-paint', () => {
                        samples.push({elapsed: (GLib.get_monotonic_time() - startTime) / 1000,
                            surface: box(surface.actor), pill: box(pill), card: box(card),
                            left: box(groups[0]), right: box(groups.at(-1)), opacity: pill.opacity, cardOpacity: card.opacity,
                            pillWidth: pill.width, cardWidth: card.width, cardHeight: card.height});
                        if (!captured && density === 'compact' && width === 440 && pill.opacity < 200 && pill.opacity > 30) {
                            captured = true;
                            capture = app._capture(`motion-${mode}-opening`);
                        }
                    });
                    surface.expand();
                    assert(surface.actor.translation_y === 0, 'Opening teleported vertically before the first frame');
                    await settled(surface, 'expanded');
                    global.stage.disconnect(paintId); paintId = 0;
                    await capture; capture = null;
                    assert(samples.length >= 3, 'Too few painted frames to verify expansion');
                    const visible = samples.filter(frame => frame.opacity > 10 && frame.opacity < 245);
                    assert(visible.length >= 2, 'Outgoing content disappeared without a visible transition');
                    for (const frame of samples) {
                        assert(Math.abs(frame.surface.cx - start.surface.cx) <= tolerance, 'Surface drifted sideways');
                        assert(Math.abs(frame.pill.cx - frame.surface.cx) <= tolerance, 'Notch content lost its center');
                        assert(Math.abs(frame.card.cx - frame.surface.cx) <= tolerance, 'Card content lost its center');
                        assert(Math.abs(frame.pillWidth - start.pill.width) <= tolerance, 'Notch content reflowed while opening');
                        assert(Math.abs(frame.cardWidth - card.width) <= tolerance, 'Card width changed while opening');
                        assert(Math.abs(frame.cardHeight - card.height) <= tolerance, 'Card height changed while opening');
                    }
                    for (const frame of visible) {
                        assert(frame.left.cx >= start.left.cx - tolerance, 'Left content moved outward');
                        assert(frame.right.cx <= start.right.cx + tolerance, 'Right content moved outward');
                        assert(frame.pill.cy >= start.pill.cy - tolerance, 'Outgoing content moved upward');
                        assert(Math.min(frame.opacity, frame.cardOpacity) < 128, 'Notch and card cross-faded mid-surface');
                    }
                    const last = visible.at(-1);
                    assert(last.left.cx > start.left.cx + scale && last.right.cx < start.right.cx - scale,
                        'Both ends did not converge toward the center');
                    assert(card.scale_x === 1 && card.scale_y === 1 && card.translation_y === 0,
                        'Expanded content retained a transform');
                    if (mode === 'quick-ask')
                        assert(app._card._quickAsk.prompt.contains(global.stage.get_key_focus()),
                            'Quick Ask did not receive focus');
                    frames.push({density, width, mode, start, samples});
                    await app._capture(`motion-${density}-${width}-${mode}`);
                    const open = box(surface.actor), closing = [];
                    let closeCaptured = false;
                    paintId = global.stage.connect('after-paint', () => {
                        closing.push({surface: box(surface.actor), pill: box(pill),
                            pillOpacity: pill.opacity, cardOpacity: card.visible ? card.opacity : 0,
                            pillWidth: pill.width, cardWidth: card.width, cardHeight: card.height});
                        if (!closeCaptured && density === 'compact' && width === 440 && pill.opacity > 30 && pill.opacity < 200) {
                            closeCaptured = true;
                            capture = app._capture(`motion-${mode}-closing`);
                        }
                    });
                    surface.collapse();
                    await settled(surface, 'collapsed');
                    global.stage.disconnect(paintId); paintId = 0;
                    await capture; capture = null;
                    assert(pill.scale_x === 1 && pill.scale_y === 1 && pill.opacity === 255 && !card.visible,
                        'Closing left faded or scaled content');
                    const end = box(surface.actor);
                    const between = closing.filter(frame => frame.surface.height < open.height - tolerance &&
                        frame.surface.height > end.height + tolerance);
                    assert(between.length >= 2, 'Closing snapped without intermediate frames');
                    const pillWidth = closing[0]?.pillWidth;
                    for (const frame of between) {
                        assert(Math.abs(frame.surface.cx - start.surface.cx) <= tolerance, 'Surface drifted sideways while closing');
                        assert(Math.abs(frame.pill.cx - frame.surface.cx) <= tolerance, 'Notch content lost its center while closing');
                        assert(Math.abs(frame.pillWidth - pillWidth) <= tolerance, 'Notch content reflowed while closing');
                        assert(Math.abs(frame.cardWidth - card.width) <= tolerance, 'Card width changed while closing');
                        assert(Math.min(frame.pillOpacity, frame.cardOpacity) < 128, 'Card and notch cross-faded mid-surface');
                    }
                    assert(between.some(frame => frame.pillOpacity > 10 && frame.pillOpacity < 245),
                        'Incoming notch appeared without a visible transition');
                    frames.at(-1).closing = closing;
                }
            }
        }
        // Reverse while genuinely in flight, including a close interrupted by a
        // new opening. A stale completion must never hide the reopened layer.
        surface.expand(); await delay(15); surface.collapse(); await delay(15); surface.expand();
        await settled(surface, 'expanded');
        assert(card.visible && card.opacity === 255, 'Interrupted opening hid the card');
        surface.collapse(); await delay(15); surface.expand(); await delay(15); surface.collapse();
        await settled(surface, 'collapsed');
        surface.expand(); await delay(15); surface._snapCollapsed(); await delay(100);
        assert(surface.state === 'collapsed' && !card.visible && pill.opacity === 255,
            'Hidden/snap cleanup left a live transition');
        assert(surface.actor.translation_y === 0 && pill.scale_x === 1 && card.scale_x === 1,
            'Hidden/snap cleanup retained motion transforms');
        // Tab changes: the incoming page fades in and settles from the side of
        // the selected tab while the surface and outgoing page stay still.
        surface.expand(); await settled(surface, 'expanded');
        app._card.selectPage('media', false); await delay(80);
        const pageBox = id => app._card._pages.get(id).box;
        for (const [from, to, side] of [['media', 'system', 1], ['system', 'media', -1]]) {
            const before = box(surface.actor), tabFrames = [];
            paintId = global.stage.connect('after-paint', () => tabFrames.push({surface: box(surface.actor),
                opacity: pageBox(to).opacity, shift: pageBox(to).translation_x,
                outgoing: pageBox(from).visible, outgoingOpacity: pageBox(from).opacity}));
            app._card.selectPage(to);
            assert(Math.sign(pageBox(to).translation_x) === side, `${to} did not enter from the ${side > 0 ? 'right' : 'left'}`);
            await delay(app._card._sliderMs() + 120);
            global.stage.disconnect(paintId); paintId = 0;
            assert(tabFrames.filter(frame => frame.opacity > 10 && frame.opacity < 245).length >= 2,
                `${to} page appeared without a visible transition`);
            for (const [i, frame] of tabFrames.entries()) {
                assert(!frame.outgoing && frame.outgoingOpacity === 255, `${from} page lingered or kept a faded pose`);
                assert(Math.abs(frame.surface.width - before.width) <= tolerance &&
                    Math.abs(frame.surface.height - before.height) <= tolerance, 'Surface resized while switching tabs');
                assert(i === 0 || Math.abs(frame.shift) <= Math.abs(tabFrames[i - 1].shift) + 0.01, `${to} page moved back outward`);
            }
            assert(pageBox(to).opacity === 255 && pageBox(to).translation_x === 0, `${to} page did not settle`);
        }
        app._card.selectPage('system'); app._card.selectPage('audio');
        assert(!pageBox('system').visible && pageBox('system').opacity === 255 && pageBox('system').translation_x === 0,
            'Interrupted tab change left the skipped page mid-transition');
        await delay(app._card._sliderMs() + 120);
        surface.collapse(); await settled(surface, 'collapsed');
        for (const reduced of ['extension', 'desktop']) {
            app._settings.set_boolean('disable-animations', reduced === 'extension');
            desktop.set_boolean('enable-animations', reduced !== 'desktop');
            app._card.showQuickAsk(); surface.expand();
            assert(surface.state === 'expanded' && card.opacity === 255 && card.scale_x === 1,
                `${reduced} reduced motion still animates opening`);
            app._card.selectPage('media'); app._card.selectPage('system');
            assert(!pageBox('system').get_transition('opacity') && pageBox('system').opacity === 255 &&
                pageBox('system').translation_x === 0, `${reduced} reduced motion still animates tab changes`);
            surface.collapse();
            assert(surface.state === 'collapsed' && pill.scale_x === 1 && surface.actor.translation_y === 0,
                `${reduced} reduced motion still animates closing`);
        }
        const file = Gio.File.new_for_path(`${GLib.getenv('ISLAND_PREVIEW_OUTPUT')}/motion.json`);
        file.replace_contents(JSON.stringify(frames), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        console.log(`[Island Preview] MOTION PASS: centered inward motion, animated close, tab transitions, fixed content sizes, compact/full notch, 380/440px, ${scale * 100}% scale, Quick Ask focus, reversal and reduced motion`);
    } finally {
        if (paintId) global.stage.disconnect(paintId);
        surface._snapCollapsed();
        app._settings.set_int('animation-duration', saved.duration);
        app._settings.set_int('expanded-width', saved.width);
        app._settings.set_boolean('disable-animations', saved.disabled);
        desktop.set_boolean('enable-animations', saved.animations);
        indicators.forEach((id, i) => app._settings.set_boolean(`pill-show-${id}`, saved.indicators[i]));
        app._system?.start();
    }
}
