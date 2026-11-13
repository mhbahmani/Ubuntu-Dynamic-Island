import {AgentStore} from './services/agents-model.js';
import {roundedCover} from './services/artwork-model.js';
// Development fixtures only. Controls update these snapshots, never real devices.
import St from 'gi://St';
import Cogl from 'gi://Cogl';
import {normalizeOccurrences, localDayRange} from './services/calendar-events-model.js';
import {todayDay} from './services/calendar-model.js';

// Calendar samples stay isolated even in --live previews.
export function sampleCalendar(preview, {enableIndicator = true} = {}) {
    preview._calendarEvents.stop();
    const sourceUid = 'sample-calendar', day = todayDay(), now = Date.now();
    // Keep the long-title fixture on today even when previews run near midnight.
    const dayEnd = localDayRange(day).endMs;
    const laterStart = Math.min(now + 45 * 60000, dayEnd - 60000);
    const date = n => new Date(n * 86400000).toISOString().slice(0,10);
    preview._sampleCalendarColor = '#78aed4';
    preview._sampleCalendarRecords = [
        {sourceUid,uid:'all-day',allDay:true,title:'Focus day',startDate:date(day),endDateExclusive:date(day+1)},
        {sourceUid,uid:'review',allDay:false,title:'Design review',
            startMs:now-5*60000,endMs:Math.min(now+25*60000,dayEnd),location:'Online',joinUri:'https://meet.google.com/abc-defg-hij'},
        {sourceUid,uid:'later',allDay:false,title:'Product planning and launch checklist for the next release',
            startMs:laterStart,endMs:Math.min(laterStart+30*60000,dayEnd)},
        {sourceUid,uid:'tomorrow',allDay:false,title:'Team lunch',
            startMs:localDayRange(day+1).startMs+12*3600000,endMs:localDayRange(day+1).startMs+13*3600000},
    ];
    preview._calendarEvents = {
        watch(request) {
            this.request = request; this.suspended = false;
            if (this.signature === JSON.stringify(request)) return;
            this.signature = JSON.stringify(request); this.publish();
        },
        publish() {
            if (!this.request) return;
            preview._renderCalendarEvents({status:'ready',sources:[{uid:sourceUid,name:'Personal (sample)',color:preview._sampleCalendarColor,enabled:true}],
                coverage:this.request.ranges,...normalizeOccurrences(preview._sampleCalendarRecords,{sourceUids:[sourceUid]})});
        },
        // Mirrors CalendarEventsService: hiding keeps the request for a grace period.
        suspend() { if (this.request) this.suspended = true; },
        stop() { this.signature = null; this.request = null; this.suspended = false; },
    };
    preview._settings.set_strv('calendar-event-sources',[sourceUid]);
    preview._settings.set_boolean('calendar-events-enabled',true);
    if (enableIndicator) preview._settings.set_boolean('pill-show-event',true);
}

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
        {id: 'bluetooth:sample', name: 'Studio headphones (sample)', active: false, modes: [
            {id: 2, mode: 'music', active: false}, {id: 3, mode: 'calls', active: false},
        ]},
        {id: 1, name: 'Built-in speakers (sample)', active: true},
        {id: 4, name: 'HDMI monitor (sample)', active: false},
        {id: 5, name: 'USB speakers (sample)', active: false},
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
    preview._agentSampleStore = store;
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
