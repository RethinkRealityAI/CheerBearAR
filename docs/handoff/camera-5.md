# camera-5 handoff (round 5): frames, filters, video, review, Photo welcome, AR placement, house door

These features are ported from the Happi demo and re-skinned for Cheer Bear. They use flat colours only and the existing
title-cloud art; no new Care Bears art was made. **Nothing here was tested on a real phone.** Every check below ran in the
Playwright + SwiftShader simulator, with fake cameras and a fake IMU.

## What changed

### Selfie: live frames and filters (`capture/style-strip.ts`, `capture/frame-art.ts`, `modes/face`)
- **The chip strip.** One row of round glass chips sits above the shutter:
  - Frames: Rainbow, Clouds, Hearts, Clean.
  - A thin divider, then the filters: Natural, Warm, Candy, Mono.
  - Each chip has a small drawn preview and its name under it, and each group has a caption ("Frame", "Filter").
  - The two groups are radio groups, so a screen reader announces "Frame, Rainbow, selected".
  - On narrow phones the row scrolls sideways.
- **Live view.**
  - The frame is drawn on the overlay canvas, in a lighter version so the view stays clear.
  - The filter is a CSS `filter` on the camera canvas, plus a flat tint div for Candy (`FILTER_CSS`).
- **Saved photo.** `drawFrameArt` draws the same frame with a seeded random, so it matches the live view, and
  `applyFilter` applies a per-pixel colour map. The result is the same on every phone.
- **Looks.** The look picker is now 3D bear | Classic | **Just me**. "Just me" is the show/hide-the-bear option.
  - Smile 3-2-1 is unchanged.
  - The Selfie bear is a little smaller, so her face clears the picker.
- **`--cbx-strip-h`** is set on the HUD root. It covers the picker plus the strip, and chrome-5 offsets the Actions
  toggle from it. It is removed on exit, and the canvas filter is cleared on exit.

### Tap for a photo, hold for a video (`capture/recorder.ts`, `hud.ts` shutter, `core/engine.ts`)
- **The shutter.** `hud.shutter(onClick, aria, hold?)`:
  - A press longer than 280 ms starts a clip.
  - While recording, a red ring fills over `CLIP_MAX_S` (30 s), a red rounded square shows, and a "0:04" timer appears
    above the shutter.
  - Release stops the clip. Keyboard and voice clicks (`detail === 0`) still take a photo.
- **The recorder.**
  - The engine calls `recorder.frame(canvas)` at the end of every `onRender`, so the WebGL canvas is read while it is
    still valid and `preserveDrawingBuffer` is not needed.
  - Each frame is copied to a 2D canvas (long edge at most 1280) with the live filter and tint. The overlay art is drawn
    once into a cache.
  - `captureStream(30)` feeds a MediaRecorder.
  - Type order: MP4/H.264 first (iOS records only MP4, and MP4 saves to the iPhone Photos library), then WebM.
  - With no MediaRecorder or no `captureStream`, `supported` is false and a hold just takes a photo.
  - A clip under 2 KB is treated as "too short", and the toast says "Hold a little longer for a video".
- **Sound.**
  - `AudioNode.prototype.connect`/`disconnect` are patched when the module loads. Any connection to the shared
    AudioContext's destination also feeds a tap GainNode, and while recording that node feeds a
    `MediaStreamDestination` track.
  - `?noclipaudio` turns this off.
- **Where it applies.** Selfie (all three looks) and 3D Photo (once she is placed in the room). AR has no shutter.

### Review page (`capture/review.ts`, `capture.css`)
- **Background:** flat sky blue with a white heart and cloud pattern (SVG) and a flat rainbow band at the top (SVG
  rects, not a gradient).
- **Media:** a bigger photo with a 5 px white border.
- **Buttons:** one compact row, Retake (plum, `--cb-ink`) · Save · Share, with focus on Save. "Watch photo animation"
  is its own row, and "Behind the scenes" sits in the foot.
- **Video:** the title becomes "Your video". The clip plays inline, muted and looping; a tap toggles sound. The file
  extension follows the blob type.
- **3D Photo extra:** Frame and Filter chip rows under the photo recompose it from the kept screenshot (`styles`
  option).
- The foot keeps the talk orb's corner free (`--cbx-reserved`).

### 3D Photo (`modes/photo`)
- **First visit:** a "Welcome to photo mode" sheet with three numbered steps (Take a selfie, Meet Cheer Bear, Snap the
  room) and a "Let's go" button. It shows once per page load.
- **Switching:** short toasts say what happens next:
  - "Now find a spot on the floor for her"
  - "New selfie: she keeps her spot"
  - "Point at a new spot, then Place"
- **Placing:** Place lights only after the floor has stayed steady for 0.5 s, on top of the settled gate.
- **Capture:** tap = photo; hold = video with the title, frame and filter. The saved photo defaults to the Clean frame
  and the Natural filter. Change them on the review sheet; the choice is kept for the next shot.
- No cutout standee.

### AR placement (`modes/ar/index.ts`)
- **The reticle stays above the bottom controls.** `controlsY()` measures the buttons and joystick in the middle 30–70 %
  of the width once a second. `floorHit()` pushes the hit further out (up to 6 m) until it projects above them.
- **Steady-floor gate:** a steady half second on the floor, plus ar-4's settled gate.
- **Hints:**
  - "Tilt down to the floor" when the phone looks too level.
  - "Can't see her? Tap Move" after 4 s with her off screen.
- **Move:** she comes home to the stage centre, facing you, at the default size. The preview sits on the reticle, so
  she is in view again.

### House door (`modes/ar/house-walk.ts`)
- The door swings open by itself, with a sparkle, when she walks up to it (within the door width + 0.35 m, 0.9 m in
  front).
- **After Leave:** she pops out in front of her door, "Step inside" is there again, and the hint "Step inside works
  anytime" shows for 4 s. The same hint shows after walking out through the door.

### Follow-up: capture in 3D and AR (`capture/scene-shot.ts`, `hud.ts` `dockShutter`, `hud.css`)
- **Placement:** a round 60 px shutter, the same size as Actions and Games, at the **top** of chrome-5's stack over the
  talk button. Order from the top: shutter, Actions, Games, talk button.
  - It has a glass backing so it reads on bright Care-a-Lot.
  - While recording, the clip timer sits to its left and the red ring stays inside the column.
- **The dock code is extended, not forked:**
  - `hud.dockShutter(btn | null)` prepends the button to `.cbx-dock`, so it shows and hides with the dock: orb busy,
    games (`dock(!game)`), AR placing / inside the house, mode covers (`dock(false)` on switch).
  - The shutter shows in AR only once she is placed.
  - Hiding the dock mid-clip ends the clip there (a stop hook from `shutter()`), and its review shows.
  - One `:has()` override keeps the stack visible while its shutter is recording, so a bubble cannot hide the stop
    button. chrome-5's `data-orb-busy` fallback rules are untouched.
- **Behaviour:** tap = photo, hold = video (the recorder, with the ring and timer), then the review with Frame and
  Filter chips, like 3D Photo. Defaults are Clean / Natural plus the title cloud bottom left; the choice is kept.
- **Picture source:**
  - 3D: the showcase canvas, copied straight after it is drawn. The showcase now calls `recorder.frame(canvas)` after
    `render`, and `recorder.grab()` makes a one-shot copy.
  - AR: the engine screenshot, as in 3D Photo.
- **Sim results (the real app at `/`, `scene.cjs`):**
  - At 390×844 and 375×667, in 3D and in AR placed, nothing overlaps.
  - Stack top: y 544 at 390×844 and y 367 at 375×667. The top bar ends at y 106.
  - Her speech bubble sits left of the stack (right edge 280 / 265 vs the stack's left edge at 308 / 293).
  - Tap → photo → review chips restyle; hold → MP4 clip of about 4.4 s → inline video review. Done in 3D and AR, at
    both sizes.
  - AR placing hides it; Move hides it; it comes back in 3D.
  - The first-time "Hold to talk" nudge hides the whole stack (chrome-5's rule) for about 12 s.
  - The dock was forced hidden mid-clip: the clip ended and its review showed.
  - Programs are flat: 3D 38 → 38, AR 39 → 39. No console errors.
- **Tight spot at 375×667 (chrome-5's layout, not changed):** AR's "Step inside" pill ends 5 px left of the Games
  button.

## How to run the sim

The scripts are in `docs/evidence/camera-5/sim/`. They use the repo's Playwright and serve fake cameras from
`face.webm` and `floor.webm`; see the capture-2 handoff for how to make those.

1. Start the sim server: `SIM_PORT=5222 npx vite --config scripts/vite.sim.config.mjs --strictPort`, with the dev API
   on 6222.
2. Run the scripts. Arguments are `[w h tag]`:
   - `node face.cjs 390 844 p`: Selfie chips, photo, hold video, Just me.
   - `node photo.cjs 375 667 se`: welcome sheet, selfie, flip, place, photo, review chips, Retake, hold video.
   - `node ar.cjs 390 844 p`: reticle vs controls, tilt hint, lost hint, Move, door auto-open, Leave → Step inside.
   - `probe2.cjs`: engine screenshot vs canvas grab.
   - `node scene.cjs 375 667 se`: the 3D / AR dock shutter in the real app (route `/`). It covers layout boxes, the
     bubble, photo and chips, video, the dock hidden mid-clip, AR placing / placed / Move, and programs.
3. The scripts expect the webm files at `../capture2/` (relative to the script); edit the paths for your machine.

## Tested in the simulator vs untested

| Verified in the sim (screenshots looked at) | Not verified (needs a real phone) |
|---|---|
| Selfie chips change the live view at once; the CSS filter is on the canvas and cleared after leaving Selfie | iOS Safari MediaRecorder (MP4) and `canvas.captureStream`, and saving or sharing a clip to Photos |
| The photo has the chosen frame and filter baked in (Clouds + Mono shown) | Whether clip audio is really captured: **sim clips had no audio track** (no running AudioContext in the headless sim) |
| Hold → MP4 (H.264) clip of about 5 s, which plays inline in the review: 390×844, 376×668, and 1280×800 on desktop | Clip performance (a 2D copy per frame at up to 1280 px) on low-end phones |
| Rec ring, red square and timer; the strip and picker tuck away while recording | Long-press feel on touch (the 280 ms threshold), and iOS long-press callouts on the shutter |
| "Just me" hides the bear; 3D bear brings her back | Real floors: the steady-gate time, the tilt hint thresholds, the reticle push-out on real FOVs |
| Photo welcome sheet; Place gated ("Getting ready…" → enabled); tap photo; review Frame/Filter chips recompose (`restyles` 2); hold video in the room | The live CSS filter vs the per-pixel saved filter on real phone displays (close, not identical) |
| AR: reticle above Place at both sizes (y 451 vs pill 772 at 390×844; 373 vs 595 at 375×667); tilt hint; lost hint after 4 s; Move brings her back on the reticle in view | |
| The door shut, she walks up via the real joystick vector, it opens (`doorAutoOpens` 0 → 1); Leave → Step inside visible + hint → Step inside works again | |
| No console errors in any run. Shader programs flat: Selfie 41 throughout; Photo 36 on the room camera; AR 39 throughout | |

## Open issues
- **Clip audio is untested.** The AudioNode patch is global; it is installed when `recorder.ts` loads, before any
  audio exists, and adds one extra connection per node connected to the destination.
  - Not in clips: the Classic selfie clip's sound (a `<video>` element) and a WebRTC call's remote `<audio>`. They play
    outside Web Audio. Routing them would need `createMediaElementSource`, which takes over their output, so I left
    them out.
- **3D / AR capture** was added in the follow-up (top of the dock). It hides with the dock, so there is no capture
  inside the house or during a game.
- **Sim camera drift.** The fake floor clip pans, so the room photo and the page screenshot taken a moment earlier
  show her in different places. `probe2.cjs` confirmed that the engine screenshot and a canvas grab of the same frame
  match, so this is not a capture bug.
- **Desktop Selfie** works (chips, photo, video). The clip is 1280×800 and the review shows it beside the buttons.
- **375×667:** the Selfie chip labels sit just above the shutter. It is tight but nothing overlaps. Review chips use
  smaller padding under 380 px.

## Changes outside my folders (all additive)
- `src/experience/hud/hud.ts` and `hud.css`:
  - `shutter(onClick, aria, hold?)` with the rec ring, the timer and a stop hook.
  - `dockShutter()`; `dock(false)` ends a clip.
  - Dock shutter styles, plus a `:has()` rule that keeps the stack visible while it records.
  - `ShutterHold` exported.
- `src/experience/modes/showcase/index.ts`: the dock shutter, and `recorder.frame(canvas)` after render.
- `src/experience/capture/recorder.ts`: `grab()`.
- `src/experience/types.ts`: the `HudApi.shutter` signature (optional `hold`).
- `src/experience/core/engine.ts`: `recorder.frame(this.canvas)` at the end of `onRender`, plus its import.
- `src/experience/modes/ar/index.ts` and `house-walk.ts`: placement, hints, Move, door auto-open, Step inside after Leave.
- The CSS var `--cbx-strip-h` on the HUD root, for chrome-5's Actions toggle.
- New: `docs/evidence/camera-5/` (small JPEGs, two clip frames, `sim/`) and this file.

## Findings for the immersive skill
1. **Recording a WebGL AR canvas without `preserveDrawingBuffer`:** copy the canvas to a 2D canvas inside the engine's
   render callback, right after the draw, and record the 2D canvas with `captureStream`. Draw the overlay art once into
   a cache canvas and apply the filter with `ctx.filter`. This is what you see, and it costs one `drawImage` per frame.
2. **MediaRecorder type order:** try `video/mp4;codecs=avc1…` before WebM. iOS records only MP4, and Chromium now
   records MP4/H.264 too. If the type with audio codecs is refused for the stream, fall back to
   `new MediaRecorder(stream)`. Name the file from `blob.type`.
3. **Experience audio in clips:** patch `AudioNode.prototype.connect` at module load so destination connections also feed
   a tap gain, and connect that to a `MediaStreamDestination` only while recording. Media elements are not covered.
4. **Live filter vs saved filter:** a CSS filter on the camera canvas is cheap and works on every phone for the live
   view. Bake the photo with a per-pixel map, since canvas `ctx.filter` is missing on older Safari. Keep the two close
   by eye.
5. **Seed any random frame art** (hearts, stars) so the live overlay and the saved photo match.
6. **No gradients, even a hard-stop rainbow:** draw stripes as SVG rects in a data URL, not with `linear-gradient`.
7. **Reticle above the controls:** measure the HUD buttons, project the floor hit, and push it further out until it
   projects above them. This is better than clamping NDC, because the point stays on the real floor.
8. **Tap vs hold on one button:** start a 280 ms timer on `pointerdown` and decide on `pointerup`. Treat
   `click.detail === 0` (keyboard or programmatic) as a tap. Set `touch-action: none` on the button.
9. **Sim:** Playwright `tap` on chips under a dock gets intercepted. Use `element.click()` via evaluate. To check
   capture framing, compare `takeScreenshot()` with a canvas grab in the render callback, not with a page screenshot
   (the fake camera keeps moving).
