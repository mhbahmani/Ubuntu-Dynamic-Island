# Ubuntu Island feature video

A 58-second, 1920×1080, 60fps tour of the real GNOME Shell UI. Remotion
adds the feature captions; the interface is recorded from the bundled preview
fixtures, including native expansion and tab transitions.

The published artifacts are [demo.mp4](../../screenshots/demo.mp4) and
[demo-poster.jpg](../../screenshots/demo-poster.jpg). The repository README uses
a GitHub attachment URL to play the video inline.
After uploading a new render, replace the attachment URL in the repository README.

## Recording

`capture.py` records the native UI in a temporary GNOME session using the bundled
preview fixtures. HOME, XDG directories, D-Bus and PipeWire are isolated, with
hardware discovery disabled. Capture logs and screenshots are saved in the printed
`/tmp/ubuntu-island-*` directory.

`tour.js` controls the feature sequence, `preferences-tour.js` drives the settings
window, and `fixtures.js` supplies the presentation content. Asset attribution is
in [assets/SOURCES.md](assets/SOURCES.md).

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
