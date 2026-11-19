# xr-capture handoff: Selfie, 3D Photo and the shared capture module

Everything here was tested in the headless simulator (Playwright + swiftshader, fake camera, fake IMU, `?desktop`)
and in desktop Chromium only. **Nothing has been tested on a real phone.**

## What exists

| Area | What it does |
|---|---|
| Selfie (`src/experience/modes/face/`) | Front camera, face tracking. **Intro:** the wink green-screen clip, keyed in a flat CbCr chroma shader on a camera-space 9:16 plane, plus the title art. Tap anywhere or use the Skip pill to skip. It ends by itself when the clip ends, after about 4 s, with a 7 s cap. With reduced motion, a keyed still (`wink-still.webp`) shows for 1.6 s instead. Sound plays unmuted when primed. A capture-phase click on the Selfie switch button plays and then pauses the video inside the user gesture, for iOS. **Face effect (`face-fx.ts`):** pink bear ears, a heart nose with a white shine, and cheek hearts. They are flat DoubleSide meshes with a depth-only head occluder and pop in on face found. **Bear:** the shared rigged bear is borrowed through `ctx.bear` into the bottom-left of the camera view. She uses the same 2 lights as the stages, so there is no shader recompile. She waves on hello, cheers before the shot, lip-syncs, and reacts to trigger words (3D look only). **Look picker:** "3D bear" / "Classic". Classic hides the bear and adds the old 2D peace-sign frame art. **Shutter** bottom centre: a 5 s visible countdown ("Tap again to shoot now"), and a second tap shoots at once. Hint "Look at the camera" while no face is found. |
| 3D Photo (`src/experience/modes/photo/`) | Rear camera, world tracking. A reticle on the floor previews `cb-frame.glb`, a baked Cheer Bear holding a picture frame. Pinch sizes it from 0.4 to 1.8. Place (bottom centre) waits until tracking has settled; a tap also places. Once placed: the shutter is bottom centre, Move is bottom left and always there, and a pose picker shows Frame / Wave / Cheer. Wave and Cheer swap in the rigged bear. Move goes back to placing and keeps the pose and size. Re-entering the mode starts placing again. Hints: "Point at the floor", "Pinch to size, then Place", "Pick a pose, then shoot". |
| Capture module (`src/experience/capture/`) | `countdown.ts` holds the countdown and a flat white flash: opacity 0.9, or 0.35 under reduced motion. `compose.ts` sets up the engine CanvasScreenshot (max 1920, quality 92), then makes the JPEG: 0.9 quality, long edge clamped to 1600 to 1920, canvas freed afterwards. `frame-art.ts` draws the title art and the peace art. `share.ts` uses Web Share level 2 with a File built before the tap; any failure other than AbortError falls back to a download, and the object URL is revoked after 30 s. `review.ts` is the review sheet. `reveal.ts` holds the reveal and behind-the-scenes players. `chroma.ts` is the key shader. `ui.ts` has the buttons, icons and segmented picker. All styling is in `capture.css`, scoped under `.cbx`, flat colours, theme tokens. |
| Review sheet | z-index 60, white. Close X, title, then the photo (long-press save works). Row 1: Save, Share. Row 2: Retake, "Watch photo animation". Footer: "Behind the scenes" (Selfie only) and an aria-live status line ("Saved. Share it from your photos" on the fallback path). Escape means Retake. The bottom strip under the buttons is padded by `--cbx-reserved` (88 px) so nothing sits in the talk-button corner. On computers or landscape tablets (900 px wide or more, landscape), the photo is on the left and the buttons on the right. |
| Reveal | `reveal.mp4` plays on a 720x1280 canvas. From 9.05 s the photo fades in, cover-fit, inside the frame opening. The pink paw pixels are then redrawn on top, so the paw holds the photo. The source clip had no green opening; the old scene overlaid the photo the same way. At the end: "Save picture" and "Replay". Skip jumps to the end. |
| Behind the scenes | Plain video player for `bts.mp4` with Replay. It does not composite the photo, which the old scene did. |
| Events | Every capture emits `photo` through `ctx.capture(blob)`. |
| Cleanup | On exit: the countdown, overlay canvas, review, players, pickers and buttons are removed. The reveal and behind-the-scenes videos are paused, have their src cleared and are removed. The wink video is paused; it keeps its src for the next visit and only loses it on dispose. Object URLs are revoked, and the bear goes back to the stages. |

### Assets (all used, all new)

| File | Size | Source / processing |
|---|---|---|
| `public/media/capture/wink.mp4` | 459 KB | 720x1280 H.264 main, AAC mono 96k, faststart |
| `public/media/capture/reveal.mp4` | 1.7 MB | from CB-reveal-green.mp4, 720x1280, no audio |
| `public/media/capture/bts.mp4` | 968 KB | 714x1280, no audio |
| `public/img/capture/frame-title.webp` | 41 KB | 662x349, cropped from filter-peace.png |
| `public/img/capture/frame-peace.webp` | 57 KB | 706x900, the peace-sign bear from filter-peace.png |
| `public/img/capture/wink-still.webp` | 28 KB | last wink frame, keyed to alpha (reduced-motion intro) |
| `public/models/capture/cb-frame.glb` | 221 KB | from 3.88 MB with gltf-transform: meshopt, webp 1024, no simplify |

`cb-frame.glb` is one fused, baked mesh with no skeleton, so the frame cannot be split from the bear. That is why the Wave
and Cheer poses use the rigged bear without a frame.

## How to run and test

- `npx tsc --noEmit` is clean.
- Simulator server: `npx vite --config docs/evidence/xr-capture/sim/vite.sim.config.mjs`. It uses port 5186 and its
  own cache (`node_modules/.vite-xr-capture`). HMR and the file watcher are off, so **restart it after every edit**.
- Scripts in `docs/evidence/xr-capture/sim/` (Playwright from the repo's existing install; screenshots go to
  `docs/evidence/xr-capture/`):
  - `node face.cjs <face.y4m>` runs the full Selfie flow:
    1. 3D → Selfie: intro, skip by tap, face found.
    2. Countdown, capture (the photo is saved next to the screenshots), review.
    3. Reveal, share fallback, behind the scenes, retake.
    4. Classic look with "shoot now".
    5. Selfie → AR → Selfie → 3D.

    It also logs shader program counts and any videos still playing.
  - `node photo.cjs <floor.y4m>` runs 3D Photo:
    1. Settle, pinch, place, capture, review, retake.
    2. Wave and Cheer poses.
    3. Move (keeps pose and size), place again.
    4. Photo → Selfie → Photo → 3D.
  - `node variants.cjs <face.y4m> se|reduced|desktop` runs at 375x667, at 390x844 with reduced motion, and at
    1280x800. It reports whether the intro shows and whether any review button sits in the talk-button corner.
  - `node app.cjs <face.y4m>` uses the real app at `/?test&desktop&mockVoice=fast,silent` (React shell plus talk
    orb). It checks what is on top at the orb centre while the review is open.
- Test videos (scratchpad, not in the repo):
  - The face video is a still face photo with an "ABC" label for the mirror check. Make one with
    `ffmpeg -loop 1 -i face.jpg -t 20 -vf scale=960:720 -pix_fmt yuv420p face.y4m`.
  - The floor clip is the one xr-core used.
  - The glasses and colour swatches visible in the evidence shots are part of that test photo, not the app.
- Debug handles: `window.__cb.internals().modes.get('face' | 'photo')` exposes `state`, `diag`, `faceFound`, `pose`,
  `size` and `reveal.diag`.

## Verified in the simulator (by looking at the output)

- **Selfie, 390x844:**
  - Intro shows keyed over the camera with the title, and tap skips it. When left alone it ends after about 4 s.
  - Face found; ears, nose and cheeks sit on the face; the bear is bottom left.
  - Countdown and "shoot now" both work.
  - 3 captures, each about 739x1600 and 158 KB. They show the camera, the 3D layer and the frame art.
  - **Mirror check passes:** "ABC" in the photo is reversed exactly as on screen, and the title art reads the right way.
  - Classic draws the peace art.
- **Review, sharing and players:**
  - Share in headless Chromium falls back to a download, with the status line. Save downloads.
  - Reveal: the photo appears in the frame with the paw on top. It ran 83 frames and reached `ended`.
  - Behind the scenes plays, and its video is removed on close.
- **Shader programs** stay flat across captures: 20 in Selfie, 21 in 3D Photo.
- **3D Photo:**
  - Settle, pinch (to 1.44), Place.
  - Pose changes work. Move keeps pose and size, and Move is there again after placing.
- **Switching modes:**
  - Selfie → AR → Selfie and Photo → Selfie → Photo → 3D all work.
  - In 3D afterwards there are no leftover overlays, sheets or pickers, and the wink video is paused.
  - Engine swaps take 52 to 178 ms.
- **Variants:**
  - 375x667 and 1280x800 lay out correctly.
  - Reduced motion shows the still and the intro ends in about 1.6 s.
  - No review button is inside the talk-button corner in any variant.
- **Real app (`/`):**
  - The review sheet covers the talk orb (`cbc-rv-actions` is on top at the orb centre).
  - No review button is under the orb.
  - The shutter (157 to 233 px) and the orb (302 to 374 px) do not overlap.
- **Console:** no errors in the Selfie and variant runs. The only expected 404 is `/api/config` in `app.cjs`, which
  happens without the functions server.

## Untested (no real phone)

- iOS sound priming for the wink clip, and autoplay behaviour in Safari.
- Web Share with files on iOS and Android, including the share sheet, cancel, and saving to Photos.
- CanvasScreenshot resolution and quality on a real device. In the simulator the canvas is DPR 1.5, so the selfie is
  upscaled to 1600 on the long edge. Phones with a higher DPR should get a sharper source.
- How well the face effect fits real faces as they move, turn and get close or far.
- 3D Photo placement and scale on a real floor, and pinch with real touches (the simulator sends synthetic pointer
  events).
- Performance and heat on mid-range phones while the reveal canvas runs.

## Open issues

1. **Engine compile race (in xr-core's `src/experience/core/engine.ts`, not my code):**
   - Symptom: an intermittent pageerror, `Cannot read properties of undefined (reading 'isReady')`, from three's
     `compileAsync` → `checkMaterialsReady`.
   - Cause: a quick mode swap releases the renderer (`releaseGpu` disposes the materials) while a warm `compileAsync`
     is still polling. Seen in `photo.cjs` on Photo → Selfie → Photo; there is no visible effect.
   - Suggested fix: in `warm`, use `renderer.compile(...)` plus its own poll that skips materials with no
     `currentProgram`, and stop polling if `this.xr?.renderer !== renderer`.
2. In the real app, the app's top pill ("Chat Time / 0 words found") overlaps the title art in Selfie. This is the
   known top-overlap issue between the app and xr-core. My title's top is measured from the bottom of `.cbx-top`, so the
   app pill would need a slot there, or I need a reserved-top value to read.
3. Before a face is found, the hint pill "Look at the camera" sits over the title cloud for a moment.
4. Behind the scenes does not composite the user's photo (the old scene did). It plays as a plain clip.
5. The Wave and Cheer poses in 3D Photo show the bear without the frame, because the GLB cannot be split. A proper fix
   needs a separate frame model or a rigged bear-with-frame from the art team.
6. 3D Photo does not restore its placement when you come back to the mode; it starts placing again. Pose and size are
   kept.
7. The review sheet (z 60) covers the talk orb by contract. If the app wants the orb visible during review, the app
   layer needs to sit above 60, or the review needs to leave the corner transparent.
8. `app.cjs` timed out twice on startup while other sim runs were going (the Start-to-started wait). It passed on its
   own afterwards. This looks like load in the simulator, not a bug.

## Changes outside my folders

- **Code:** none. Everything is in `src/experience/capture/`, `src/experience/modes/face/` and
  `src/experience/modes/photo/`. The modes are picked up through the existing glob in xr-core.
- **New public folders:** `public/media/capture/`, `public/img/capture/` and `public/models/capture/`, all listed above.
- **Docs:** this file, plus `docs/evidence/xr-capture/` (screenshots, downscaled photo samples and `sim/` scripts).
- `package.json` was not touched and nothing was installed.

## Findings for the immersive skill

- **Chroma key on a VideoTexture:**
  - Keep the texture in `NoColorSpace`, key in raw sRGB on CbCr distance, and write the output without colour-space
    chunks.
  - For the wink clip: key colour (0,182,87), similarity 0.16, smoothness 0.1, plus spill reduction.
  - Check the numbers in numpy on a real frame before trusting them.
- **CanvasScreenshot:** call `XR8.CanvasScreenshot.configure({maxDimension: 1920, jpgCompression: 92})` before taking
  the screenshot. With the default settings the image is small and soft.
  - The front-camera screenshot is already the mirror image the user saw.
  - Draw 2D frame art unmirrored on top of it.
- **`compileAsync` race:** three's `compileAsync` can throw if the renderer's materials are disposed while it polls.
  Guard warm-up compiles against renderer release.
- **The reveal clip has no green opening.** The old scene overlaid the photo at the end. Cover-fit the photo into the
  opening, then redraw the paw pixels on top.
- **iOS unmuted autoplay:** a capture-phase click listener on the mode button can play and then pause the clip inside
  the user gesture, which unlocks unmuted playback later.
- **Web Share:** build the `File` before the tap, so `navigator.share` runs inside the gesture. Treat `AbortError` as a
  cancel; anything else falls back to a download.
- **Simulator:** a Vite server with the watcher off needs a restart after every edit, or you test stale code.
