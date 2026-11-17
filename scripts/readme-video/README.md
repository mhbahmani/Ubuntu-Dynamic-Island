# Ubuntu Island feature video

A silent 58-second, 1920×1080, 60fps tour of the real GNOME Shell UI. Remotion
adds the feature captions; the interface is recorded from the bundled preview
fixtures, including native expansion and tab transitions.

The published artifacts are [demo.mp4](../../screenshots/demo.mp4) and
[demo-poster.jpg](../../screenshots/demo-poster.jpg). The repository README uses
an image link to the MP4. Nothing is uploaded automatically.

## Privacy and recording

`capture.py` copies the runtime and existing preview fixtures to a temporary
folder. It uses an empty HOME, private XDG directories, a private session bus,
a headless GNOME compositor and a private PipeWire/WirePlumber instance with
hardware discovery disabled. It does not capture the host desktop or microphone.
Calendar source selection is cleared before extension startup; then the bundled
fictional events replace the calendar reader. Notifications are generated inside
the private Shell. No host settings, accounts, calendar events, notifications,
routes or agent sessions are copied. All displayed controls use sample data.

The installed extension and runtime source files are not modified. `tour.js`
automates fixture actions only inside the temporary session. Capture logs and
check screenshots remain in the printed `/tmp/ubuntu-island-*` directories.
The recording excludes the pointer and hides Ubuntu’s duplicate date menu only
inside the isolated session. Playback, sound volume and notification grouping stay
unchanged during the tour. Per-item sample labels are removed only from the
temporary fixture copy; the video retains its fictional-data notice.
The opening shows a stock Ubuntu desktop, then fades its wallpaper, panel and dock
as the camera moves toward the notch. The video ends on a quick showcase of
Ocean, Forest, Ember, Lagoon, Amethyst, Berry and Graphite, then smoothly returns
to the full Ubuntu desktop with the same opening text for a loop-like ending.
The demo player shows “Believer” by Imagine Dragons with the user-supplied cover;
the notch title budget is 18 characters so the whole title fits. The video remains silent.
The populated notch includes weather, commute, agents, a green CPU indicator, stacked network
rates, date and time. Tabs follow
the navigation order. Calendar selection uses different fictional events on two
dates, followed by Thursday 13 Farvardin 1405 (Nature Day). The brief settings tour opens Appearance, switches to Notch, and uses the real
reorder controls to move Music after Weather and Commute. A live inset shows the
collapsed notch changing alongside the preferences window.
Telegram and WhatsApp marks illustrate fictional messages; asset sources are in
[assets/SOURCES.md](assets/SOURCES.md).

## Reproduce or edit

From this directory, on the project's Ubuntu/GNOME 46 development environment:

```sh
npm ci
npm run capture
npm run dev
npm run lint
npm run render
```

Capture requires the existing native preview dependencies, FFmpeg, PipeWire,
WirePlumber 0.4 and GNOME's screencast service. No packages are installed by the
capture command. Remotion downloads its rendering browser when first needed.

`capture.py` records approximately 71 seconds of 2560×1440 footage; its
private GNOME session is limited to 90 seconds. Native opening/closing animations are captured with GNOME’s
slowdown factor, then retimed in `prepare.py` to provide more real samples
through each transition. No synthetic motion frames are generated. The script
normalizes the result to 60fps and aligns captions and camera cues to the new
timestamps; it also reports the captured transition frame counts.
A bounded frame-clock callback keeps the isolated compositor painting during
capture, including after preferences closes. It stops with the recording and is
never part of the installed extension. The opening desktop still is reused at
the ending so the text and desktop match across the loop boundary.
Raw footage, private capture metadata and editor build outputs are ignored.
The generated `src/recording.ts` retains timing for the editable composition.
Camera timing is programmatic to follow native actions; caption layers remain
individually editable in Studio.
Re-record after changing the extension; source edits alone do not update footage.

Edit the text and scene layout in `src/Composition.tsx`. Preview is available in
Remotion Studio (`npm run dev`). The render uses two workers to limit load on the
desktop. The final MP4 has no audio track and uses browser-compatible H.264/yuv420p.
Noto Sans is bundled for consistent typography; its license is in `public/fonts`.

To refresh the README poster after rendering:

```sh
ffmpeg -y -ss 11.2 -i ../../screenshots/demo.mp4 -frames:v 1 \
  -vf scale=1280:-1 -q:v 2 ../../screenshots/demo-poster.jpg
```

The sample recording demonstrates appearance and interactions; it does not
validate live providers, real device routing or account synchronization.
