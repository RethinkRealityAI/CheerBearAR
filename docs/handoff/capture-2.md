# capture-2 handoff (round 2): Selfie and 3D Photo after Dapo's feedback

Everything here was tested in the headless simulator only: Playwright + swiftshader Chromium, fake cameras made from
the provided face and floor recordings, fake IMU, `?desktop`. **Nothing has been tested on a real phone.**

## What changed

### Selfie, 3D bear look: she is a layer in front of you
- The shared rigged bear is drawn as an **overlay**. A depth-clear mesh (renderOrder 999, a degenerate triangle whose
  `onBeforeRender` turns the depth mask on and calls `renderer.clearDepth()`) sits in her holder. While the Selfie
  borrows her, her meshes get renderOrder 1000 and up. The head occluder and the face effects draw first, keeping
  their own occlusion. The depth is then cleared and she draws on top. Her old render orders are stored in
  `userData.cbcOrder` and put back on return; the sim checks they are back to 0 on the stage.
- Proof: with the head occluder scaled ×30 so that it covers the whole screen, her pink coverage in the bottom-left
  stays at 0.50 (0.50 without it). She is in the countdown photo exactly as on screen (pink 0.52 in her region).
- She stands a little higher than in round 1 (top of her head about 52 % up the screen), so her face clears the look
  picker.
- **Hello:** a wave plus a happy face for 1.8 s and a bounce when the look opens. The wink clip is no longer the
  3D look's intro.
- **She mirrors you** (`src/experience/modes/face/signals.ts`, gated like Bobo Booth):
  | You | She | Gate |
  |---|---|---|
  | Smile | Beams, and holds it while you smile | Mouth-corner width (over eye distance) plus corner lift, against your own resting face. The resting face is calibrated for 1.2 s after the face is found, then slowly re-learned while you are neutral. On after 400 ms over 0.07; off below 60 % of that. |
  | Mouth wide | Gasps (surprised for 1.6 s, recoil) | Own lip gap over 0.2 face units, held for 350 ms. |
  | Wink | Winks back | The engine's wink events, 1.2 s apart. |
  | Eyebrows up | Surprised for 1.1 s | Both brows up, held for 450 ms. |
  | Head tilt | Tilts her head and body | Smoothed, with a 0.1 rad dead zone. |

  Every gate needs the face found for 1.5 s and a steady head (< 1.05 rad/s); talking does not fire anything. To tune
  on a phone, use `?smile=0.07&mouthgap=0.2`. `face.signals.diag` keeps the measured numbers. `src/bear/` is not
  edited: expressions use `setExpression`, and the head tilt premultiplies the head bone after `bear.update()` (the
  bone is in the additive base, so the next frame resets it).
- The shutter keeps its 5 s visible countdown, and she cheers at 1.3 s left.

### Selfie, Classic look: the video, then an automatic photo
- Choosing **Classic** (a tap) plays `wink.mp4` keyed over the selfie camera, **with sound**, from the start. There
  is no numeric countdown; the clip has its own. On the clip's last frame she holds the pose for 350 ms and the photo
  is taken by itself, with her in it, then the review sheet opens. The **shutter replays the clip** for another
  take. Between takes she stays on screen as the clip's last frame.
- **Autoplay blocked:** if `play()` is refused, a "Tap to play" pill shows. If it is refused again, the clip plays
  muted. A watchdog also shows the pill if the clip's time stalls for 4 s.
- **Key, measured on the saved photo:**
  - Bear region: pink 0.488, green 0.
  - Top band, where the green screen was: green 0.
- **Key edge:** a 1-texel matte erosion is new in `chroma.ts` (`texel` option: the alpha is the min of 5 taps).
  Measured on the last frame:
  - Green-dominant edge pixels went from 29 % to 6 %.
  - The dark fringe went from 56 % to 17 %.
- The peace-sign 2D frame art is gone: Classic now shows the clip itself. `frame-peace.webp` and `wink-still.webp`
  have been deleted from `public/img/capture/`.

### Smile to snap
- An optional "Smile" switch sits bottom left. It is off by default and stays on across looks.
- With it on, a smile held for a further 600 ms starts a 3 s countdown in the 3D look, or plays the clip in Classic.
- It re-arms when you stop smiling.

### 3D Photo: rebuilt on the "Wear It, Meet It" pattern
The flow, in one engine session (xr-core's `Engine.start(kind)` swap, used as is, not forked):
1. **Front camera first.** Cheer Bear ears and a heart nose on your face, a dashed guide oval, and the shutter bottom
   centre.
2. **The selfie.** It is cropped round your head (2.7 face units tall from the face anchor, or the oval when no face
   is found) to the frame opening's shape. It goes straight into her frame. A thumbnail shows bottom left.
3. **"Meet Cheer Bear"** flips to the back camera: a flat cover reading "Turning the camera round…", then the swap.
   Swaps took 84–444 ms in the sim. The tap also asks for motion permission (iOS).
4. **Placing.** A reticle on the floor with her preview on it. Pinch to size her (0.4–1.8 m). **Place** is bottom
   centre and stays disabled until tracking has settled.
5. **Placed.**
   - She stands holding the frame with your selfie and keeps turning to face you.
   - Tap her: a hop, a squash and 7 hearts. Trigger words do the same.
   - The shutter, bottom centre, takes the room photo and opens the review sheet (Save / Share / Retake / Watch photo
     animation).
   - **Move** is bottom left and always there. **Selfie**, stacked above Move, flips back to the front camera for a
     new selfie. "Back to Cheer Bear" returns her.
6. **What survives.** Placement (stored relative to the phone, as the AR mode does), size and the selfie survive
   every flip, Move, and leaving and re-entering the mode. Re-entry opens on the back camera when a selfie exists,
   because she is waiting there.
- **Every pose shows the frame with the selfie.** The model is the baked `cb-frame.glb`, and the selfie plane is fitted
  into the frame opening, which was measured by ray casts. The rigged bear's Wave / Cheer poses were dropped: they
  cannot hold the frame.
- **Room photo:** the title cloud is now small, in the bottom-left corner (`drawFrameArt` `titleAt: 'bottom-left'`), so
  it no longer covers her or the frame.

### Behind the scenes now has your photo in it
- `BtsPlayer.play(photo)` draws `bts.mp4` onto a 714×1280 canvas and puts your photo into the frame Cheer Bear holds,
  for every frame. It uses `requestVideoFrameCallback`, with a requestAnimationFrame fallback.
- Per frame: the photo is cover-fitted into the frame's inner rectangle, transformed by the tracked position, scale
  and rotation. The pink paw pixels are then redrawn over it, so she holds it.
- The track is `src/experience/capture/bts-track.ts`: 121 frames of `[x, y, scale, angle]` from multi-scale,
  multi-angle NCC in numpy, smoothed (min score 0.86, mean 0.93). To regenerate it, see
  `docs/evidence/capture-2/sim/bts-track.py`.
- With no photo, the plain video plays as before. The reveal ("Watch photo animation") is unchanged.

## How to run and test

- `npx tsc --noEmit` is clean.
- **Servers** (watcher off, so restart Vite after each edit):
  ```
  API_PORT=6191 npx tsx scripts/dev-api.ts &
  API_PROXY=http://127.0.0.1:6191 SIM_PORT=5191 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
  ```
- **Fake cameras:** `ffmpeg -i face.y4m -c:v libvpx -b:v 2M face.webm`, and the same for `floor.y4m`. `lib.cjs` replaces
  `getUserMedia` with a canvas stream that plays the file for the `facingMode` asked for, so one run can flip from
  the front camera to the back.
- **Scripts** in `docs/evidence/capture-2/sim/`; screenshots go to `docs/evidence/capture-2/`:
  - `face.cjs <face.webm> [noautoplay]`: 3D look (the occluder ×30 test, every mirror cue, the countdown photo),
    Classic (the clip, the auto photo, the key numbers, a replay), reveal, BTS with the photo (plus crops of the
    composite), smile to snap, and a mode round trip with leftover and render-order checks.
    - `noautoplay` adds an iPhone-like rule: unmuted `play()` needs a real tap in the last 1 s. Without it, the sim
      cannot show this, because Playwright's `evaluate` and Chromium's sticky activation both count as gestures.
    - With `noautoplay`, it proves that "Tap to play" shows and that a real tap then plays with sound.
  - `photo.cjs <face.webm> <floor.webm>`: the full 3D Photo flow above, including two selfies, three flips, a
    restore, a Move, Selfie mode and back, and two room photos.
  - `variants.cjs <face.webm> <floor.webm> <se|desktop|reduced>`: the same screens at 375×667, at 1440×900
    (non-phone UA, `?desktop`), and with reduced motion. It logs the control rectangles and any overlaps.

## Tested in the simulator vs untested

| Verified in the sim, by looking at the screenshots and saved photos | Not verified (needs a real phone) |
|---|---|
| The bear stays in front of the face and the occluder; she is in the photo | iOS Safari: sound on the Classic clip, the tap-to-play path, `requestVideoFrameCallback` on the BTS canvas |
| Mirror reactions fire through the real reaction code (via test hooks) | The mirror **thresholds** on real faces: the fake face barely moves (smile score max 0.011, lip gap max 0.10), so only the gating and wiring are proven, not the numbers |
| The Classic clip plays unmuted, ends, auto photo, replay; the key is clean in the photo | Chroma key under real phone video decoding and colour |
| Smile to snap → countdown → photo | Front↔back swap time and camera permission prompts on iOS/Android (sim: 84–444 ms) |
| The 3D Photo flow end to end; the selfie is in the frame; the new selfie replaces it; size and placement kept | Real floor detection, settle time, and how her size feels in a real room |
| BTS: the photo tracks the frame through the whole clip (diag `photoFrames` = `frames`) | Performance on low-end phones (the BTS canvas plus the video, the selfie crop) |
| No console errors; shader programs flat (Selfie 31; Photo 23 on the front camera, 20 on the back) | |

## Open issues
- **Shader programs in Selfie: 31.** Round 1 measured 20. They are flat during the mode (no compiles on reactions,
  clips or photos), but I did not track down where the extra ones come from. They may be other workers' shared
  stage changes.
- **Restoring after "Photo again":** in the sim, after re-entering Photo from Selfie, it took about 2 minutes for
  tracking to report settled before she reappeared. The fake floor clip loops and re-settles slowly, so this is
  probably a sim artefact, but it is worth watching on a phone. The hint "Hold still a moment" shows meanwhile.
- **Placement after a flip** is restored relative to the phone: she reappears at the same distance and bearing from
  where you hold the phone, not at the same spot in the room. The world session restarts with a new origin, so the
  old spot cannot be recovered.
- **Rigged poses dropped in Photo.** Only the baked frame model can hold the selfie. A posed, rigged bear holding a
  frame would need a new export with a frame bone.
- **Reduced motion:** Classic still plays the clip, because the user chose it and it is the content. Hops, bounces and
  squashes are softened to 0 or minimal; the flash is softer.
- **Fake camera artefacts.** The face recording itself contains another filter's 3D glasses, face dots and a colour
  swatch row at the bottom. The swatch row sits behind the shutter in the Selfie/Photo screenshots. It is not our
  UI; the DOM was probed to confirm it.

## Changes outside my folders
- None to other owners' files. The modes reach xr-core's `Engine.start` and the HUD's `cover` through local type
  casts, and import `askMotionPermission` from `core/device`.
- New in `docs/`: `docs/evidence/capture-2/` (sim scripts, the BTS tracker, screenshots and photos) and this file.

## Findings for the immersive skill
- **"Character in front of the face" in a face effect:**
  - Draw her last: give her meshes a high `renderOrder`.
  - Put a depth-clear mesh just before her: a degenerate triangle whose `onBeforeRender` sets the depth mask to true
    and calls `renderer.clearDepth()`.
  - The head occluder keeps working for the ears and glasses, and she can never be cut by it.
  - This is cheaper and safer than a second scene or a second render pass with the 8th Wall camera pipeline.
- **Chroma key fringe:** CbCr distance plus a 1-texel matte erosion (the min of 5 taps) removes most of the
  grey-green halo that similarity and smoothness alone leave. Measured: green edge 29 % → 6 %.
- **Testing autoplay in Playwright is a lie by default.** `page.evaluate` and Chromium's sticky user activation both
  count as gestures, so unmuted `play()` always succeeds. To test the iOS path, patch
  `HTMLMediaElement.prototype.play` in an init script so it requires a trusted pointer or click in the last ~1 s.
- **Two fake cameras in one run:** override `getUserMedia` with a canvas `captureStream()` that plays a different
  webm per `facingMode`. Serve the files through `page.route`. This tests front/back swaps in one engine session.
- **Compositing a photo into filmed footage** (a frame held in a video): track the frame offline with whole-region
  NCC over scale and rotation, smooth the track, and draw per frame with `requestVideoFrameCallback`. Redraw the
  occluding hand pixels from the video on top. A 121-frame track is about 4 KB of TypeScript.
- **Flip to selfie, then meet the character** (the "Wear It, Meet It" pattern):
  - Set the mode's `camera` before awaiting the engine swap, so the new scene and face events route to it.
  - Store the placement relative to the phone and restore it once tracking has settled.
  - Ask for motion permission inside the flip tap.
