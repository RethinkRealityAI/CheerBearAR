# wow-2 handoff: physics and play in the 3D showcase and AR (round 2)

**Nothing here has been tested on a real phone.** Everything was checked in headless Chromium (swiftshader) at
390x844: the 3D showcase directly, AR with the fake floor camera and fake IMU.

## What Dapo gets

| Feature | 3D showcase | AR |
|---|---|---|
| **Heart toss** (swipe up) | Soft 3D hearts fly from low in your view in a lob. She watches each one, turns to it, shuffles a step to get under it and catches it in her arms (the `present` clip, a heart burst, a squash-and-stretch). Misses bounce on the cloud floor, roll, settle flat and shrink away. "N in a row" counter (pink; purple from 5). Every 5 in a row: a ring of bouncing stars. | The same on your real floor (the placed stage's plane). Hearts bounce off the house walls. Inside the grown house too. |
| **Poke** (tap her) | Always a squash-and-stretch jiggle; plus Wave / Cheer / Sparkle when she's free (before, a tap during a moment did nothing). | Same. |
| **Hug** (long press on her, 0.55 s) | A squeeze, a ring of hearts rising around her, a burst of hearts, `present`. Asleep: wakes her. | Same. |
| **Care Bear Stare** (new action `Stare`) | She gathers it up (tummy glitter, a white ring), then a six-stripe flat rainbow beam rolls out of her tummy, dips to the cloud and runs towards you, off to one side; stars bounce out where it lands; it rolls up and she cheers. 5.6 s. | The beam runs along your floor towards you and stops about 45 cm in front of the phone; stars bounce at your feet. |
| **Party** | 7 balloons (4 with reduced motion) rise around her and float, bob and bump each other and her; **tap one to pop it** (flat dots + a ring). At the end they float up and away. | Same. |
| **Rainbow** | 10 solid 3D stars bounce out where the rainbow lands, more drip off its arc while it stands; the sparkle burst bounces on the floor. | Same. |
| **Cold** | Snowflakes now land on the floor and on her head and stay ~1.6 s before melting away. | Same. |
| **Sparkle / Magic** | The final bursts rain down and bounce on the floor; Magic's orb also scatters 6 bouncing stars. | Same. |
| **Hints** | After "Drag to look around": "Swipe up to throw hearts" (computer: "Press Space to throw hearts"), once per visit, hidden at the first throw. | After "Walk her to her house": "Swipe up to throw hearts", once. |
| **Computer** | Space throws a heart; a fast mouse flick up throws too. | (QR sheet as before) |

Moment lengths and call-trigger timings are unchanged. `trigger()` return values, the queue of 2, the cooldown, Sleep
as a state, Move keeping state and the house walk-in are untouched (Move keeps hearts and the throw count; the toys
are cleared on leaving a mode and on Start again).

## For the orchestrator

- **New action `Stare`.** `ExperienceApi.actions` now lists 13 names: the 11 core actions, `Cheer`, `Stare`.
  `trigger()` accepts `Stare`, `care bear stare`, `Care Bear Stare`, `carebearstare`, `bear stare` (case-insensitive).
  Please add **"care bear stare"** (and maybe "stare") to the voice keywords so it fires from the call. It is not in
  `CORE_ACTIONS` (src/shared/contracts.ts), so the admin's keyword list does not show it unless that list is extended
  by its owner. Selfie and Photo return `false` for `Stare` (their maps don't know it); the capture owner could map it
  to `present` / `cheer`.
- No change outside my folders. No new dependency (a ~300-line custom solver instead of cannon-es).

## Files

```
src/experience/physics/world.ts        the solver: pooled spheres, fixed 1/120 s step (max 6 substeps/frame), floor plane,
                                       static spheres/boxes, sphere-sphere bumps, one catch sensor, sleeping, impact squash
src/experience/physics/playground.ts   per stage: hearts / stars / balloons as 3 instanced meshes + one line draw for the
                                       strings; spawning, recycling (hard caps 14 / 36 / 9), despawn, tap-to-pop, visuals
src/experience/physics/toss.ts         the heart-toss game (aim assist, catch, side-steps, combo counter) + hugBear()
src/experience/physics/toss.css        the "in a row" counter (theme tokens, flat, pointer-events none)
src/experience/scene/stare.ts          the Care Bear Stare beam (one dynamic ribbon mesh, 6 flat stripes)
src/experience/scene/stage.ts          + play (Playground), beam, headPerch; toys' gravity per stage; house wall collider;
                                       per-frame allocations removed (Matrix4 / clone / new Vector3 in update)
src/experience/scene/actor.ts          + body group (squash-and-stretch spring, hop), jiggle(), lookOverride
src/experience/scene/fx.ts             particles: floor bounce / land-and-rest / perch (snow on her head); no per-particle
                                       closure or Vector3 in emit
src/experience/scene/moments.ts        + Stare (+ aliases), balloons in Party, stars in Rainbow, landing snow in Cold,
                                       bouncing bursts in Sparkle / Magic
src/experience/modes/shared.ts         bindGestures: onFlick (fast upward swipe -> power, lean) and onLongPress
src/experience/modes/showcase/index.ts toss, poke, hug, balloon taps, Space key, the throw hint, WIDE for Stare
src/experience/modes/ar/index.ts       toss, poke, hug, balloon taps, the throw hint; constrain(p, door) so side-steps never
                                       walk her through the door
docs/evidence/wow-2/                   screenshots, the heart-toss film + strip, perf logs, sim scripts (sim/)
```

## How it works (short)

- **Units:** stage units (she is 1 tall). Gravity for toys is a soft 6.4 m/s², converted per stage: AR divides by the
  stage scale (0.5 by default, so 1 unit = 0.5 m), the showcase treats her as 0.9 m.
- **Throw:** `power` 0..1 (70 % swipe length over 40 % of the screen height, 30 % release speed) maps to a landing
  distance of 0.45 to 1.55 times her distance; the lean (swipe sideways) turns it up to ±0.48 rad. Aim assist: within
  0.3 rad of her it snaps onto her (partly up to 0.6 rad), and within ±20 % of her distance it counts as "at her". The
  lob solves for her chest height at that distance (elevation 0.62 rad, raised when needed). 0.2 s between throws.
- **Catch:** a sensor sphere (r 0.36) 0.15 in front of her, at chest height, moving up/down to meet a heart that is
  close (0.35 to 0.95). Asleep: no sensor; the heart bonks her body (two static spheres) and wakes her. A heart that
  touched anything first is a miss (resets the combo; she looks surprised).
- **Side-steps:** for the heart that will reach her first, if it will pass 0.1 to 0.9 off to the side within 0.75 s,
  she shuffles towards it (2.1 units/s, at most 0.7 per throw, little hops), only when she is free (not walking, not in
  a moment, not asleep). AR keeps her out of the walls and away from the door trigger.
- **Gestures:** a drag whose first 8 px go mostly up faster than 0.28 px/ms is a flick (no orbit); slower drags still
  orbit the 3D camera. Long press = 0.55 s still. In AR the experience's tap binding is untouched; the mode adds flick
  and long press on the same canvas.

## Frame rate and shaders (pitfall 14)

- Everything new is built at load under the stage root: the engine's `warm` (AR) and the showcase's `compileAsync`
  compile it with the rest. Instanced meshes get `instanceColor` before the first compile. Nothing toggles material
  flags at runtime.
- Showcase programs: **21 after warm-up (17 before this round + hearts, stars, balloons, strings, beam) and still 21
  after every toss, poke, hug, Stare, Party + pop, Rainbow, Cold and Magic** (normal and reduced motion).
- AR (engine) programs: 24 after placing, still 24 after every new interaction (probe in `sim/ar.cjs`).
- No allocation per frame in the solver, the toys, the toss game or the beam (scratch vectors, preallocated buffers,
  instance compaction). Moments still allocate a few vectors per emit (round-1 style), not per frame.
- Toys' CPU: 0.097 ms per frame with every pool full (59 bodies), timed in the page.

## Run and test

```bash
API_PORT=6194 npx tsx scripts/dev-api.ts &
API_PROXY=http://127.0.0.1:6194 SIM_PORT=5194 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
BASE=http://localhost:5194 OUT=<dir> node docs/evidence/wow-2/sim/showcase.cjs [reduced]   # all 3D interactions + programs
FLOOR=<scratch>/xr/floor.y4m BASE=... OUT=<dir> node docs/evidence/wow-2/sim/ar.cjs          # AR: place, toss, ..., program diff
BASE=... node docs/evidence/wow-2/sim/perf.cjs <label>                                       # frame times, programs, toys CPU
BASE=... OUT=<dir> node docs/evidence/wow-2/sim/capture-toss.cjs                             # the toss film (stepped 1/30 s)
```
Test hooks: `__cb.internals().showcase.throwHeart(power, side)`, `.modes.get('ar').throwHeart(...)`,
`.stages.<showcase|ar>.play` (`liveCount`, `count('balloon')`, `pool('heart')`), `.showcase.toss` (`thrown`, `caught`,
`combo`, `best`). `sim/lib.cjs` dispatches synthetic flicks / presses (real mouse moves arrive too slowly at 5 fps to
read as a flick).

## Results (simulator, 2026-11-19)

Machine note: other workers' simulators ran at the same time (load average 12 to 20 on 4 cores), so swiftshader
ran the showcase at 3 to 5 fps and AR at 1 to 2 fps. Frame times below are dominated by that load, not by this work.

- **3D showcase, 390x844** (`run-3d-desktop.log`, `phone-3d-*.jpg`, `contact-3d.jpg`): the throw hint shows after
  the look-around hint; 5 real flick gestures -> 5 thrown, 5 caught, "5 in a row" (purple) and the star ring; a weak
  throw lands short, bounces, rolls and settles flat, and resets the counter; a tap on her plays a reaction (`action`
  `Cheer`, source `tap`) with the jiggle; a long press gives the hug hearts; `trigger('care bear stare')` -> `true`
  and the beam plays; Party shows 7 balloons, a tap on one pops it (7 -> 6); Rainbow stars, Cold snow, Magic burst all
  play. `actions` lists 13 names ending with `Cheer`, `Stare`. **Programs: 21 after warm-up, 21 at every step.**
  Console: no errors.
- **Reduced motion** (`phone-rm-3d-*.jpg`): same flow; 4 balloons, half the stars, softer jiggles; programs 21; no
  errors.
- **Desktop 1440x900** (`desktop-*.jpg`): hint "Press Space to throw hearts"; 4 x Space -> 4 thrown, 3 caught;
  programs 21; no errors.
- **AR, fake floor camera + fake IMU** (`run-ar.log`, `phone-ar-*.jpg`, `contact-ar.jpg`): place, then the throw hint;
  flicks throw hearts onto the floor plane and she catches them ("2 in a row", later "5 in a row"); poke (`Sparkle`
  tap action) and hug; the Stare beam runs along the floor towards the camera and stars bounce at the bottom of the
  view; Party balloons and a pop (7 -> 6); Rainbow, Cold; Move + Place keeps the throw count. **Engine programs: 24
  after placing and 24 after every step (no new program from any new interaction).** Engine errors: none. Console:
  one `[reqfail] /media/theme.mp4 net::ERR_ABORTED` when Party stops the theme video (an aborted range request,
  not from this work).
  - Honest caveats: at 1 to 2 fps every frame counts as a stall (> 250 ms), so world-health never reported "settled"
    on this loaded machine. The run sets `FORCE_SETTLE=1`, which marks world-health settled once tracking is NORMAL
    (test-only, in the script; the engine then runs its normal compile and Place). SLAM also drifted at that frame
    rate; the script re-placed her with Move + Place 3 times when she had wandered out of view (what a user would
    do). Physics ran in slow motion there (the solver caps at 6 substeps per frame, by design).
- **Heart-toss film** (`heart-toss-3d.mp4`, 9 s, 340 KB; `heart-toss-3d-strip.jpg`): the showcase stepped at a fixed
  1/30 s and filmed frame by frame (the headless GPU is too slow for real time): 7 throws, 6 caught, one sideways
  miss that bounces and rolls.
- **Frame time / programs before and after** (`perf-ab.log`, same machine, back to back, round-1 HEAD vs this tree,
  load ~16): idle 212 vs 332 ms mean, Party 440 vs 504, Rainbow 367 vs 376, Cold 257 vs 239, Stare (idle in round 1)
  307 vs 230, toss x8 303 ms. Programs **17 -> 21, flat throughout both runs**. These swiftshader numbers swing by
  +-50 % with machine load (the HEAD tree also lacks the round-2 HUD restyle), so they show no regression only
  within that noise. The direct measure: **the toys' whole update (physics + instance upload) costs 0.097 ms per
  frame with every pool full (59 bodies)**, timed in the page (`toys-cpu`).

## Simulator-tested vs untested

Simulator-tested: everything under Results. Untested: any real phone; how the flick feels with a real thumb (power
and assist are tuned on synthetic swipes and maths, Dapo should try it); real SLAM floor height for the bounces; frame
rate on a mid-range Android with balloons + hearts + the beam; iOS long press (should not trigger the callout on a
canvas, but not checked); whether the counter collides with the app's game chip (it sits 120 px below the top bar,
under the hint).

## Open issues / ideas not done

- The house roof is not a collider (only the walls, up to 62 % of the house height): a heart thrown over the house
  passes through the roof. Snow does not pile on the roof (only the floor and her head).
- Magic's "flick the orbiting sparkles" and "flowers sprout where hearts land" were left out (quality over count).
- The bear has no real catch / hug clip; `present` reads as arms out. A short "catch" clip from bear-lipsync would
  make catches land better.
- The 3D Stare lands to the viewer's right of her; in a very wide landscape view it reads as sideways.

## Findings for the immersive skill

1. **Instanced meshes: create `instanceColor` before the first compile.** `setColorAt` on a mesh compiled without it
   flips `USE_INSTANCING_COLOR` and recompiles on the first spawn. Fill every slot once at construction, keep
   `count = 0` (and `visible = false` while empty).
2. **Flick vs orbit on one canvas:** classify a drag on its first 8 px: mostly upward and faster than ~0.28 px/ms is
   a throw (no orbit); anything slower orbits. Power = 70 % length (over 40 % of the screen height) + 30 % release
   speed; for kids, snap the aim onto the character inside ~0.3 rad and count +-20 % distance as "at her".
3. **A catch sensor in front of the character that follows the incoming object's height** (clamped to the arms'
   reach) plus a side-step (budgeted per throw) reads as "she catches it"; a sensor at a fixed chest point made
   lobs bounce off her head.
4. **A tiny custom sphere solver is enough for toys** (floor plane, static spheres/boxes, sphere-sphere, sleep, a
   sensor): ~300 lines, 0.1 ms per frame for 59 bodies, no dependency. Cap substeps per frame (slow motion under
   load instead of a spiral of death) and pool every body.
5. **Particles that land:** give floor particles their own fade (last 0.5 s of life, from the landing) instead of the
   usual last-35 % fade, and lift point sprites by ~0.3 x size so they sit on the floor; a "perch" sphere lets snow
   land on a head.
6. **Simulator under load:** when other simulators run, swiftshader drops AR to 1 to 2 fps, every frame is a
   world-health stall and Place never enables; SLAM also drifts. Run AR sims on a quiet machine, or (test only) mark
   world-health settled after tracking is NORMAL and re-place with Move + Place when the stage leaves the view.
7. **Simulator gestures:** Playwright mouse moves arrive at the page's frame rate (5 fps), so a flick reads as a slow
   drag. Dispatch synthetic PointerEvents in one task (and a tap's down + up in one task, or a busy main thread
   stretches it past the tap time limit).
8. **Filming a WebGL scene in a slow headless browser:** stop the render loop, then step it with a fixed dt (set the
   loop's "last time" back 1/30 s before each call) and screenshot every frame; ffmpeg makes a smooth 30 fps MP4.
