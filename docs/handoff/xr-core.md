# xr-core handoff: the experience (3D showcase, AR, the engine side of Selfie and Photo)

Everything here was tested in the headless simulator and desktop Chromium only. **Nothing has been tested on a real
phone yet.**

## What exists

`createExperience(opts)` in `src/experience/index.ts` implements `ExperienceApi` (src/shared/contracts.ts). It is
framework-free (vanilla DOM + three.js r180 from npm + the engine binary from index.html's script tag) and the app
already mounts it through `src/app/loaders.ts`. The simulator checked the real app at `/`: the splash, Start and the
app's welcome sheet on top all work.

| Area | What it does |
|---|---|
| Splash | Title art, the bear rendered live in a transparent "hero window", a one-line lead, Start ("Loading…" until ready), a loading bar showing real progress (bear 6 : props 3 : 360 sky 1 : videos 1), and "Activated by MEDIALIFE". Start slides the splash away and the camera eases from the hero framing to the play framing. In landscape the card sits on the left and the bear on the right. |
| HUD | Top bar: small title, a segmented switcher (3D / AR / Selfie / Photo), and a menu (How it works, Start again, Licences). Hint pill (white on black glass). Speech bubble. Bottom row: Move bottom-left, joystick or shutter bottom-centre, and the bottom-right corner kept free (`setReservedCorner`, default 88). A flat pink cover shows while the camera switches. Sheets cover errors, the QR code and licences. Safe areas and reduced motion are handled. |
| Showcase (`modes/showcase`) | Care-a-Lot 360 backdrop plus a soft cloud floor. The bear waves hello. The joystick (or arrow keys / WASD on a computer) walks or runs her, with a follow camera. Drag orbits within ±1 rad, pinch or scroll zooms (1.9 to 6). Tapping her plays Wave, Cheer or Sparkle (emitted with `source: 'tap'`). The camera pulls back for big moments. This mode has its own WebGL canvas, which is disposed with `forceContextLoss` whenever a camera mode runs. It drops to DPR 1.25 if frames are slow. |
| AR (`modes/ar`) | A reticle on the floor, with the whole stage previewing on it, facing you. Pinch to size (0.25 to 1.3; the default 0.5 makes her 0.5 m tall). Place is gated on world tracking having settled. After placing, the joystick walks her relative to the camera; she stays out of the house walls and the doorway takes her inside. Tapping her gives a reaction. Tapping the house, or walking her through the door, grows the house around you (2.9 m tall, you in the front half facing the TV, the theme playing with sound, the bear popping in front of you). "Leave" (stacked above Move) or Move brings it back. Move returns to placing and keeps everything else. Leaving AR remembers the stage relative to the phone; coming back (from 3D or Selfie) puts it back once tracking settles again. She looks at the camera when idle. The hint shows "Move your phone slowly" while tracking is LIMITED. |
| Moments (`scene/moments.ts`) | House, Sparkle, Running, WakeUp, Sleep, Dance, Wave, Magic, Cold, Party, Rainbow, plus a generic **Cheer**. `actions` lists all 12. Names are matched case-insensitively, plus aliases (wake, wake up, run, magic orb). Rules: one moment at a time; at most 2 more wait in a queue; a repeat or anything within a 1.5 s cooldown returns `false`. Sleep is a state: she stays asleep (Zs, dim light) until WakeUp, another action (which wakes her first), the joystick, a tap, or about 30 s. A queued action cuts Party or House short to their outro after a few seconds. Every moment ends in a tidy idle. |
| Engine (`core/engine.ts`) | One engine session for world and face. A swap is `XR8.stop` → swap the tracker modules → `XR8.run`. It re-adds every mode root to each new scene and adopts GL textures across renderers (19 adopted per swap in the test). It frees each dropped renderer's buffers and programs, builds the environment map once, and compiles shaders after SLAM settles (face: immediately). Uploads are limited to 2 textures per frame. It includes the world-health port (adaptive DPR, settle gate, `?diag`). Errors are classified: permission, unsupported, error. |
| Placeholders | The Selfie placeholder puts a pink disc on the nose. The Photo placeholder has a shutter that takes an engine screenshot and emits `photo`. They run until `modes/face` and `modes/photo` exist. |
| Desktop | Camera modes on a computer show "Open this on your phone" with a QR code and emit `unavailable {reason:'desktop'}`. `?desktop` skips that check (for the simulator). Permission or engine errors show a friendly sheet, fall back to the showcase and emit `unavailable`. |

Assets (optimised, all in use): `public/models/props/*.glb` (9 props, 93 to 256 KB each, 2.8k to 9k triangles, 1024 webp, meshopt); `public/media/portal.mp4` (360², keyed green 0x14d15d, 182 KB) and `theme.mp4` (512x288 H.264 + AAC, 2.6 MB); `public/img/care-a-lot-360.webp` (2912x1440, 222 KB), `cb-title.webp`, `activated-by.webp`.

### Files
```
src/experience/index.ts                 createExperience: mount, splash/load, Start, setMode (queue, cover, fallback), trigger, speech, registry
src/experience/types.ts                 Mode / ModeContext / EngineView / HudApi (the contract for face + photo)
src/experience/dev.ts                   dev page entry (window.__cb), experience-dev.html at the repo root
src/experience/core/engine.ts           the one engine session (world <-> face swap), warm/compile, GPU housekeeping
src/experience/core/world-health.ts     TS port of the house world-health module
src/experience/core/{assets,device,emitter,timeline}.ts
src/experience/hud/{hud.ts,hud.css,icons.ts}
src/experience/scene/stage.ts           a set (lights, house + portal + inside, car, mailbox, rainbow, party set, orb, moods)
src/experience/scene/moments.ts         the runner + the 12 choreographies
src/experience/scene/{actor,fx,media,props}.ts
src/experience/modes/showcase/index.ts  3D (own renderer)
src/experience/modes/ar/index.ts        AR
src/experience/modes/shared.ts          gestures, arrow-key stick
src/experience/placeholders/{face,photo}-placeholder.ts
docs/evidence/xr-core/*.jpg             screenshots (390x844 phone, 1280x800 desktop at 75 %)
docs/evidence/xr-core/sim/              the simulator scripts (see below)
```

## Run and test

```bash
PORT=5181 npm run dev            # app at /, the experience alone at /experience-dev.html
```
`/experience-dev.html` flags: `?clean` (no test panel), `?autostart`, `?mode=ar|face|photo` (first mode after Start), `?desktop` (camera modes on a computer / in the simulator), `?diag`, `?verbose`. The test panel has a button for every action and mode. `window.__cb` gives `trigger(name)`, `setMode(m)`, `debug()` (mode, fps, shader program counts, moment, asleep, AR placed/inside/restoring, engine swaps/errors/adopted), `internals()`, `events`. With `?test`, the real app also exposes the experience as `window.__cbx`.

Simulator (`docs/evidence/xr-core/sim/`; Playwright comes from the global install, never install it):
```bash
sh docs/evidence/xr-core/sim/make-videos.sh /path/to/a-face-photo.png    # floor.y4m (+ face.y4m), not committed
npx vite --config docs/evidence/xr-core/sim/vite.sim.config.mjs          # :5182, HMR off (other people's edits reload the page otherwise)
node docs/evidence/xr-core/sim/showcase.cjs [desktop]   # splash, Start, 11 actions, programs, console
node docs/evidence/xr-core/sim/ar.cjs                   # 3D -> AR -> place -> walk -> inside -> Leave -> moments -> Move -> 3D -> AR (restored) -> Selfie -> AR
node docs/evidence/xr-core/sim/ar.cjs face              # Selfie placeholder on face.y4m
node docs/evidence/xr-core/sim/desktop.cjs [phone]      # desktop QR / unavailable, menu, licences, how, speech
node docs/evidence/xr-core/sim/probe.cjs                # lists any shader program that appears during AR moments
```
Shots go to `sim/shots` (`OUT=` overrides). swiftshader runs at 5 to 20 fps, so the scripts wait on state, not on time.

### Results (simulator, 2026-11-19)
- **Showcase, 390x844 and 1280x800:** Start makes no permission prompt (0 dialogs, no camera request). All 11 actions return `true` and play. An unknown name returns `false`. Shader programs stay at 17 after warm-up across all 11 moments. The console has no errors.
- **AR (fake 960x720 floor camera + fake IMU, `?desktop`):** tracking NORMAL, settled after about 5 s. Place, then walking forward for 9 s takes her through the door and the house grows around you; the theme flag is on. Leave works, Rainbow / Party / Sleep / Magic play, Move then Place again works, and 3D → AR restores the placement. AR → Selfie placeholder → AR happens in one session: 4 runs, swaps 118 / 80 / 78 / 55 ms, 19 textures adopted per swap, no engine errors. Engine programs stay at **18** from placing through the house and all 11 moments (`probe.cjs`). The console has no errors.
- **Selfie placeholder (face photo y4m):** the face is found in about 2 s and the disc sits on the nose tip. Selfie → 3D works.
- **Desktop:** AR shows the QR sheet and emits `unavailable {mode:'ar', reason:'desktop'}`; the mode stays showcase. Arrow keys walk her.
- **Real app (`/`):** the experience mounts, Start works, the app's welcome sheet shows above it, and the console is clean.

Evidence: `docs/evidence/xr-core/phone-showcase-*`, `phone-ar-*`, `phone-face-*`, `phone-sheet-*`, `phone-app-*`, `desktop-*`.

## How to add the real Selfie and Photo modes (xr-capture)

Create `src/experience/modes/face/index.ts` and `src/experience/modes/photo/index.ts`. Each one exports
`createMode(ctx: ModeContext): Mode` (a default export works too). Nothing outside your folder has to change:
`index.ts` finds them with `import.meta.glob('./modes/{face,photo}/index.ts')` after the splash assets, calls
`load()` in the background, and swaps them in for the placeholders. If a module throws while loading, the
placeholder stays and the error is logged.

```ts
// src/experience/types.ts (abridged)
interface Mode {
  readonly id: ExperienceMode;                 // 'face' | 'photo'
  readonly camera: 'none' | 'world' | 'face';  // face -> front camera, photo -> 'world' (back)
  readonly root?: THREE.Object3D;              // persistent content: re-added to EVERY engine scene; hidden when not active
  load?(): Promise<void>;                      // once, in the background
  onScene?(xr: XrScene): void;                 // each XR8.run hands a NEW scene/camera/renderer; root is already in it
  enter(from: ExperienceMode | null): void | Promise<void>;   // camera has video
  exit(to: ExperienceMode): void | Promise<void>;
  update(dt: number, now: number): void;       // every engine frame while active
  trigger?(name: string, source: 'api' | 'tap'): boolean;    // return true if you played something (emits `action`)
  onFace?(ev: FaceEvent): void;                // 'loading' | 'found' | 'updated' | 'lost' | 'other' + engine detail
  onTap?(x: number, y: number, ndc: THREE.Vector2): boolean;  // taps on the camera canvas
  reset?(): void;                              // menu "Start again"
  dispose?(): void;
}
interface ModeContext {
  assets: AssetLoader;      // gltf(url) with meshopt, texture(url)
  hud: HudApi;              // hint(), toast(), left / centre / above / layer slots, toolButton(), shutter(), flash(), sheet(), joystick()
  engine: EngineView;       // xr, canvas, tracking, settled(), warm(root), ray(ndc), screenshot(), busy()
  bear: BearCharacter | null;
  emit(event, payload): void;
  capture(blob: Blob): void;          // emits `photo` with the current mode
  mode: ExperienceMode; setMode(m): Promise<void>; reducedMotion: boolean; container: HTMLElement;
}
```
Rules that matter:
- **Shaders:** everything the mode will ever show goes under `root` at load, hidden. The engine compiles every root after each run starts (face: immediately; world: once SLAM settles). Call `ctx.engine.warm(subtree)` only for something you build later. Never toggle `transparent`, `side`, defines, the light count or the env map on a live material. Check `__cb.debug().enginePrograms` before and after your moments.
- **Lights:** a root carries its own lights. Only the active root is visible, so the light count is whatever your root has. When you borrow the bear (`ctx.bear.object`, 1 unit tall after the actor's normalisation; reparent it under your root on `enter`), give your root **the same two lights as the stages** (a hemisphere + a directional), or the bear's programs recompile on the first frame. The showcase and AR take the bear back automatically on `enter`.
- **Face events:** `detail.transform` (position, rotation quaternion, scale) and `detail.attachmentPoints.<name>.position` are in face space. The display is mirrored (`mirroredDisplay: true`), so flat planes on the face need `side: DoubleSide`. The placeholder's disc was invisible until it had this.
- **HUD:** the shutter goes in `hud.centre` (one thing only there), review overlays go in `hud.layer`, and contextual pills go in `hud.above`. Keep the bottom-right corner free. Remove your elements on `exit`.
- **Photo:** `await ctx.engine.screenshot()` returns an `HTMLImageElement` (camera + 3D as drawn). Compose on a 2D canvas, `toBlob`, then `ctx.capture(blob)`. `photo-placeholder.ts` is the minimal working example.
- `trigger()` reaches the active mode only. Return `false` for names you ignore.

## Simulator-tested vs untested

Simulator-tested: everything under "Results".

Untested:
- Any real phone. Real SLAM floor and scale (the fake IMU proves only the plumbing).
- iOS Safari: motion permission (asked in the AR tap), unmuted play of the theme after priming in the Start tap, and the 2-context hand-off (the showcase context is released before the engine starts).
- Real lighting, frame rate on mid-range Android, and how the house interior feels when you stand in it.
- Audio: theme sound plus the call's lip sync at the same time; `say()` / `setSpeechStream` (forwarded to the bear, not exercised here).
- Landscape AR. Permission-denied and camera-busy paths. They are coded and the fallback ran on synthetic errors only.

## Open issues / notes
- **Top-of-screen overlap with the app:** the app's "Chat Time / words found" pill sits exactly where the hint pill appears (under the switcher). The app should move its pill, or the HUD should get a `setReservedTop`. Needs agreeing with the app worker.
- The bear v0 has `setExpression` as a no-op, and maps sleep → 'sad' and shiver → 'angry' clips. Sleep and Cold read through the light mood, particles and the tint more than through the body. They will improve when the bear module gets real clips and expressions.
- The mini title in the top bar is small (76x40 cloud logo).
- The Magic orb reads pale against the pastel sky in 3D.
- On a phone the 360 backdrop is soft (2912 px source). It is the original art's resolution.
- When you come back to AR, the placement is restored relative to the phone's heading at the moment you left. If you have turned around, it appears in front of you, not in the room's original spot (by design: a new run has a new world origin).
- `trigger()` returns `false` before the experience has loaded.

## Findings for the immersive skill
1. **`compileAsync` gathers lights with `traverseVisible`.** A light inside a hidden group (the AR stage before Place) is skipped, so every program gets compiled for 0 lights and rebuilt when the stage appears. The test showed 28 programs, growing during moments, instead of 18 constant. Fix: during the synchronous part of the call, temporarily show the lights' hidden ancestors (`engine.warm`).
2. **Texture adoption needs the previous renderer after `XR8.stop`.** If you null `xr` when releasing the GPU, the next run has nothing to adopt from. Keep a `lastRenderer` (same canvas → same GL context). Adoption went from 0 to 19 textures per swap.
3. **Meshy props don't simplify with `gltf-transform optimize`** (UV seams). meshoptimizer `simplifyWithAttributes` with the 'Permissive' flag and UV weights (plus a sloppy fallback) reached 3k to 9k triangles cleanly. Shelf and mirror needed UV weight 4 and 9k triangles to avoid smearing.
4. **Shared dev server + simulator:** other workers' edits trigger Vite full reloads mid-run (`window.__cb` vanishes). Run tests against a second Vite with `hmr: false` and `watch.ignored: ['**/*']`.
5. **A Place button created enabled races the first frame.** Create it disabled and let the frame loop enable it.
6. **Equirect background orientation in r180:** the panorama's centre (u = 0.5) faces the default camera with `scene.backgroundRotation.y = +π/2`.
7. **Portrait 3D views:** a vertical FOV of 50 instead of 38 shows more of a 360 backdrop and halves its visible blur.
8. **Pillarboxed video on a TV prop:** crop with `texture.repeat/offset` (0.75 / 0.125 for 4:3 in 16:9) instead of re-encoding.
9. **Priming a video for later sound on iOS:** in the tap, call `play()` unmuted, then `pause()` at once. An `AbortError` still means it is allowed. A volume-0 trick blips, because iOS ignores `volume`.
