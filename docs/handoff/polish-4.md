# polish-4: Heart Hoops clarity, the Classic selfie countdown, a polish pass

**Tested in the simulator only (headless Chromium with fake cameras). Nothing was tried on a real phone.** The swipe
feel, haptics, iOS audio (the ticks and shutter), AR tracking and frame rate are all still untested on a device.

## 1. Heart Hoops: you can see what you throw and how many are left

Dapo said: "show the hearts so users know what they're flicking and how many they have… it's not really clear they're
meant to be flicking".

- **A heart in your hand.** A real 3D heart floats low in the middle of the view, about 60 px across, at 70 % of the
  screen height or just above the rack. It sways a little, pops in after each throw (with a slight overshoot) and leans
  and lifts with your finger while you drag. The throw leaves from that exact spot. The 10th heart is gold. It reuses
  the kit's instanced hearts (the toys' existing program), so no new shaders.
  `src/experience/play/hand.ts` (new).
- **Ammo rack.** Ten hearts sit in a glass pill at the bottom. The 10th is gold and marked "x2". Each heart greys out
  as you throw it (with a little "out" animation), and the aria-label says "N hearts left to throw". The old dots on
  the score board are gone. `ui.ts`, `play.css`.
- **Swipe coach.** A finger slides up from the heart along a marching dotted arc. It repeats until your first throw
  and comes back after 9 s idle. The words go in the HUD hint pill: "Swipe up to throw!" on phones, "Hold Space, then
  let go" on a computer. On a computer a "Space" key shows instead of the finger.
- **Slow swipes throw too.** The shared gesture helper only reports fast flicks (0.28 px/ms). A slow, deliberate drag
  up from the scene now throws as well, since children drag slowly. These are passive bubble listeners on the
  experience root, with no double throw. In 3D, Heart Hoops now stops a slow drag from tilting the camera
  (a one-line gate in showcase, listed below).
- **Aim arc (Off / Short / Full; Short is the default).** DOM dots at projected points (no shader) while you drag or
  hold Space.
  - Short shows the second half of the flight and ends on a target ring at the ring's distance.
  - Full runs to the floor.
  - The setting is on the pause card ("Aim guide") and saved in `localStorage` `cbx.play.aim`.
- **Feedback.**
  - "+N Swish!" / "+N" pops, plus a ring flash: gold on a swish or the last heart, white otherwise. The flash uses the
    band's emissive uniform, so nothing recompiles.
  - "So close!" on a near miss or a rim touch, otherwise "Miss".
  - A "Last heart x2" tag over the gold heart while it is in your hand, with a sparkle.
  - A short `navigator.vibrate(8)` on each throw.
- **Ring placement.** The ring always fits the screen (the sideways offset is bounded by the measured horizontal FOV).
  The old ±13 % put it half off a portrait phone. She stands beside it:
  - Inner side on a narrow screen.
  - Outside it on a wide one, so the heart in your hand stays clear.
- **AR: the held heart no longer trails the view.** I measured in the simulator that the engine moves the camera
  *after* the modes' per-frame update: the pose a frame renders with is the one the next update sees. So anything
  placed relative to the camera in update lags one frame. The held heart and the aim dots are therefore placed again
  in the scene's `onBeforeRender`, using the camera that frame actually renders with. The hook is chained (an earlier
  handler still runs first) and removed on dispose. The placement solves a 2x2 screen map, so a rolled phone is
  handled too. Probe result: the heart lands at exactly (195, 591) at render time, even with the camera moving
  0.1–0.25 m between update and render.
- **Heart Run** had the same "what do I do?" gap. After 2.5 s standing still, a one-time joystick nudge appears: a
  pulsing ring on the stick plus a hint, "Drag the joystick to run" (computer: "Arrow keys or the joystick"). It
  goes away once she moves. `run.ts`.

## 2. Selfie Classic: "Smile!" then 3, 2, 1

**Why the countdown never showed.** capture-2 assumed the wink clip "has its own countdown" and auto-shot the photo
350 ms after the video's `ended`. The clip (`wink.mp4`, 5.5 s) has no countdown in it, so you got a photo with no
warning.

**Now, when her end pose finishes:**
1. She holds that last frame. An ended video keeps showing it, so she is frozen and in the photo.
2. A 250 ms beat, then a big pink "Smile!" pill with a two-note chime (1.1 s).
3. A big 3, 2, 1 with a soft tick each ("1" is a touch higher).
4. The flash, a WebAudio camera shutter (two noise clicks over a low thump), then the photo.

Details:
- The shutter during the count shoots at once ("Take the photo now").
- Switching to the 3D bear cancels the count cleanly.
- The 3D bear's own 5 s countdown now ticks too and plays the shutter.
- **Code:**
  - `capture/countdown.ts` gained an optional lead word and sounds; it stays backwards compatible.
  - `capture/sounds.ts` (new) uses the app's one AudioContext and no audio files. It stays silent if the context is
    not running and never throws.
  - `modes/face/index.ts` `onClipEnd`.

## 3. Polish pass (390 x 844 unless noted)

1. **Hoops ring off-screen in portrait.** Fixed (FOV-bounded placement, above).
2. **Desktop: she stood behind the heart in your hand.** She now stands outside the ring when there is room.
3. **The coach's words collided with the app's talk bubble.** "Hold to talk" sits just above the bottom right. The
   words moved into the HUD hint pill near the top. tour390 shows no overlaps.
4. **3D Hoops: a slow drag tilted the camera instead of throwing.** Fixed (the showcase gate plus slow-swipe throws).
5. **Selfie Classic: the "3D bear | Classic" picker sat over her nose and mouth during the countdown.** It now fades
   out and goes `inert` for the count only, and is back when live (`.cbc-seg.cbc-tuck`). Reduced motion: fade only.

I also checked these and left them alone: the Games tab, Photo with the front camera, the Selfie review sheet and the
Heart Run HUD.

## Simulator results (all 0 console errors)

| Run | Result |
|---|---|
| Hoops 3D phone 390x844 | Programs 38 → 38. Heart at (195, 591) r 30; rack [50, 704, 341, 744]; 13 aim dots; slow swipe throws; "+3 Swish!"; results card; aim guide saved; no leftover DOM. Run nudge shows, then goes away after moving. |
| Hoops desktop 1440x900 | Programs 38 → 38. Space wind-up draws the arc; she stands outside the ring; same checks pass. |
| Hoops AR (fake floor + IMU, FORCE_SETTLE test hook) | Programs 39 → 39. Held heart at the centre target at render time; full game to results. |
| Classic (autoplay) | Phases Smile → 3 → 2 → 1 → flash all seen. Video ended and paused at 5.5 s (frozen on the wink). Photo bear region 49 % pink, 0 key green. 6 oscillator + 2 noise sounds during count + shot. Shutter mid-count shoots; replay works; picker tucked + inert during the count and back after; switching to 3D mid-count cancels. Programs 41 → 41. |
| Classic noautoplay ("Tap to play") | Tap to play → clip → Smile/3/2/1/flash → photo. |
| tour390 (full app route `/`, with talk button) | No overlaps between the rack, hint pill, talk button, joystick, nudge pill, shutter and picker. |

The yellow and purple dots at the bottom right of the selfie photos are part of the test face video (a phone
recording). They are not app UI.

## How to run

Start an API and a sim Vite (live reload off, see `common.md`), then from `docs/evidence/polish-4/sim/`:

```
BASE=http://localhost:5213 OUT=<dir> node hoops.cjs                                  # 3D phone
BASE=… OUT=… W=1440 H=900 DESKTOP=1 node hoops.cjs                                   # desktop
BASE=… OUT=… AR=1 FLOOR=<floor.y4m> FORCE_SETTLE=1 node hoops.cjs                    # AR (slow, ~6 min)
BASE=… OUT=… node classic.cjs <face.webm> [noautoplay]
BASE=… OUT=… node tour.cjs <face.webm>                                               # full app at 390
```

Evidence: `docs/evidence/polish-4/*.jpg` (phone-, desk-, ar-, classic-, classic-na-, tour390-) and `logs/`.

## Changes outside my folders (minimal, additive)

- `src/experience/physics/playground.ts`: `throwHeart(from, vel, hex?)` takes an optional colour, so the gold
  last heart flies gold. The default is unchanged (a random heart colour).
- `src/experience/modes/showcase/index.ts` `onDrag`: `if (!this.active || this.game?.flicks) return;`. While Heart
  Hoops runs, a drag does not tilt the camera.

## Open issues / next

- **Real-phone check:**
  - Swipe feel and the slow-swipe threshold (any upward drag of 40 px+ from the canvas throws).
  - Haptics (Android only; iOS ignores `vibrate`).
  - The tick and shutter volume on iOS (the context must already be unlocked; it is, by the taps that get you there).
  - AR: the held heart at real frame rates.
- In AR, when the camera looks steeply down, the ring can sit low, near the rack.
- She walks across the view between ring moves.
- The app talk button's bubbles crowd the bottom right on any bottom-centre UI at 390 px. A shared "safe area" for
  them would help.
- With the picker inert during the ~4 s Classic count, the only way out is the shutter (shoot now) or switching mode.

## Findings for the immersive skill

- **Held object in the camera's hand:**
  - Draw it with an existing instanced mesh, so no new program.
  - Place it by solving a 2x2 screen-space map (project c, c+r·e, c+u·e) on a plane a fixed depth in front of the
    camera. You get an exact pixel target and a size in px, and roll is handled.
- **8th Wall + three: camera-locked things lag a frame if placed in the update hook.** The pose a frame renders with
  arrives after the app's `onUpdate`. Re-place them in a chained `scene.onBeforeRender(renderer, scene, camera)`.
  Instance matrices written there still upload, because `projectObject` runs after it.
- **Kids drag slowly.** Accept slow upward drags as throws as well as fast flicks, with passive listeners and a
  "last throw" guard against doubles.
- **Aim arcs from a phone held low look steep.** Show the second half of the flight and end on a target ring at the
  target's distance, not from the hand.
- **Coach copy belongs in the hint pill** (white on glass, ≤5 words). App overlays such as a talk button's bubbles own
  the bottom right.
- **A video that ended keeps its last frame on screen.** Use that as the "frozen pose" for a countdown, with no
  seeking or extra frames.
- **WebAudio shutter and ticks:** short enveloped oscillators plus a band-passed noise burst on the shared context,
  with no audio files. In Playwright, count them by patching `OscillatorNode.prototype.start` and
  `AudioBufferSourceNode.prototype.start` separately.
