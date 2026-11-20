# polish-6 handoff: top bar, Selfie and Photo clean-up, Frame | Filter toggle, cloud in the frame, Photo tile, AR size x2.5

This round makes Dapo's six fixes after round 5.

**Nothing here was tested on a real phone.** Everything below was checked in the Chromium simulator. That is Playwright with
SwiftShader and the fake face and floor cameras, run at 390x844, 375x667 and 1440x900, and I looked at the screenshots.
Real 8th Wall tracking, a real camera, real pinch and real recording on iOS and Android are all **unverified**.

Working tree only: I made no commits and changed no git state.

## What changed

### 1. Top bar (`hud.ts`, `hud.css`, `app.css`)

**Phones** use two rows:
- Row 1: the lockup is top left and Menu is top right, on the same line.
- Row 2: the mode switcher is centred under them.

It is built like this:
- `.cbx-top` is a CSS grid with areas `"lock menu" "tabs tabs"`.
- The `.cbx-tabsrow` wrapper is gone. The top bar is now `top.append(lockup, menuBtn, switchEl)`.
- The lockup is 36px tall and Menu is 44px.
- `--cbx-head` is 112px.
- `--top-bar` in `app.css` is 116px, which is 10 + 44 + 8 + 54. It was 104px.

Measured at 390x844:

| Element | Box |
| --- | --- |
| Lockup | 10,14 to 196,50 |
| Menu | 336,10 to 380,54 |
| Tabs | 10,62 to 380,116 |

The hint pill sits at 122.

**700px and wider:** one 64px row, `"lock tabs menu"`. The columns are `1fr auto 1fr`, the tabs are 420px and Menu is
54px. This is unchanged in look.

`play.css` now uses `var(--cbx-head, 64px)` in four places where it had a fixed `64px`: the game hint, `.cbp-board`,
`.cbp-power` and `.cbp-streak`. Without this, the game scoreboard would sit on the tabs row on phones.

### 2. No talk orb, Actions or dock in Selfie and Photo
- The `.cbx-act1` Actions toggle is gone. `hud.dock()` is now `dock(show: boolean)`, and `index.ts` no longer docks
  Actions for face and photo.
- `TalkOrb.tsx` returns only `<VoiceDiagHost/>` in Selfie and Photo while the call is idle or errored and no mic
  explainer is open.
  - A live call, or the mic explainer, keeps the orb on screen, so you can always hang up. That case is not visible
    in the screenshots.
- 3D and AR have the orb, Actions and Games as before.

### 3. Selfie: Frame | Filter toggle (`capture/style-strip.ts`, `capture.css`, `modes/face/index.ts`)
`StyleStrip` is now `{ el, toggle, set, open(group|null), opened }`.

**The toggle** (`.cbc-styletog`) is one glass pill with two halves:
- Each half shows "Frame · Rainbow" or "Filter · Natural" and a chevron.
- The halves carry `aria-expanded` and `aria-controls`.

**The chip row** (`.cbc-strip`) shows one radiogroup at a time and sits between the look picker and the toggle.

**It folds:**
- By default.
- When you tap the open half again.
- When you tap the camera view. This is a capture-phase `pointerdown` on the stage that is outside the strip and the
  toggle.
- On Esc, which also returns focus to the toggle.
- When the picker tucks away.

**Sizes:**
- Collapsed, the stack is 106px (`--cbx-strip-h`): the look picker at 598 and the toggle at 658 to 704 (390x844).
  Open, it is 190px.
- Below 360px wide the "Frame" and "Filter" words hide and only the values show.
- Below 700px tall the chips shrink to 54px.

Her speech bubble sits above the whole stack.

### 4. Selfie: no lockup, and the cloud is part of the frame (`frame-art.ts`, `modes/face/index.ts`)
- **The lockup** is hidden in Selfie (`opacity:0; visibility:hidden`). Menu and the tabs stay.
- **Saved photo and clip:** both draw the "Cheer Bear AR Experience" cloud at the top centre, inside the frame.
  - This uses the new `titleAt: 'edge'`, at 50% of the picture's width (`TITLE_W`).
  - It is inset below the Rainbow band, the Clouds edge or the other frames' edges.
- **Live view:** the cloud is drawn under the top bar (`titleTop`), so it never sits under the tabs.
  - `--cbc-title-h` pushes the "Look at the camera" hint below the cloud. Before, the hint overlapped it.
- The live cloud therefore sits about 112px lower than the one in the saved picture. This is on purpose.

### 5. 3D and AR: branded Photo tile (`hud.ts`, `hud.css`, `icons.ts`)
The dock shutter gets `is-shot`.

**Idle:**
- A 60px white tile with a 20px radius.
- The new `ICON.camHeart` (a camera with a heart lens) and a "Photo" label, in pink-deep.
- Title: "Tap for a photo, hold for a video".
- A "Hold for video" cue pill shows once per page load. It appears after 900ms and goes after 4.2s.

**Recording:**
- A flat `--cb-red` tile with a white stop square.
- The timer ("0:03") in place of the label.
- A progress bar along the bottom, driven by `--rec-p`.
- A pulsing red ring. It is static under reduced motion.

There are no gradients. The Selfie and Photo shutters are unchanged: a white ring at the bottom centre.

### 6. AR: her size x2.5 (`modes/ar/index.ts`, `house-walk.ts`)

| Setting | Before | After |
| --- | --- | --- |
| Default size (`SCALE.def`) | 0.5 m | **1.25 m** |
| Pinch range | 0.25 to 1.3 m | **0.5 to 2.5 m** |
| Closest placement (`REACH.min`) | 0.8 m | **1.3 m** |

- **Move** goes back to the default. The sim measured 1.25 after Move.
- **Pinch** still works.
- **Games:** Heart Run and Hoops were tuned for a small bear, so `GAME_SIZE_M = 0.75`. While a game runs, a `fit`
  multiplier eases her to `min(1, 0.75/scale)`, and she grows back afterwards. `unitsPerM` uses `scale*fit`, so the
  games' metre sizes are right. It snaps instead of easing when the mode is not live or reduced motion is on.

**House and door:**
- The house stays life size. `houseSet.k = sizeMul / root.scale` was already in place.
- **Door:** she is 1.25 m tall and the door is 2.12 m, so she fits under it. Her width was the problem: walking
  through the doorway, her x is now clamped to `doorSlack = max(0.12, DOOR.w/2 - max(0.16, 0.28*bearM))`, so all of
  her fits through the frame.
- **In the sim:**
  - `bearIn` went true and the door auto-opened (`autoOpens` 0 to 1).
  - Inside, she stands about 2 m away and you see all of her.
  - Leave and Step inside work.
- **Inside the room** she lands `1.3 + max(0, bearM - 0.5)` m away. That is 2.05 m now, and was 1.3 m. No shrinking
  inside the house was needed.

### Shader programs (flat, as required)

| Mode | Count |
| --- | --- |
| 3D | 38 |
| AR | 39 |
| Selfie | 41 |
| Photo | 36 |

The 3D size is unchanged.

## Checks run
- `npx tsc --noEmit`: clean. It was run again after the last edit.
- `npm run build`: OK.
- `test:server`: all passed.

  | Suite | Tests |
  | --- | --- |
  | classifier | 20 |
  | config | 16 |
  | voice logic | 24 |
  | voice commands | 23 |
  | voice hold | 24 |
  | voice call | 12 |
  | functions | 36 |

- `test:voice`: 11 passed in the browser.
- Sims, with no console errors in any run:
  - camera-5 `scene.cjs` (390 and 375 SE), `face.cjs` (updated) and `ar.cjs`.
  - chrome-5 `ar.cjs` and `tour.cjs` (375, 390 and 1440).
  - The new `polish-6/sim/modes.cjs` (375, 390 and 1440) and `arsize.cjs` (390).

## Sim scripts
- **`docs/evidence/camera-5/sim/face.cjs`** is updated for the new layout:
  - It opens the Frames or Filters half before tapping a chip.
  - It logs the stack boxes.
  - It takes collapsed, Frames-open and Filters-open shots.
  - It checks the fold on a camera tap and on the toggle's own half.
- **`docs/evidence/polish-6/sim/modes.cjs`** is the real app in all four modes. It runs with
  `BASE=… OUT=… VIDEO=floor.y4m W H PHONE TAG` and uses `ui-2/sim/mylib.cjs`.
- **`docs/evidence/polish-6/sim/arsize.cjs`** covers AR size, Move, the door, inside, and the games. It uses
  `camera-5/sim/lib.cjs`. Like the camera-5 sims, run it from a scratch copy that sits beside `capture2/`
  (`face.webm` and `floor.webm`).
- **chrome-5 `ar.cjs`** still lists `.cbx-act1` in its bottom-row probe. It is harmless because no element matches.

## Evidence (`docs/evidence/polish-6/`, small JPEGs)

**Before and after:**
- `ba-topbar-phones.jpg`: the top bar at 390 (3D) and 375 (AR).
- `ba-topbar-1440.jpg`: the top bar at 1440.
- `ba-selfie.jpg`: Selfie, before and after.
- `ba-photo.jpg`: Photo, before and after. The "before" shots have the welcome card open.
- `ba-ar.jpg`: AR placed and recording, at 0.5 m and 1.25 m.

**After only:**
- `selfie-frame-filter.jpg`: the stack collapsed, with Frames open and with Filters open, at 390 and 375.
- `selfie-saved.jpg`: the saved photo (Clouds and Mono) with the cloud at the top, a frame from the saved clip, the
  review screen, and Just me.
- `ar-capture-tile.jpg`: the tile idle, recording and after Move, plus 3D with the orb back.
- `ar-size-house.jpg`: placed, after Move, at the door, walking in, inside, left, Heart Run and Hoops.
- `ar-door-390.jpg`: the door shut, opening, inside, and left (chrome-5 `ar.cjs` flow).
- `desktop-1440.jpg`: Selfie, Frames open, Photo and 3D.
- `se-375.jpg`: the 3D and AR tile at 375x667, plus a frame from the AR clip.

## Open issues
1. **Not tested on a real phone.** Check these on a real phone:
   - Pinch to 2.5 m.
   - Her 1.25 m size against real rooms.
   - Hold-to-record on the new tile on iOS.
   - The cloud's placement in the saved clip.
2. **She can fill the screen.** At 1.25 m she fills a phone screen when she wanders close to the camera; see
   `ba-ar.jpg`. `REACH.min` of 1.3 m keeps where you place her at a distance, but her wander can bring her closer. If
   Dapo finds her too big, `SCALE.def` is the one knob to change.
3. **Games shrink her to 0.75 m.** `GAME_SIZE_M` is tunable. If games should run at full size, their field and ring
   sizes need retuning instead.
4. **The live cloud sits lower than the saved one** (under the top bar). This is by design.
5. **The orb comes back in Selfie and Photo only during a live call** or the mic explainer.
6. **The 1440 desktop AR tour sometimes shows "The camera had a hiccup".** This was already a known chrome-5 issue and
   I did not cause it.
7. **The coloured discs along the bottom of the Selfie shots are not app UI.** They are in the fake camera video
   (`capture2/face.webm`), which is a stock clip with a dark bar of colour swatches at the bottom. A raw frame of the
   webm shows the bar; the round-5 clip shows it too. Real camera feeds will not have them.
8. **Leftover `gamesBtn` fields** in `modes/ar/index.ts` and `modes/showcase/index.ts` are already unused. I left them
   alone.

## Changes outside the capture, HUD and AR lanes
- `src/app/components/TalkOrb.tsx`: hides the orb in Selfie and Photo.
- `src/app/app.css`: `--top-bar` is 116px.
- `src/experience/play/play.css`: uses `--cbx-head`.
- `src/experience/index.ts`: no Actions dock in face and photo.
- `src/experience/types.ts`: the `dock(show)` signature.

## For the immersive skill
- **Keep the top-bar height in one variable.** When the top bar changes height, every fixed `top: 64px` under it
  breaks: the game boards, the hints and the strips. Keep the height in one variable (`--cbx-head`) and use it
  everywhere.
- **Measure a bigger character against the camera.** Growing a world-tracked character needs three things together:
  a larger minimum placement distance, a larger "pop into the room" distance, and a doorway clamp sized to her
  width. Measure on screen in the sim (her feet and head pixels against the camera height) before calling it done.
- **Pin game sizes in metres.** Games tuned in metres should run at a fixed size (a fit multiplier) rather than at
  whatever the user pinched to.
- **Branded text in a saved selfie goes in the composited frame**, not the live overlay. Then the live view can put
  it under the chrome while the saved picture puts it at the true top.
