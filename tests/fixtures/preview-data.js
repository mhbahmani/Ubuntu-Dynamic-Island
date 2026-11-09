import {AgentStore} from './services/agents-model.js';
import {roundedCover} from './services/artwork-model.js';
// Development fixtures only. Controls update these snapshots, never real devices.
import St from 'gi://St';
import Cogl from 'gi://Cogl';

export function sampleDevices(preview, sampleMetrics) {
    for (const service of [preview._media, preview._audio, preview._bluetooth]) service.stop();
    const media = {available: true, title: 'Quiet hours (sample)', artist: 'Evening sessions',
        playerName: 'Preview player', status: 'Playing', positionSec: 72, lengthSec: 240,
        canControl: true, canNext: true, canPrevious: true, canSeek: true, canRaise: true, shuffle: false, loopStatus: 'None',
        playerId: 'sample', trackId: '/sample/1', hasTrackList: true,
        players: [{id: 'sample', name: 'Preview player', status: 'Playing'}, {id: 'sample2', name: 'Podcast player', status: 'Paused'}]};
    const pixels = new Uint8Array(160 * 160 * 4);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
        const sun = Math.hypot(x - 104, y - 49) < 25;
        const ridge = y > 100 + Math.sin(x / 24) * 18;
        pixels.set(sun ? [192, 68, 43, 255] : ridge ? [51, 47, 42, 255]
            : [224 - Math.round(y / 8), 211 - Math.round(y / 6), 190 - Math.round(y / 5), 255], (y * 160 + x) * 4);
    }
    const cover = St.ImageContent.new_with_preferred_size(160, 160);
    cover.set_data(roundedCover(pixels, 160, 160, 160 * 4, 4).data, Cogl.PixelFormat.RGBA_8888, 160, 160, 160 * 4);
    cover._islandAccent = [178, 105, 66];
    const emitMedia = () => { preview._renderMedia({...media}); preview._card.renderArt(cover); };
    preview._media = {
        positionSec: () => media.positionSec,
        select(id) { media.pinned = id; media.playerId = id || 'sample'; media.playerName = id === 'sample2' ? 'Podcast player' : 'Preview player'; emitMedia(); },
        setProperty(key, value) { media[key === 'Shuffle' ? 'shuffle' : 'loopStatus'] = value; emitMedia(); },
        raise() { media.error = 'Sample player opened'; emitMedia(); },
        playTrack(id) { media.trackId = id; media.title = 'A quiet place (sample)'; media.positionSec = 0; emitMedia(); },
        setQueueActive(active) { if (active) preview._card._mediaTools.renderQueue({message: 'Sample track list', tracks: [
            {id: '/sample/2', title: 'A quiet place', artist: 'Evening sessions', canPlay: true},
            {id: '/sample/3', title: 'First light', artist: 'Evening sessions', canPlay: true},
        ]}); },
        command(method) {
            if (method === 'PlayPause') media.status = media.status === 'Playing' ? 'Paused' : 'Playing';
            if (method === 'Next' || method === 'Previous') {
                media.title = media.title.startsWith('Quiet') ? 'A quiet place (sample)' : 'Quiet hours (sample)';
                media.positionSec = 0;
            }
            emitMedia();
        },
        seek(seconds) { media.positionSec = Math.max(0, Math.min(media.lengthSec, seconds)); emitMedia(); },
        stop() {},
    };
    preview._lyrics.stop();
    preview._lyrics = {load() { preview._card._mediaTools.renderLyrics({synced: true, lines: [
        {time: 0, text: 'Sample lyrics'}, {time: 70, text: 'A quiet place to begin'},
        {time: 100, text: 'A little light on the horizon'}, {time: 130, text: 'And room to breathe again'},
    ]}); }, cancel() {}, stop() {}};
    emitMedia();
    const audio = {available: true, volume: 0.64, muted: false, outputs: [
        {id: 1, name: 'Built-in speakers (sample)', active: true},
        {id: 'bluetooth:sample', name: 'Studio headphones (sample)', active: false, modes: [
            {id: 2, mode: 'music', active: false}, {id: 3, mode: 'calls', active: false},
        ]},
    ]};
    const emitAudio = () => preview._renderAudio({...audio, outputs: audio.outputs.map(output => ({...output}))});
    preview._audio = {
        setVolume(value) { audio.volume = Math.max(0, Math.min(1, value)); emitAudio(); },
        toggleMute() { audio.muted = !audio.muted; emitAudio(); },
        selectOutput(id) {
            audio.outputs.forEach(output => {
                output.modes?.forEach(mode => { mode.active = mode.id === id; });
                output.active = output.modes ? output.modes.some(mode => mode.active) : output.id === id;
            });
            emitAudio();
        },
        stop() {},
    };
    emitAudio();
    const bluetooth = {available: true, hasAdapter: true, powered: true, devices: [
        {path: '/preview/headphones', name: 'Studio headphones (sample)', connected: true, battery: 82},
        {path: '/preview/keyboard', name: 'Wireless keyboard (sample)', connected: false, battery: 67},
    ]};
    const emitBluetooth = () => preview._renderBluetooth({...bluetooth, devices: bluetooth.devices.map(device => ({...device}))});
    preview._bluetooth = {
        toggle(device) {
            if (!bluetooth.powered) return;
            const item = bluetooth.devices.find(candidate => candidate.path === device.path);
            if (item) item.connected = !item.connected;
            emitBluetooth();
        },
        setPowered(powered) {
            bluetooth.powered = Boolean(powered);
            if (!powered) bluetooth.devices.forEach(device => { device.connected = false; });
            emitBluetooth();
        },
        stop() {},
    };
    emitBluetooth();
    if (sampleMetrics) {
        preview._system.stop();
        for (let i = 0; i < 60; i++) preview._renderSystem({
            cpu: 24 + 16 * Math.sin(i / 5), memory: 48 + 4 * Math.sin(i / 12),
            loadAvg: 1.44, memoryUsed: 3.5 * 1024 ** 3,
            iface: 'wlan0 (sample)', rx: '2.4 MB/s', tx: '128 KB/s',
            rxBytes: 1e6 + 8e5 * Math.sin(i / 4), txBytes: 2e5 + 1e5 * Math.sin(i / 3),
        });
    }
}


export function sampleAgents(preview) {
    preview._agents?.stop();
    const store = new AgentStore();
    for (const [provider, session, label, state] of [
        ['claude','sample-1','ubuntu-island (sample)','approval'],
        ['codex','sample-2','api-service (sample)','working'],
        ['opencode','sample-3','docs (sample)','finished'],
    ]) store.apply({v:1,provider,session,label,state});
    const emit = () => preview._renderAgents(store.snapshot());
    preview._agents = {stop() {}, async send(value) {
        if (!store.control(value)) store.apply(value);
        emit();
    }};
    preview._card._actions.agentAsk = () => 'Sample request prepared. Live launches are available in the installed extension.';
    emit();
}
