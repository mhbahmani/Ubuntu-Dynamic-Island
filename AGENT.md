# AGENT.md — Ubuntu Dynamic Island: working guide + open issues

Guide for coding agents (or humans) touching this repo. Read this before
changing anything. The design spec is `HARNESS_SPEC.md`; the implementation
tree is `ubuntu-island/` (the `ubuntu-island-gnome46-*` dirs are frozen
prototypes — do not modify them).

## Environment & dev loop

- The dev box IS the target: GNOME Shell 46.0, Wayland, `ubuntu:GNOME`.
- Install/test cycle: `cd ubuntu-island && ./install.sh`, then **log out and
  back in** (Wayland — never Alt+F2 `r`), then
  `gnome-extensions enable ubuntu-island@example.local`. Code changes do
  nothing until this cycle is done — always verify the running build first
  (see "First, verify what's actually running" below).
- Static checks: `node --check` every `.js`, `node --test` in `ubuntu-island/`,
  `glib-compile-schemas --strict`, `./build.sh` for the zip.
- Runtime logs: `journalctl --user -b | grep -i 'Ubuntu Island'`. Looking
  Glass (`lg`) is available via `Main.extensionManager`.
- Gvc/St/Shell typelibs live in `/usr/lib/gnome-shell/`; Meta in
  `/usr/lib/x86_64-linux-gnu/mutter-14/`. Introspect with
  `GI_TYPELIB_PATH=... python3` (old pygobject: no `Repository.find_method`;
  use `Class.method.__doc__`; St needs Meta on the path and won't fully load —
  fall back to `nm -D /usr/lib/gnome-shell/libst-14.so`).

## First, verify what's actually running (before debugging any UI report)

Several of the open issues below present *exactly* like v2 behavior, so rule
this out first:

```bash
jq .version ~/.local/gnome-shell/extensions/ubuntu-island@example.local/metadata.json 2>/dev/null \
  || cat ~/.local/share/gnome-shell/extensions/ubuntu-island@example.local/metadata.json | grep version
diff -q ~/.local/share/gnome-shell/extensions/ubuntu-island@example.local/extension.js ubuntu-island/extension.js
```

Repo HEAD is v3 (`metadata.json` `"version": 3`). If the installed tree
differs, run `ubuntu-island/install.sh` and have the user log out/in before
re-testing.

## Verified API facts (do not re-derive)

- `Gvc.MixerControl` has **no** device-list method. Enumerate UIDevices via
  the `output-added`/`output-removed`/`active-output-update` signals +
  `lookup_output_id(id)`. `change_output()` takes the **device object**.
  `lookup_device_from_stream(stream)` → active device. See open issue 3.
- Outside-click dismissal must use `Main.pushModal(actor, {actionMode:
  Shell.ActionMode.POPUP})` + `captured-event` (the popupMenu.js pattern).
  `global.stage` button-press handlers never fire for presses over Wayland
  windows. See open issue 5.
- `Shell.BlurEffect` exists on this build (Ubuntu patch; used by the dock).
  Props: `radius`, `brightness`, `mode` (`Shell.BlurMode.ACTOR|BACKDROP`).
  See open issue 1 — it misbehaves on external monitors.
- `addChrome` params: `trackFullscreen`, `affectsStruts`, `affectsInputRegion`
  (no `visibleInFullscreen` — pre-40 API).
- `Clutter.Actor.ease()` is a GJS override (pygobject reports False — ignore).
- St CSS supports `letter-spacing`, `font-feature-settings` ("tnum"),
  gradients — but **not** `icon-size` (GObject property only, set in JS).

## Non-negotiable constraints

- From `HARNESS_SPEC.md`: nothing blocking in the Shell process; full
  `disable()` cleanup; restore the date menu; user-scope only (no sudo); do
  not claim features work without runtime evidence.
- Git: short one-line commits matching `git log --oneline` style, one logical
  change per commit, never push, never open MRs unprompted.

---

## OPEN ISSUES (user-reported 2026-10-25, deliberately NOT fixed yet)

Screenshots `4.png` (laptop, looks good) and `5.png` (external, broken) sit
untracked at the repo root. Work top-down or as instructed; each entry lists
the analysis done so far, ranked hypotheses, and the fix to implement once
confirmed.

### 1. Card background does not render on the external monitor

**Symptom (5.png):** expanded card on the external monitor shows only faint
text/icons — no glass background at all. Fine on the laptop screen (4.png).

**Analysis:** the background layer is `Shell.BlurEffect(BACKDROP)` +
translucent gradient (`ubuntu-island/island.js:83-95` `_addBlur`,
`stylesheet.css` `.ubuntu-island-surface-open`). Children (text) paint, the
surface background doesn't — points at the backdrop effect rather than CSS.

**Hypotheses (ranked):**
1. `Shell.BlurEffect` BACKDROP sampling is wrong outside the monitor it was
   validated on — Ubuntu's patch targets the dock; multi-monitor and/or
   mixed-scale (fractional scaling, laptop 200% + external 100%) breaks the
   backdrop capture, and the effect replaces the actor background with an
   empty sample.
2. Fractional/mixed scale making the backdrop node's coordinates land off the
   secondary framebuffer (mutter renders per-monitor).
3. Less likely: gradient CSS applies fine elsewhere, so not stylesheet.

**Verify:** temporarily skip `_addBlur()` (or set `this._blur = null`), log
out/in, check the external monitor. If the gradient returns → confirmed.
Also record `Settings → Displays` scale factors and whether the external is
primary.

**Planned fix:** detect-and-fallback — if painting on a monitor where the
effect can't sample (or simply: make blur opt-out per settings), draw a more
opaque gradient instead. Possibly add `blur-enabled` GSettings key. Keep the
pill un-blurred if needed. Capture before/after screenshots on both monitors.

### 2. Glass palette reads brown and is too transparent

**Symptom (user taste, 4.png):** the Ricelin warm palette
(`#2e231b → #1a120d` at alpha 0.52–0.68) looks muddy brown; content under the
card shows through too much.

**Planned fix:** move to a neutral cool graphite glass, keep opacity high:
gradient ≈ `rgba(30,32,40,0.92) → rgba(16,17,24,0.97)`, hairline border
`rgba(255,255,255,0.14)`, blur `brightness ≈ 0.7` (blur becomes subtle frost,
not a color). Neutralize text to `#f4f4f8 / #a8aab2 / #8b8d95`. Decide
whether to keep the vermilion accent (#e0563b) — it works on cool neutrals,
but confirm with the user. Consider a `surface-opacity` GSettings slider so
the user can tune it live instead of us guessing twice.

### 3. Output devices list shows only HDMI, not laptop speakers

**Symptom:** SOUND → OUTPUT DEVICES lists the HDMI output only.

**Root cause (high confidence):** `ubuntu-island/services/audio.js:26-33`
populates `_outputs` **only** from `output-added` signals. The mixer control
is created by GNOME Shell at session start (`volume.js` singleton); by the
time the extension enables, the `output-added` storm for pre-existing
devices (laptop speakers = a card port UIDevice) has already fired. HDMI
shows up because it was added/updated after enable. Gvc exposes no list call.

**Planned fix:** seed the device map after `state-changed → READY` by walking
`control.get_sinks()` → `control.lookup_device_from_stream(stream)` for each
stream, then keep the signal-driven updates. Also re-seed on
`default-sink-changed`. Note for A16: multiple ports of one card = multiple
UIDevices, one stream — seeding from streams alone may still miss inactive
ports of a card; if so, walk `control.get_cards()` and synthesize entries, or
accept stream-derived devices and document it.

### 4. Media section visible although nothing is playing

**Two distinct defects:**

(a) **Availability semantics.** `MediaService._sync`
(`ubuntu-island/services/media.js`) reports `available: true` for ANY
registered MPRIS name — including paused/idle players (browsers, Electron
apps register `org.mpris.MediaPlayer2.*` at startup with
`PlaybackStatus: Stopped`, sometimes with empty Metadata). The user expects:
nothing playing → no media section.

**Planned fix:** treat a player as present only when `PlaybackStatus` is
`Playing` or `Paused` (keep Paused so controls stay useful) — `Stopped` or
empty-metadata registrations count as absent. Also keep "player disappears"
behavior. Note the pill title also follows `available` — same rule applies.
Also fix: the `ListNames` error path (`media.js:60-66` catch) logs but never
emits — emit `{available: false}` so the UI always converges to a known
state.

(b) **Observed v3 anomaly (4.png).** The screenshot shows the media section
*with its constructor placeholder* ("No media player detected / Open an
MPRIS-compatible player"). In v3 that text should be impossible to see:
`card.js:_buildMedia()` calls `this._mediaSection.setVisible(false)` (line
111) and `renderMedia()` re-hides when unavailable (line ~189). If v3 is
confirmed running (see "verify what's actually running"), then either
`setVisible` at construction time is ineffective (try explicit
`box.hide()`/`show()` instead of `visible = value` property assignment, and
log `visible` at expand time), or `_renderMedia` never ran (check journal
for `[Ubuntu Island] MPRIS discovery:` errors). Investigate before touching
(a) — it may be the sole cause of what the user saw.

**Verify:** with a real player playing / paused / closed, and with zero
players: section appears, stays, disappears; card height reflows
(`island.relayout()` via `extension.js:_layoutIfChanged`).

### 5. Clicking elsewhere still does not close the box

**Symptom:** expanded card stays open when clicking other parts of the
screen. (v3 replaced the dead stage handler with the popupMenu-style
`Main.pushModal` + `captured-event` — `island.js:194-230`.)

**Diagnostics to run first (they discriminate the hypotheses):**
1. Does **Escape** close it?
   - Yes → grab + captured-event + collapse all work; only the BUTTON_PRESS
     path is broken → hypothesis A.
   - No → grab not taken or events not delivered → hypothesis B.
2. `journalctl --user -b | grep 'input grab failed'` — pushModal threw
   (hypothesis B).
3. In Looking Glass, expand the island and log
   `event.get_source()` inside `_onCapturedEvent` for an outside click.

**Hypotheses:**
- A. During a Clutter grab, mutter sets the event source to the grab actor
  itself, so `actor.contains(event.get_source())` is always true and outside
  presses look "inside". (popupMenu's identical check works for real menus,
  so if this is it, there is an additional difference — find it.) Robust fix
  regardless: for BUTTON_PRESS/TOUCH_BEGIN use **geometry**, not source:
  compare the pointer position against the actor's transformed bounds
  (`get_transformed_position/size`); outside → collapse.
- B. `Main.pushModal` failed (journal line). Then keep the grab optional and
  fall back to geometry-based polling… not acceptable; instead find why it
  failed (actor not mapped? another modal?).
- C. State machine stuck (state says EXPANDING/COLLAPSING so `collapse()`
  early-returns). The pill still toggles per the user, so unlikely — verify
  by rapid-toggle test A14 while at it.

**Also re-check after fixing:** hover-open path (opt-in), fullscreen snap
(`_snapCollapsed` must also release the grab — it does), and that collapse
releases the grab *immediately* so the dismissing press isn't followed by a
dead click for apps.

---

## Suggested order when work resumes

1. Verify installed build version (see above) — issues 4b and 5 exactly match
   v2 symptoms; a stale install would explain both cheaply.
2. Issue 5 (Escape discriminator → fix), since it's the most disruptive.
3. Issue 3 (seed Gvc devices) — small, contained in `services/audio.js`.
4. Issue 4a (+4b if it reproduced on v3) — `services/media.js` + section
   visibility.
5. Issue 1 (blur on external monitor) — needs the disable-blur experiment;
   then issue 2 (repaint palette) in the same pass since both touch the
   surface painting.
