# house-3: Cheer Bear's house, rebuilt in code as a walk-through portal

Round 3, worker house-3. **Nothing here has been tested on a real phone.** Everything below was checked in the
Playwright simulator (software WebGL, fake floor camera, fake IMU) and with `tsc`.

## What Dapo gets

- **A new house, built entirely in code** (`src/experience/scene/house/`). No `house.glb` and no green-screen swirl.
  - It's an original Care-a-Lot style cottage: a cloud base, a pink gabled facade and a big rainbow arch round the door
    (white trim plus six bands with cloud feet). There's a heart over the door and two heart windows with flower boxes.
  - The roof is made of cloud puffs, and a pink chimney puffs hearts. A sun turns on the roof.
  - The garden has a doorstep, a heart doormat, heart stepping stones, bushes with flowers, tulips and a fluffy pink tree.
  - The arched pink door has heart windows, swings open on a hinge and squashes a little when it pops in.
  - All colours are flat (no gradients). The geometry is merged and vertex-coloured, one mesh per material group,
    so the draw calls stay low (I did not count them).
- **A life-size room behind the door** (about 5.5 m x 4.5 m, ceiling 2.62 m). It is bigger than the cottage on purpose:
  it's a portal, and from outside you only ever see it through the door.
  - **Kept from the old house:** the TV (Dapo's model), which plays the theme with sound when you step in and pauses
    when you leave. Also the jukebox (now built in code, see below), the tub, the mirror and the shelf.
  - **New in the room:**
    - wallpaper with hearts, white panelling and a rainbow rail;
    - a sky ceiling with flat clouds and a cloud trim along the top of the walls;
    - a three-layer heart rug and a star mobile;
    - an arched rainbow window with clouds drifting past, and a cloud sofa under it with a heart and a star cushion;
    - a star lamp with a soft halo;
    - a bed with a cloud headboard, a heart pillow, a rainbow-striped quilt and little hearts on it;
    - fairy lights along the walls (they twinkle, and chase in rainbow colours during a party);
    - a **photo wall**: a pink board with eight polaroids that fills with this session's photos, newest first.
      It is memory only and nothing is stored;
    - a **toy chest** whose lid pops open and throws hearts through the physics playground.
- **Taps inside:**

  | Tap | What happens |
  |---|---|
  | TV | play / pause |
  | Jukebox | 9 s party: the party mood, the light bars and level bars pulse to the real music (an AnalyserNode is created on the first jukebox tap, which is a gesture), the fairy lights chase and notes float up |
  | Tub | bubbles |
  | Chest | hearts |
  | Mirror | sparkle sweep |
  | Lamp | the star spins |

  Cheer Bear dances, cheers or sparkles to match.
- **AR (life size, whatever the pinch scale).**
  - **Placing:** she stands in front of her house and the door opens with sparkles. The hint reads "Walk in through her
    door" (5 words).
  - **Walking in:** walk through the open door with your phone. Crossing is counted only inside the door opening and
    only when the door is open.
  - **Once inside:** the TV starts, the cottage outside hides, and Cheer Bear hops in to greet you. The hints read
    "You're in her house!" then "Tap the jukebox!".
  - **Leaving:** walk back out (or out through a wall), or press **Leave** (bottom left, above Move). Move stays bottom
    left and keeps her state. A Leave tap mid-glide turns straight round.
  - **"Step inside" pill (fallback):** brings the room to you. The doorway glides over the phone and you end up just
    inside, facing the TV. **Why:** at life size the door is about 1 m behind her. Someone sitting down, in a small
    room, or showing the experience on a table can't walk 2 m, and the portal shouldn't depend on that. The glide runs
    in the house's own frame, so the phone moves in a straight line through the garden and the doorway and never
    sweeps through a wall. My first version lerped the house's position and turn separately, and the phone swung
    through the back wall.
- **3D showcase "House" moment.**
  - The house pops in and the chimney puffs hearts. The mailbox pops in too and the car parks. The door opens.
  - The camera then **glides through the door** (the TV is already playing) and looks at the TV. Cheer Bear pops in
    on the rug and waves. The camera turns to the jukebox for a short party, then glides back out through the door.
    The door shuts, the car leaves and the house shrinks away.
  - It reuses the same room meshes (one HouseSet per stage, the showcase at 0.72 scale).
  - The AR "House" moment is a bounce, chimney hearts and a mailbox wobble while the car drives up to the door.

## How the portal works (and why not the usual way)

- **The room is clipped by a tiny shader patch, `DoorClip` in `scene/house/clip.ts`.** It uses four planes through
  the camera and the door edges. The patch goes in via `onBeforeCompile` with a fixed `customProgramCacheKey` and a
  shared `uniform vec4 houseClip[4]`.
  - **Outside:** the room draws only where you look through the door.
  - **Inside, or standing in the doorway:** the planes move out of the way. Only uniform values change, so nothing ever
    recompiles.
- **Why not three's own `clippingPlanes`:** `renderer.compile()` builds programs with whatever clipping count the
  last rendered material left behind. Clipped materials are then compiled again on their first real draw, a stall at
  the moment the door opens. That is the same failure class as the Cola Run hideout black-out.
- **Why not a depth cloak** (the old 200 m depth wall): it also hides transparent particles behind it and the
  showcase cloud floor.
- **The cottage gets the opposite patch (`applyCut`, key `cb-house-cut`).** It is cut away where you look through the
  door beyond the door plane. Parts of the cottage that poke into the room's volume (base clouds, roof puffs) never
  show inside the room. Without it, a row of base clouds sat on the rug (seen in the first sim run, then fixed).
- **The cottage walls are single-sided and face outward,** so the room is never hidden behind their inner faces.
- **Visibility rules:**
  - the room shows when you're inside, or when you're in front with the door open;
  - the cottage body hides when you're inside;
  - the facade and garden always draw.
- **The room only has the stage's existing hemisphere and sun lights; no new lights.** A small emissive lift on the
  house materials keeps the whites from going grey.

## Results in the simulator

Commands are below. Logs are in `docs/evidence/house-3/sim/run-*.txt` and shots in `docs/evidence/house-3/*.jpg`.

| Check | Result |
|---|---|
| AR flow: place → door opens → walk in (test pose) → TV plays → look round → photo → jukebox → all taps → walk out → Step inside → Leave → Move → re-place → back to 3D | passes, 0 console errors |
| Crossing state | inside=true, cottage hidden, theme on after walking through; inside=false, theme off after walking out |
| Shader programs, AR (engine) | **36 before placing, 36 after placing, after the door opens, inside, in the party, after every tap, after leaving, after Move.** Flat. |
| Shader programs, 3D showcase | **34 after warm-up, 34 through the whole House moment** (exterior, glide in, inside, party, out). Flat. |
| Programs used only by the house | 11 (probe `sim/programs.cjs`): 8 room variants with the clip, 1 cottage with the cut, 2 plain (facade Lambert and sun Basic). All are compiled at load and none at runtime. |
| Before / after | games-3's checkpoint measured 26 (AR) and 23 (3D) programs with the old house (GLB plus the chroma-key ShaderMaterial). The new house adds about 10 to 11 programs, all at load. I did not time the load cost on a phone. |
| fps | The simulator uses software rendering (SwiftShader, about 2 to 4 fps for everything), so it says nothing about phones. Measured: outside 2.5 to 3, through the door 3, inside 2.1 to 2.7, during the party 3.7. The room is not slower than the outside. |
| tsc | clean |

**Not tested:** a real phone, real SLAM, real audio output, the AnalyserNode on iOS (it falls back to a fake beat if
the analyser gives nothing), long sessions, or memory use on low-end Android.

### Evidence (390x844 unless noted)

| File | Shows |
|---|---|
| `ar-01-placed-default-camera.jpg` | right after placing, at the simulator's default camera |
| `ar-02-outside.jpg` | standing in the garden: the room shows only through the door |
| `ar-03-through-door.jpg` | the view through the door: TV, jukebox, shelf, rug, mobile |
| `ar-04-inside-tv.jpg` | inside at the TV, theme playing |
| `ar-05-inside-door.jpg` | inside looking back: the open door, with the real camera world outside it |
| `ar-06-inside-left.jpg` | rainbow window and cloud sofa |
| `ar-07-inside-right.jpg` | bed and photo wall |
| `ar-08-photo-wall.jpg` | photo wall with a capture ("Hi!" polaroid, sent through the real `ctx.capture` callback) |
| `ar-09-jukebox-party.jpg` | jukebox party (party mood, bars, notes) |
| `ar-10-walked-out.jpg` | back outside |
| `ar-11-step-inside-pill.jpg` | the Step inside pill |
| `ar-12-stepped-inside.jpg` | after Step inside |
| `ar-13-left.jpg` | after Leave |
| `ar-14-move.jpg` | Move |
| `sc-phone-01..06`, `sc-desktop-01..06` | 3D House moment at 390x844 and 1440x900: exterior, glide through the door, TV, jukebox party, way out, after |

### How to run

```
API_PORT=6203 npx tsx scripts/dev-api.ts &
API_PROXY=http://127.0.0.1:6203 SIM_PORT=5203 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
cd docs/evidence/house-3/sim
node ar.cjs <scratch>/xr/floor.y4m         # AR flow + programs + fps
node showcase.cjs [desktop]                # 3D House moment
node programs.cjs <scratch>/xr/floor.y4m   # which programs the house uses
```

The sim Vite has file watching off, so **restart it after every edit**. I lost a run to a stale server.

Test hook: `__cb.internals().modes.get('ar').walk.testPose = { x, y, z, yaw, pitch }` (door-local metres; yaw 0 looks
into the room) overrides the tracked camera every frame. Set it to `null` to release it. It is null unless a test
sets it.

## Files

**Mine (new):**
- `src/experience/scene/house/` contains:
  - `index.ts` (HouseSet: poses, the door, the portal, taps, animation, the showcase tour)
  - `exterior.ts`
  - `room.ts`
  - `clip.ts` (DoorClip, with the clip and cut patches)
  - `geo.ts` (Builder, shapes)
  - `dims.ts`
  - `photos.ts` (photo wall)
  - `music.ts` (jukebox analyser)
- `src/experience/modes/ar/house-walk.ts` (walk-in / leave, Step inside, the bear following you in, the test pose)
- `docs/evidence/house-3/`

**Shared files (surgical edits):**
- `scene/stage.ts`:
  - builds `houseSet` and keeps `house`, `houseModel` (= the exterior), `houseSize` (updated every frame), `door`,
    `interior` (= the room group) and `portal` (now always null);
  - `houseBox` uses `houseSet.bounds()`. It is left empty while you're inside or the house is posed;
  - new `houseBounds(out)` for games-3's `houseBounds(stage)`;
  - `resetLayout` calls `houseSet.reset()`;
  - the chroma-key import and the old interior are gone.
- `modes/ar/index.ts`:
  - the old house fields and animation were replaced by `walk: HouseWalk` plus one-line hooks in place, enter/leave,
    collapse, update, constrain, syncHud and dispose;
  - `enterHouse()`, `leaveHouse()` and `inside` still exist, and games-3's `if (this.inside) this.collapseNow()` is kept.
- `modes/showcase/index.ts`: one line, `st.houseSet.applyTour(this.cam)`, after `placeCamera`.
- `scene/moments.ts`: `houseShowcase` and `houseAr` were rewritten (above), plus an import of `COT`.
- `index.ts`: the capture callback also calls `addHousePhoto(blob)`.
- `scene/props.ts`: `'house'` was dropped from the load list, so `house.glb` is no longer downloaded.
- `scene/media.ts`: the portal swirl video is no longer created, loaded or awaited (one fewer video at start).

**Retired but left on disk:** `public/models/props/house.glb`, `public/media/portal.mp4` and `chromaKeyMaterial()` in
`scene/fx.ts` (now unused). Delete them when convenient.

## Open issues / ideas

- **Real-phone check needed:**
  - how the door crossing feels with real SLAM jitter. The crossing needs the camera inside the opening (±0.76 m,
    below 2.57 m), with a 0.45 m slack before walking out through a wall counts as leaving;
  - whether the room looks right at real scale.
- **The party mood washes the room purple.** That is the existing stage party mood, not something the house adds.
  If Dapo wants the room to stay bright during a party, use a lighter mood just for the house.
- The jukebox analyser needs the first jukebox tap (a gesture). Before that, a fake 112 bpm beat drives the bars.
- In the 3D moment, Cheer Bear is big next to the 0.72 showcase house (she isn't scaled with it). She stands on the
  rug, clear of the camera path.
- The photo wall only fills from photos taken in this session (Selfie / 3D Photo). AR mode has no shutter of its own.

## Findings for the immersive skill

1. **`renderer.compile()` and clipping planes:** `compile()` builds programs with the clipping state the last
   rendered material left behind (`clipping.numPlanes`). Materials using `clippingPlanes` therefore get compiled again
   on their first real draw, which is a hitch exactly when a portal opens.
   - **Fix:** a fixed-key `onBeforeCompile` patch with uniform planes (DoorClip). It compiles once at load and then
     only uniforms change. When off, set the planes to (0,1,0,1e9).
2. **Portal without a stencil buffer:** clip the room to the door frustum. Also cut the outside shell by the same
   frustum beyond the door plane, so exterior parts that intersect the room volume never show inside.
   - Make shell walls single-sided, facing outward.
   - A room bigger than the shell is fine; that's the point of a portal.
3. **"Bring the room to you" glides:** interpolate the camera's position in the house's local frame, not the house's
   position and yaw separately. The latter swings the phone through walls when the turn is large.
4. **Vertex-colour materials need a colour attribute on every geometry,** including instanced ones. Otherwise they
   render black. Build every geometry through the same Builder.
5. **The simulator Vite (`vite.sim.config.mjs`) has watching off.** Restart it after edits, or the run tests old code.
