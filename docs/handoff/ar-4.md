# ar-4: AR house tracking budget, Move as a full reset, house hidden during games

Worker ar-4. Answers Dapo's phone test: (a) hide the house while a game runs, (b) the house "kept on shrinking … and
drifted away" while he walked through it, (c) Move must go back to the default size and pinch must work every time.

**Nothing here was tested on a real phone.** Everything was checked in the Playwright simulator (SwiftShader, about
3 to 4 fps, fake floor camera and fake IMU). The simulator cannot show SLAM scale drift, real GPU fill cost or how
`XrController.recenter()` feels on a real phone. Those need Dapo's next phone test.

## What was wrong (evidence)

Measured with `docs/evidence/ar-4/sim/probe.cjs` (draw calls, triangles, compiles, links and texture uploads per
frame, by phase). Full data: `docs/evidence/ar-4/probe-before.json`, `probe-after.json`.

1. **Engine start order.** Before: the engine compiled the scene the first time SLAM reported NORMAL. In the sim that
   was at 2.1 s: 76 shader compiles and 38 links in one frame, a 1.4 s stall. Then 22 texture uploads trickled in, one or
   two per frame, until about 9.3 s, while the user was looking for the floor. This is the moment SLAM is building
   its map and scale. Long frames then make the visual-inertial scale estimate worse, which matches what Dapo saw: the
   house shrinking and drifting.
2. **Settled gate only once.** `settled()` latched after the first calm spell and was never re-armed. Move kept the
   old SLAM map, including any drifted scale, and Place was enabled at once.
3. **Door opened on a timer**, not when tracking was calm. So the heaviest view (looking through the door into the
   lit room) could arrive during a LIMITED spell.
4. **Inside the room every material used `discard`** (the DoorClip plane cut). On phone GPUs, `discard` turns off
   early depth rejection and hidden-surface removal, so every layer of the room is shaded. That is the most fill
   cost, at the moment you are standing inside.
5. **Move did not reset the scale.** The pinch scale persisted, and the pinch only scaled the bear, not the house.
   A stale pointer (a finger lifted outside the canvas, or a lost pointer capture) could leave the pinch dead until
   reload.
6. **Games and the house** both used the same ground. The house stayed on screen and kept its collision box.

Steady-state cost was **not** the problem. While walking there were 0 compiles and 0 uploads, apart from the TV
video while it is in view and one small per-frame data upload (probably the bone texture). JS update took 0.5 ms
(p50) and three's render submit took 1 to 2 ms. Inventory: house 44 meshes, 98k triangles (room 67k, exterior 29k).
The biggest items are the body (14k), the front (14k), the room glow (10k), the shelf (9k), the mirror (9k), the fairy
lights (6.4k) and the tub (5k). Draw calls: 45 placed, 49 outside, 40 at the door, 20 inside. Bobo Portal draws more
meshes, using mostly unlit materials, so draw calls are not the bottleneck.

`world-health.ts` vs medialife `public/evade/xr/world-health.js`: same behaviour (DPR steps, settle rules, stall
log). The JS version also posts to kc-diag, which this repo does not have.

## What changed

| | Before | After |
|---|---|---|
| When shaders compile | first NORMAL frame (s = 2.1), 76 compiles / 38 links, 1.4 s stall | `onStart`, s = 0, before SLAM sees a frame: 94 compiles / 47 links (includes the engine's own 12) |
| When textures upload | 22 trickled through 2.1 to 9.3 s, during tracking | all at s = 0 (22 alloc, 15 image, 6 canvas). Later only the TV video and one late canvas upload |
| Programs | 36 | 39 (3 plain twins, all made at load), flat after that |
| Place gate | `settled()` once per run | `settled()`, re-armed by every Move (`wh.regate()`) |
| Door opens | timer after Place | when `engine.calm()` and the house is present; retried every 0.25 s; at most about 10 s of experience time |
| Inside materials | DoorClip `discard` on everything | plain twin materials (no discard) while you are inside |
| TV, shelf, tub and mirror | MeshStandardMaterial | MeshLambertMaterial, plus a small emissive lift |
| Move | kept the scale, SLAM map and in-house state | full reset: exit the house, door shut, default scale, house life size, SLAM `recenter()`, fresh settle gate |
| Pinch | bear only; could die on a stale pointer | sizes the bear and the house (0.6x to 1.6x, life size at the default); stale pointers cleared |
| Games | house stays, with collision | house pops away (0.3 s), no bounds, no mailbox, no toy wall; returns when the game ends |

Steady state after the change is about the same, as expected: placed 44 draws / 91k tris, outside 49 / 101k, door 40
/ 89k, walk-in 38 / 76k, inside 20 / 46k, turning inside 18 / 42k, walk-out 15 / 43k. (The after-inventory counts
85 house meshes, because the hidden twin holder shares the room geometry. It does not draw unless you are inside, and
then it replaces the clipped meshes.)

### Files (mine)

- `src/experience/core/engine.ts`
  - `prepare()` runs at the end of `setup()` (onStart), and compiles and uploads everything there: in a burst, then
    2 per frame if something arrives later.
  - New `uploadTextures()`, `calm()`, `recenter()` (calls `XR8.XrController.recenter()` unless `?norecenter`, then
    re-arms settle), `note()` and `diagLine`.
- `src/experience/core/world-health.ts`
  - `regate()` and `note()` (breadcrumbs, capped at 80).
  - `snapshot()` includes `notes` and `regates`.
  - The `?diag` overlay shows stalls, `draw / tris / prog / tex`, AR state and the last 5 notes.
- `src/experience/scene/house/clip.ts`
  - Plain twins: a lazily cloned material without the clip for each clipped material.
  - `twinHolder()` builds hidden meshes that share the geometry, with InstancedMesh support.
- `src/experience/scene/house/index.ts`
  - `setAway()` / `away` / `present`, the pop animation (respects reduced motion) and `sizeMul`.
  - `wearPlain()` when inside.
  - `bounds()` is null while away.
  - Door-leaf fix: the leaf follows `open` even after an instant shut.
- `src/experience/scene/house/room.ts`: props use Lambert.
- `src/experience/modes/ar/house-walk.ts`
  - The door opens on `calm()`, with a cap.
  - `collapse()` also handles a pending hop, and her standing behind the front wall.
  - `evict()` after a game.
  - Notes.
  - No per-frame allocations in `camFlat`.
- `src/experience/modes/ar/index.ts`: `move()` is a full reset, the pinch also sizes the house, `setGame()` hides
  the house, plus `diagLine` and test hooks (`pinchScale`, `DEFAULT_SCALE`, `moves`).

### Small changes outside my folders

- `src/experience/types.ts`: optional `calm?`, `recenter?`, `note?` and `diagLine?` on `EngineView` (additive).
- `src/experience/modes/showcase/index.ts`: one line in `setGame`: `this.stage.houseSet.setAway(!!g);` (the 3D game
  host hook).
- `src/experience/modes/shared.ts`, `bindGestures`:
  - A new primary pointer clears stale ones.
  - `cancel` resets the pinch distance.
  - A `lostpointercapture` handler is added and removed alongside the others.

  Without this the pinch could stay dead.

## Room size

The room was not shrunk. Reasons:

- Dapo liked the real scale.
- SLAM tracks the camera feed, not the rendered room, so a smaller room does not track better.
- The levers that matter are no stalls during map-building, a fresh recenter and settle on Move, and the user's own
  pinch, which can now take the house down to 0.6x.

Triangles were not cut either. The vertex load is modest, and the sim cannot measure fill. I made two fragment cuts
instead: no `discard` inside, and Lambert props.

## Verification (simulator only)

Scripts are in `docs/evidence/ar-4/sim/`. Run your own Vite on your own port first. I used `SIM_PORT=5211`, with
`API_PROXY=http://127.0.0.1:6211` and `npx vite --config scripts/vite.sim.config.mjs`. Then:

```
BASE=http://localhost:5211 OUT=<dir> node docs/evidence/ar-4/sim/probe.cjs <scratch>/xr/floor.y4m after   # numbers per phase
BASE=http://localhost:5211 OUT=<dir> node docs/evidence/ar-4/sim/cycles.cjs <scratch>/xr/floor.y4m 10     # Move / pinch x10
BASE=http://localhost:5211 OUT=<dir> node docs/evidence/ar-4/sim/games.cjs <scratch>/xr/floor.y4m         # house away in games
BASE=http://localhost:5211 OUT=<dir> node docs/evidence/ar-4/sim/diag.cjs <scratch>/xr/floor.y4m          # ?diag overlay shot
```

`instr.js` is injected by `probe.cjs`. It wraps `renderer.render`, `initTexture`, `compile` and the GL compile, link
and texImage calls, so that each frame is counted by phase.

- **Move / pinch, 10 cycles: ALL PASS** (`cycles.json`, `cycles-run.txt`).
  - The pinch uses real two-finger CDP touch events on `CANVAS.cbx-xr`, with factors 0.6x to 1.8x. It worked every
    time, and the house followed it.
  - Each cycle goes inside (walking through the door on even cycles, Step inside on odd ones), then presses Move.
  - After every Move: scale 0.5 (the default), house life size, door open 0, leaf rotation 0, bear on the doorstep
    (z ≈ 1), not inside, no glide, not posed, plain off, settle latch off, Place disabled, the regate count goes up,
    the theme is off, programs 39, and the camera x/z goes to about 0 after the recenter.
- **Games: PASS.**
  - 3D: start Heart Run during the House moment, and the house is hidden.
  - AR: place, Step inside, then start Heart Run. You exit first, then the house goes away: root hidden, no bounds,
    mailbox hidden, toy wall off. Pickups spread over the whole field.
  - On stop, the house pops back with bounds, mailbox and toy wall, and the bear is moved out of its walls. Hoops
    behaves the same.
  - Programs 39 → 39.
- **House-3 showcase regression:** 38 programs flat through the 3D House tour. The twins look identical, and the
  jukebox still animates.
- **Screenshots, looked at** (`docs/evidence/ar-4/shots/`):
  - `before-*` / `after-*`: placed, outside, door, inside;
  - `cycle-01-*`;
  - `games-3d-*`, `games-ar-01..05`;
  - `diag-overlay.jpg`;
  - `cmp1..4` contact sheets.

  The Lambert props and the plain twins look almost the same as before.

## Open issues and honest limits

- **SLAM drift cannot be reproduced in the sim.** The fake camera still produces random LIMITED spells (for example
  5.7 to 7.9 s and 13.1 to 14.2 s) after the fix, so the sim cannot prove the drift is gone. What it does prove: no
  compile or upload stalls during tracking, and Move now recentres and re-gates. The phone test should check:
  - walk in and out three times, and watch the house scale;
  - pinch, then Move: is the house life size again?
  - with `?diag`, the breadcrumbs show `recenter` / `place` / `door opens`, plus the tracking state.
- **Recenter on a real phone is untested.** If it misbehaves, `?norecenter` turns it off while keeping the re-gate.
- **Door wait cap.** Sim frames are slower than 250 ms, so every frame counts as a stall, and `calm()` is rarely true.
  The door then opens on the cap of about 10 s of experience time. Because the sim clamps dt to 0.1 s, that was up to
  24 s of real time in cycle 10. On a phone (dt ≈ real time) the cap is about 10 s.
- **One late canvas upload during placing**, probably from a mode root that loads in the background. It is small, but
  it is not covered by `prepare()`.
- **The `?diag` overlay overlaps the hint pill** at the top left. It only shows with `?diag`.
- The AR game field was not enlarged for the space the house leaves. The pickups already spread over it.
- **Process mistake:** at about 18:14 UTC, `pkill -f "vite --config scripts/vite.sim.config.mjs"` also killed
  polish-4's (5213) and voice-4's (5212) sim Vite servers. I restarted both straight away with their own settings
  (`API_PROXY` 6213 / 6212, `SIM_PORT` 5213 / 5212, and their own `SIM_CACHE`), and both answered 200. After that I
  only killed by PID, after checking `SIM_PORT=5211` in the process environment.

## Findings for the immersive skill

1. **Compile and upload in `onStart`, not at the first NORMAL frame.** `renderer.compile()` plus `initTexture` on
   every texture before SLAM sees a frame. A 1 s or longer stall while the map is being built is the worst moment for
   the scale estimate.
2. **`discard` defeats early-Z / HSR on phone GPUs.** For a portal or door-clip room, swap to plain twin materials
   once the user is inside. Make the twins at load so there are no new programs later. Note that
   `material.clone()` drops `onBeforeCompile` and `customProgramCacheKey`, so a clone is a built-in program.
3. **Move should call `XR8.XrController.recenter()` and re-arm the settle gate.** A settle latch that is set once per
   run never protects later placements. 8th Wall's own Moon Portal sample recentres on place.
4. **Gate expensive reveals (a door opening, a room lighting up) on settled tracking too**, not only Place. Give the
   gate a cap.
5. **Animated parts must follow their target, not their change.** An instant "shut" that sets `open = 0` without
   moving the leaf left the door looking open.
6. **Collapsing a walk-in state must also handle a pending hop.** Otherwise the character is left inside a hidden room.
7. **Pinch hygiene:** clear stale pointers on a new primary pointer and on `lostpointercapture`, or the pinch can die.
8. **The pinch should size the whole placed set** (house and character), and Move should go back to the default.
9. **Simulator caveat:** SwiftShader frames are slower than the 250 ms stall threshold, and dt is clamped to 0.1 s, so
   every frame is a "stall" and game time runs at about 1/3 of real time. Read gates and caps with that in mind.
