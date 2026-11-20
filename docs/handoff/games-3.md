# games-3 handoff: Heart Run and Heart Hoops (round 3)

Dapo asked for "another game mode, like Cola Run, but picking up hearts or rainbows", plus anything else from
our 8th Wall builds that would work here. This round adds two mini games. Both play in the 3D showcase and in AR
on the placed stage.

- **Heart Run** (the Cola Run idea). The joystick (arrows / WASD on a computer) runs Cheer Bear round her world
  for 60 seconds.
  - Pickups: hearts +1. Rainbows are rare, give +5, and add a short rainbow trail and a speed boost. A gold star
    every ~15 s gives +2 and acts as a 4 s magnet.
  - Every 5 in a row adds a +2 bonus. The "N in a row" pill and the pickup sound's pitch both rise with the streak.
  - After 18 s a grumpy raincloud drifts after her. If it reaches her she drops up to 3 hearts, which fly out as
    physical hearts. It then grins and backs off for 4 s.
- **Heart Hoops** (from Bobo Hoops). A rainbow ring sits on a cloud at changing distances, and she stands beside
  it. You get 10 hearts.
  - Phone: swipe up to throw (the same gesture and physics as the free heart toss). Computer: hold Space and let go.
  - A score is 2 points, or 3 for a swish (did not touch the rim). A long shot adds +1 and 3 in a row adds +1.
  - The 10th heart is a gold "money" heart worth double. The ring hops to a new spot after each score.
- **Both games**
  - A 3-2-1-Go countdown.
  - A glass scoreboard under the top bar with pause, score, and the clock or the hearts left.
  - Score popups in the world.
  - A results card with 1–3 stars, the score, the best score (kept on the device), and Play again / Done.
  - She runs while you steer, idles when you stop, and cheers at the end.

## Where you start a game (the shortcut choice)

- **App sheet → Games tab.** A new "Play" section sits above the word games and has two big cards (pink Heart Run
  and purple Heart Hoops), each with flat SVG art, a one-line lead, a Play pill and your best score.
  - Tapping a card closes the sheet and starts the game.
  - From Selfie or 3D Photo, it switches to 3D first.
  - The Games tab now always shows, because the mini games are always available.
- **In the experience: one "Games" tool button.**
  - 3D: bottom left, which was empty.
  - AR: stacked above Move once she is placed and you can walk her.
  - It opens a small in-experience chooser sheet with the same two games and "Not now". It hides while a game runs.
- **Why not the bottom bar:** the bottom bar is already the mode switcher, shutter and joystick, and the house rules
  keep the shutter and joystick unobstructed. The Games button lives in the HUD's left tool slot, which already
  holds Move in AR, so it adds no new screen region. In AR it appears only when walking is possible.
- Voice (voice-3) can also start games through `startPlay`, and pause / resume / play again through
  `mode.command('pause'|'resume'|'again')`.

## Files

Mine (new):
- `src/experience/play/index.ts`: `PLAY_GAMES`, `PlayDirector` (one per experience: start / stop / pause /
  resume / again / status) and the `PlayMode` interface (`playHost()`, `setGame()`).
- `src/experience/play/game.ts`: the `PlayGame` base and `PlayHost`, which a mode provides (stage, joystick
  field, projection, `constrain`, `hint`, `ready`, optional `court` for the settled camera).
  - The base runs the state machine: idle → countdown → playing ⇄ paused → won/over.
  - It also handles: pause reasons (user, sheet, hidden, move, place), the best score in localStorage
    `cbx.play.best.<id>`, swapping and restoring the playground hooks, the timer, and emitting `play` events.
- `src/experience/play/run.ts` (Heart Run) and `src/experience/play/hoops.ts` (Heart Hoops).
- `src/experience/play/kit.ts`: `PlayKit`, one per stage, built once at load. It holds:
  - instanced hearts, stars, rainbow arcs and puffs;
  - instanced beacon rings (one small ShaderMaterial; a flat ring that grows and fades, no gradient);
  - the hoop (6 flat rainbow bands and cloud puffs) and its 14 static rim spheres in the toy physics world;
  - the raincloud.

  It also exports `houseBounds(stage, pad)`. This reads `stage.houseBounds(out)`, which house-3 added. If that is
  missing, it falls back to the house's bounding box. Pickups and the ring never use hard-coded house sizes.
- `src/experience/play/ui.ts` and `play.css`: scoreboard, countdown, streak and power pills, popups, pause card,
  results card, chooser cards.
- `src/experience/play/audio.ts`: small WebAudio synth on the shared AudioContext (blips with rising pitch,
  sparkle, tick, throw, score, rim, warn, finish fanfare).
- `src/app/components/games.css`: the Play cards.
- `docs/evidence/games-3/`: screenshots, logs and simulator scripts (`sim/run3d.cjs`, `sim/ar.cjs`,
  `sim/app.cjs`, `sim/lib.cjs`, `sim/probe-programs.cjs`).

Changes outside `play/` (additive; each is marked games-3 or sits in game-only code paths):
- `src/experience/index.ts`:
  - `PlayDirector` wired to the `play` event;
  - `playGames` / `startPlay(id)` / `stopPlay()` (the round-3 contracts);
  - the in-experience chooser (`pickGame`);
  - `play.stop()` on mode switch, restart and dispose;
  - `visibilitychange` (hidden) pauses the round;
  - `holdPlay(on)`, used by the app's sheet: it holds the round without a pause card. It is a method on the
    class only, not in `ExperienceApi`; GamesPanel calls it if present and otherwise falls back to
    `command('pause'|'resume')`;
  - `debug().play` and `internals.play`.
- `src/experience/modes/showcase/index.ts`:
  - `kit`, `game`, `playHost()` (field radius 2.65, `court()`), `setGame()`, `command()`;
  - the Games tool button;
  - the game drives walking, and the camera widens or centres per game;
  - taps only jiggle her during a game (no hug or moments);
  - `throwHeart` goes to `game.flick`;
  - Space hold-to-throw.
- `src/experience/modes/ar/index.ts` (surgical, around house-3's walk-in code):
  - `kit`, `game`, `playHost()`, `setGame()`, `command()`;
  - Games button after Move;
  - Move pauses the round and Place resumes it with a 3-2-1;
  - taps, the house tap and hugs are blocked during a game;
  - door entry is off while a game runs;
  - the hint pill is left to the game.
- `src/app/components/GamesPanel.tsx`:
  - the Play section and cards;
  - `startMiniGame()` (switches to 3D from Selfie / Photo, with a toast if a game cannot start);
  - `PlayBridge` (pauses the round while the app sheet is open and resumes it when the sheet closes).
- `src/app/App.tsx`: `<PlayBridge />` (one import and one element).
- `src/app/components/ConversationSheet.tsx`: one line so the Games tab always shows.

## How it works (short)

- **Pickups**
  - A seeded minimum-separation layout (0.72 apart) keeps 9 on the field. A pickup is respawned 0.5–1 s after it
    is taken.
  - Spots are rejected if they are inside the house box (padded), are moved by the stage's `constrain`, are
    within 0.9 of her, or are too close to another pickup.
  - Each pickup floats over a pulsing flat beacon ring so you can see it from far off.
- **Hoops aim**
  - The ring spot is chosen from where the camera *settles* for the court (the showcase's `court()`; in AR, the
    live camera).
  - A throw starts 0.5 m in front of the camera and lobs towards the ring.
  - Strength: up-swipe length and speed (or how long Space is held) set the distance. Within 9 % of the ring
    distance, the strength snaps to it.
  - Aim: sideways lean beyond a small dead zone turns the throw.
  - Scoring: a heart scores when it crosses the ring plane inside the inner radius. A swish means it touched
    nothing before that.
- **Physics and moments during a game**
  - The playground's catch is off and the rim is real (static spheres), so hearts can bounce off the rim.
  - Moments are suppressed during a live game (`trigger()` returns false).
  - The free toss is restored afterwards and was checked to work.
- **Pausing**
  - The app sheet opening, the tab hiding, the pause button, or Move in AR all pause the round.
  - Resuming always runs 3-2-1 first, so nobody loses time.
- **Reduced motion:** softer bob and spin, fewer particles, slower trails, a quicker ring move, a shorter delay
  before results, and quieter sounds. Nothing freezes.

## Frame rate and shaders (pitfall 14)

The kit is built in the stage constructor and its materials are compiled with the rest of the scene at load. The
instance colour attribute exists before the first compile, and hidden pieces are drawn once far below the floor,
then hidden on the first tick.
- **3D showcase:** 23 programs before a game, during Heart Run and Heart Hoops, and after both. No new programs
  appeared after load.
- **AR:** 26 programs after placing and 26 after a full Heart Run and Heart Hoops. No new programs appeared.
- **Against wow-2:** that handoff recorded 21 (3D) and 24 (AR); both are now +2. A probe that matched each
  material to `renderer.properties.get(m).currentProgram` found the +2 come from the kit, compiled at load:
  - one program for the beacon ShaderMaterial;
  - one program for the kit's plain MeshStandardMaterials (hoop bands, cloud).

  The instanced pickups share an existing toy program. Nothing compiles when a game starts.
- **fps:** in this sandbox, fps was 10–33 in 3D and 2–3 in AR (shared, loaded CPU, software GL). These numbers say
  nothing about phones.

## Run and test

Use your own servers (see `common.md`). Then, from `docs/evidence/games-3/sim/`:

```
# 3D, phone and desktop (full Heart Run with an autopilot, pause, Play again, stop; full Heart Hoops with flicks / Space)
W=390 H=844 PREFIX=phone BASE=http://localhost:5202 OUT=<dir> node run3d.cjs
W=1440 H=900 DESKTOP=1 PREFIX=desk BASE=http://localhost:5202 OUT=<dir> node run3d.cjs
# AR with the fake floor camera (FORCE_SETTLE skips the plane settle for slow machines; test only)
FLOOR=<scratch>/xr/floor.y4m FORCE_SETTLE=1 BASE=http://localhost:5202 OUT=<dir> node ar.cjs
# the full app: Games tab cards, sheet pause / resume, toast + hint + scoreboard; FACE= adds Selfie -> Heart Hoops
BASE=http://localhost:5202 OUT=<dir> [W=375 H=667] [FACE=<scratch>/xr/face.y4m] node app.cjs
```

In the page, use `window.__cb.exp.startPlay('heart-run')` (experience-dev) or `window.__cbx.startPlay(...)` (app
with `?test`). `debug().play` shows the live status.

## Results (simulator, 2026-11-19)

Logs are in `docs/evidence/games-3/*.log` and screenshots in `docs/evidence/games-3/shots/`. I looked at all of
the screenshots.

**3D, phone 390x844** (`run-phone.log`, `phone-01..12`)
- Heart Run full round: the autopilot scored 200 (129 hearts, 7 rainbows, 3 stars; the cloud made her drop
  12 hearts).
- The pause button pauses the round; Play again gives a fresh countdown.
- `stopPlay` leaves no game DOM; the kit counts drop to 0 and the hoop and cloud are hidden.
- Heart Hoops, 10 synthetic swipes (some deliberately short or long): 4 of 10 in, 1 swish, 13 points.
- The free heart toss works again afterwards.
- Programs stayed at 23 throughout, with no new programs. 0 console errors.

**3D, desktop 1440x900, keyboard** (`run-desk.log`, `desk-01..12`)
- ArrowLeft moves her.
- Heart Run: 195. Heart Hoops with Space held (short, right and long holds): 4 of 10, 4 swishes, 16 points.
- Programs stayed at 23. 0 errors.

**3D, reduced motion** (`run-rm.log`, `rm-01..12`): both games ran to the end (209 and 12). Programs stayed at 23.
0 errors.

**AR, fake floor camera and IMU, 390x844** (`run-ar.log`, `ar-01..10`)
- After placing, the Games button sits above Move (ar-01).
- Heart Run starts from the chooser. Pickups and beacons sit on the floor around the house, never inside it.
- Move during the round pauses it (the clock stops at 58; ar-04). Place gives a 3-2-1 and play carries on with the
  same score and clock (ar-05).
- The round was cut to 8 s from the test (a test shortcut, because AR ran at 2 fps here). Results card: 39 points
  (ar-06).
- Heart Hoops, 10 swipes: 5 of 10, 2 swishes, 14 points (ar-09).
- Programs: 26 after placing and 26 at the end, none new. 0 errors.
- The log line "kept score false" in that run compared against a value read before the Move click (she picked up
  two hearts in between). The paused and resumed values match (4 / 58). The script now compares the right values.

**Full app** (`run-app.log`, `app390-*`, `app375-*`, `app1440-*`)
- The Games tab shows the two Play cards above Word games at 390, 375 (iPhone SE) and 1440.
- A card tap closes the sheet and starts the countdown.
- A toast and the in-game hint stack under the chip without overlapping: chip, toast, scoreboard, hint
  (app390-03, app1440-03).
- Opening the sheet holds the round (paused). Closing it gives a 3-2-1 and play carries on.
- In Selfie, `startPlay` returns false; the Heart Hoops card switches to 3D and starts (app390-06).
- 0 errors.

**Fixed after looking at the screenshots**
- The pause card sat on top of the app sheet when the sheet opened mid-round. The sheet now holds the round with
  no card (`holdPlay`), and the scoreboard waits behind it.
- On slow frames, the countdown numerals faded out before the next number, so the screen showed only the line
  under them (ar-05 and the first app run). Numerals now stay until replaced (app390-05 and -06 show "3").
  The 3D and AR runs above used the old CSS; only the numeral animation changed.

## Simulator-tested vs untested

**Nothing was tested on a real phone.** Everything above comes from headless Chromium with software GL, fake camera
video and a fake IMU. The following were not tested:
- touch feel on glass: swipe strength, the joystick while running, and difficulty for a child;
- real AR tracking drift while running round;
- audio on iOS (it uses the shared AudioContext that the call unlocks);
- frame rate on phones.

The bots score far above a human (192–200 in Heart Run). The star thresholds (25 / 50 / 80 for Heart Run,
8 / 18 / 28 for Heart Hoops) are a guess and need a real-phone play test.

## Open issues / ideas not done

- **Difficulty:** tune the star thresholds and the Hoops strength curve on real phones.
- **Hearts on the rim:** a missed heart can come to rest on the ring's rim or cloud and sit there until it expires.
  It is harmless but looks odd.
- **Raincloud on portrait 3D:** it is clearly visible on desktop. In the narrow portrait 3D view it can drift past
  the edge of the frame, so a small edge arrow could help.
- **AR slow-motion:** in this sandbox AR ran at 2–3 fps. The game clock uses the clamped frame dt (0.1 s max), so a
  very slow device would run the round in slow motion. This is fine for phones at 30–60 fps.
- **AR ring off screen:** when the ring hops after a score, it picks a spot in front of the camera at that moment.
  If the phone then turns away, the ring can be off screen (ar-08, where the fake IMU sways). An edge arrow for an
  off-screen ring or cloud would help.
- **Hiding the Games button:** it shows for everyone. If Dapo wants it gated behind a config flag, it is one line
  in each mode's HUD sync.
- **Possible later games:** Bobo Booth-style "photo with her" challenges and a Spray-style "colour the clouds"
  game both fit the kit, but neither is built.

## For other workers

- **voice-3:**
  - `mode.command('pause' | 'resume' | 'again')` is handled in both modes.
  - `startPlay(id)` resolves false when no 3D or AR mode is live. The app switches to 3D first, and
    `startMiniGame()` in GamesPanel does this too.
  - Scene moments return false from `trigger()` while a game is live, so "do the Stare" mid-round is ignored on
    purpose.
- **house-3:**
  - Pickups and the hoop read `stage.houseBounds(out)` (already in `stage.ts`).
  - During a game, door entry is off (`constrain(p, !this.game)`) and `setGame` collapses the house if she is
    inside.
  - In AR, a game can start only when she is placed, outside, and the house is at rest (`playHost().ready`).

## Findings for the immersive skill

- **Mini games inside a character experience** work best as a director plus host pattern:
  - one director per experience;
  - each mode hands it a small host (stage, field, projection, constrain, hint, ready);
  - the game tears down completely on stop, mode switch or dispose.

  This keeps the modes' own code to about 100 lines each.
- **Build every game mesh at load**, as InstancedMesh with `instanceColor` set before the first compile:
  - the shader program count then stays flat when a game starts;
  - the showcase's `compileAsync` skips hidden objects, so keep them visible and far below the floor until the
    first tick.
- **Hoop throws from a swipe:**
  - aim at the target and let the swipe set only distance and a sideways lean;
  - snap within a small window;
  - pick the target spot from where the camera will settle, not where it is during the transition.

  Without this, almost every phone throw missed.
- **AR and pausing:** Move should pause the round, and Place should resume it with a 3-2-1. Players move the
  stage mid-game, and losing the clock feels unfair.
- **Slow simulators:** for the 8th Wall-style AR simulator at 2–3 fps, shorten the round from the test (set
  `timeLeft`) rather than waiting 10+ minutes. Mark it as a test shortcut in the log.
