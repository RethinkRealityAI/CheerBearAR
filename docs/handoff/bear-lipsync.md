# bear-lipsync handoff

Owner folders: `src/bear/`, `src/lipsync/`, `src/audio/`, `public/models/cheer-bear*`, `tools/blender/`,
`lipsync-lab.html`, `docs/LIPSYNC.md`, this file, `docs/evidence/bear-lipsync/`.

## What was wrong (root cause)

The mouth "tore" because of the model, not the audio code, and the old engine leaned on the broken part.

- The old engine drove five hand-made shape keys, `A i U E O` (aa->A, I->i, ...). Measured at weight 1.0 on
  `care-bear.glb` (`python3 tools/blender/build_cheer_bear.py --report` prints this table):

  | shape | flipped triangles | worst edge stretch |
  | --- | --- | --- |
  | A | 9 | 6.9x |
  | i | 5 | 3.5x |
  | U | 13 | 9.6x |
  | E | 6 | 5.8x |
  | O | 16 | 10.2x |
  | eyeBlinkLeft/Right | 37 + 26 on the lashes | 5.8x |

  The damage sits at the mouth corners: the lip-split vertices that were appended to the mesh (3086-3092) carry deltas
  copied from the wrong vertices. These shapes also exist only on the body mesh and not on the tongue mesh, so at any
  real weight the tongue tip pokes through the lips. The old `0.35` cap only hid it.
- The blink was broken the same way (the lid folded into a V and the lashes crumpled), and the lash texture rendered
  opaque (black blocks), which made the eyes look heavy.
- The Faceit ARKit shapes on the same mesh are clean (jawOpen 0 flips), so the fix is to stop using A/i/U/E/O and build
  the visemes from the clean shapes.
- The old engine itself was a 6-band FFT heuristic with its own AudioContext: no vowel discrimination worth the name,
  nothing for phone audio, and a second context (iOS allows few, and each starts suspended).

Evidence: `docs/evidence/bear-lipsync/01-before-old-shapes-at-full-weight.jpg` (old A/i/U/E/O, jaw, blink) vs `02-`,
`03-`, `04-` (every shape and viseme of the new model at 1.0, two angles, no tears).

## What shipped

### Model: `public/models/cheer-bear.glb` (2.4 MB, one file for everything)

Rebuilt by script, no Blender and no generative tools: `python3 tools/blender/build_cheer_bear.py` (4 s, needs
python3 + numpy + Pillow; inputs are the two old Faceit exports and the Meshy bear, paths overridable with
`CB_BODY`, `CB_FACE`, `CB_MESHY`, `CB_OUT`; `--report` prints the tear table before/after). The build is
deterministic (a rebuild is byte-identical).

- Base: the low-poly rigged bear (41-bone Mixamo skin, no Faceit face bones; `care-bear.glb`'s clips also animated
  195 Faceit bones, which is gone).
- Blend shapes: 35 clean ARKit shapes copied by vertex index (order verified) + 14 `viseme_*` shapes baked from
  `tools/blender/viseme_recipes.json`. Each `viseme_*` is the LIP shape only; the jaw is the separate `jawOpen`
  channel, mixed by each viseme's jaw share (JALI-style). All 14 visemes: 0 flipped triangles, worst stretch 2.1x.
  Remaining imperfections are in shapes used gently: mouthSmile L/R (4/3 flips at 1.0), mouthClose (2), brows (1-2);
  expressions use them at <= 0.6.
- Eyes: real eye bones (gaze from the iris UV, limits from what is visible), and the blink is now bones too: a fur
  lid shell that rotates over the eyeball and lash bones that carry the lashes down with it. `scene.extras
  .cheerBearRig` carries the rig numbers the runtime reads.
- Materials: lashes use their alpha (MASK), no 2x specular, roughness 0.82, opaque textures as JPEG.
- Clips, named by `BearClip`: idle, talkIdle (authored), wave, walk, run (walk retimed + lean), dance, cheer, sway,
  present, sleep, wakeUp, shiver (authored), plus extras danceSmall, backflip, sad, angry, flap. Meshy's clip names
  do not match their content (`Walking` is a hello wave, `Running` is a pointing gesture, `Wave_for_Help` is a flap),
  so they were chosen by watching them; the Meshy-named clips inside `care-bear-animated.glb` were empty placeholders.
  Horizontal root motion is removed (vertical kept). Sheet: `10-body-clips.jpg`.

### Character: `src/bear/` (`BearCharacter` from `src/shared/contracts.ts`, API unchanged since v0)

`loadBear(opts?)` -> `Bear`: feet on y = 0, facing +z, `height` (default 1 m). Body clips cross-fade, one-shots return
to the loop and resolve `whenClipDone()`. On top of the clip, additive layers that never fight the body: look-at
(head takes ~60% of yaw, eyes the rest, with saccades), speech-driven head nods / sway, and the face (`face.ts`:
visemes + jaw, expressions, natural blinking with occasional doubles, idle brow life, sleep lids). While she talks from
idle she moves to `talkIdle`, and back after a pause. Extras beyond the contract: `playByName(name)` for the extra
clips, `sayBuffer(buf)`, `lipSync` (the engine), `face`, `clipNames`.

### Lip sync engine: `src/lipsync/` and `src/audio/context.ts`

Realtime, audio only, no added latency, phone-safe. Gate on a tracked noise floor, auto-gain loudness, LPC formants
(F1/F2) -> soft vowel classification against 12 prototypes, fricative / closure / nasal / burst cues using only
100-3400 Hz (4-8 kHz only as extra evidence), critically damped motion per viseme, caps. One typed config object.
Full description and every parameter: `docs/LIPSYNC.md`.

### Lab: `src/bear/lab/LipSyncLab.tsx` (route `/lab/lipsync`), dev entry `lipsync-lab.html`

Close-up bear, inputs (sample, synthetic vowel/syllable/phrase scripts, file, mic), phone-quality toggle (8 kHz,
300-3400 Hz, mu-law), live viseme bars and debug read-out, shape sweep to 1.0, viseme sweep, all tuning sliders with
Copy JSON, body clip and expression buttons. Theme tokens only, no gradients. `11-lab-page-desktop-and-phone.jpg`.

## Bugs found and fixed along the way (worth knowing)

- **Additive bone rotations accumulated.** three.js `PropertyMixer.apply` only writes a bone when its animated value
  changes. On a held or constant track (common: clips that do not move the neck), a rotation added after
  `mixer.update` was applied on top of last frame's result, and the head drifted / tipped over. Fix in `Bear.update`:
  restore the saved clip pose of the bones we add to before `mixer.update`, save it again after. Anyone adding
  procedural rotations on top of an AnimationMixer needs the same pattern.
- Lid/lash bones have a rest scale of ~100 (armature 0.01 compensation): always multiply the rest scale, never set it.
- The first formant estimator (spectral centroid) labelled every vowel O/U because a high voice's first harmonic
  dominates the low band; replaced with LPC.
- Silence was being read as frication (the tilt of an empty spectrum is 0 dB); cues now need energy above the floor.

## How to see it

- `npm run dev`, open `/lab/lipsync` (or `/lipsync-lab.html`). Tap any input once (unlocks audio).
- Evidence (headless Chromium, SwiftShader): `docs/evidence/bear-lipsync/`
  - `01` before: old shapes at 1.0 (tears, tongue through lips, broken blink, black lash blocks)
  - `02` `03` after: every blend shape and the eyelid rig at 1.0, front and three-quarter
  - `04` after: each viseme through the runtime path (lips + jaw) at 1.0
  - `05` `06` live frames while `test-audio.wav` plays, full band and phone band (labels are the frame's weights)
  - `07` `08` `09` live frames for the synthetic vowel sweep, syllables, phrase
  - `10` all body clips through the `Bear` class; `11` the lab page
- Offline check of the engine on the synthetic vowel sweep (dominant viseme per vowel, full band / phone band):
  a -> aa, e -> E, i -> I, o -> O, u -> U in both.

## Verified / not verified

Verified (headless Chromium, swiftshader): `npx tsc --noEmit` clean; lab page loads with no console errors; every
shape and viseme at 1.0 without tears; blink; every clip; live lip sync on the sample and on synthetic speech, full
band and 8 kHz phone band, with matching results; model rebuild is reproducible.

NOT verified (nothing here was phone-tested):
- A real Twilio call (`setSpeechStream` with a remote WebRTC stream; the muted-element trick is the standard fix
  but untested here).
- iOS Safari / iPhone (unlock, interruptions, performance) and Android Chrome.
- Real speech beyond the one 2.5 s sample: other voices, fast speech, background noise, line noise.
- Frame rate on low-end phones (the face rig and the engine are light, but not measured on a device).

## Open issues / next steps

- Watch it on a real call and tune `gateOpenDb` / `dynamicRangeDb` / `intensity` for the actual voice (the lab's Copy
  JSON gives a config patch).
- The admin config has `lipSync.showControlsPanel` / `showDebugHud`; the lab does not read them yet (there is no shared
  client config loader in `src/shared/`). Whoever owns config loading can pass them in; the lab shows both today.
- Expression shapes `mouthSmile*` still flip a few triangles at 1.0 (used at <= 0.6 so not visible). A cleaner smile
  would need resculpting.
- The lab sample `src/bear/lab/test-audio.wav` duplicates `public/media/voice/mock-cheer-bear.wav` (110 KB).

## Notes for other owners

- `@/bear`: `loadBear`, `unlockAudio`, `BEAR_MODEL_URL`, `Bear`. Call `bear.update(dt)` every frame, `unlockAudio()`
  in the first tap, `bear.setSpeechStream(stream)` for the call. Do not create AudioContexts; use
  `getAudioContext()` from `src/audio/context.ts`.
- xr-core: bear is 1 m tall by default (`loadBear({ height })`), origin at the feet, facing +z, `frustumCulled` off on
  skinned meshes. Extra clips via `bear.playByName('backflip' | 'sad' | 'angry' | 'danceSmall' | 'flap')`.
- app: `LipSyncLab` is the default export of `src/bear/lab/LipSyncLab.tsx` (already routed at `/lab/lipsync`).

## Findings for the MEDIALIFE immersive skill

- Lip sync that "tears" is usually the shapes, not the code: measure flipped triangles and edge stretch per shape at
  1.0 before tuning anything. Caps hide broken shapes; they do not fix them.
- Split visemes into lips-only shapes plus one jaw channel (JALI-style); it blends without double-opening.
- Use one AudioContext app-wide, unlocked in a gesture with a 1-sample buffer; analyse remote WebRTC streams with a
  muted element attached; pull analysers through a 0-gain node into the destination.
- For vowels from audio, use LPC formants, not band energies or spectral centroids; keep every cue inside
  300-3400 Hz so phone audio looks the same as full band.
- three.js AnimationMixer does not rewrite unchanged tracks: restore the clip pose before `mixer.update` when adding
  procedural rotations.
- Meshy clip names lie; check content. Lash textures need alphaMode MASK. Mixamo armatures often carry a 0.01/100
  scale pair: respect bone rest scale.
- Headless evidence works: Playwright + `--use-angle=swiftshader`, `preserveDrawingBuffer`, grab the canvas with
  `toDataURL`, and record the frame's weights with each image so labels match what is drawn.
