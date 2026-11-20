# chrome-5 handoff (round 5): navigation, transitions, splash, joystick, bottom buttons, Settings and Staff clean-up

I ported Happi's general UX patterns into Cheer Bear and re-skinned them in her pink, rainbow and cloud look. Nothing
was copied that belongs only to Happi. Voice, calls, chat and the voice games all stay.

**Nothing here was tested on a real phone.** Everything below was checked in the Chromium simulator (Playwright with
swiftshader and the fake floor camera) at 390x844, 375x667 and 1440x900, and I looked at the screenshots.

## What was built

### 1. Top bar (`hud.ts`, `hud.css`)
- **Lockup:** a one-line lockup sits top left: `.cbx-lockup`. It is a white pill with the "Cheer Bear" line and a pink
  **AR** tag.
  - The art is `public/img/cb-lockup.webp` (295x63). It was cropped from the existing `cb-title.webp`, so it is not
    new art.
- **Phones:** two rows. The lockup is on the first. The mode tabs (with the sliding pill kept) and Menu share the second.
  - `--cbx-head` is 100px.
  - Menu is 54px (48px at 360px wide or less), using `.cbx-top .cbx-menu`.
- **700px and wider:** one 64px row. The tabs are centred at 420px wide.
- **The app follows:** `app.css` sets `--top-bar` to 104px, or 72px at 700px and wider.
- **The "Chat Time · 0 words found" chip is gone.** `GameChip` hides itself for `CHAT_TIME_ID`, so the chip shows only
  while a real word game runs.

### 2. Mode-switch covers
The iris disc now carries a colour for each destination, set by `data-to` on `.cbx-cover` (`--cv`, `--cv-ink`, `--cv-line`):

| Destination | Colour |
| --- | --- |
| 3D | sky |
| AR | pink |
| Selfie | yellow |
| Photo | purple |

- **Inside the cover:**
  - The hopping heart `heartHop()`: a flat heart that changes between 4 faces, on a sky ring with a flat 4-stripe
    rainbow.
  - Drifting clouds.
  - A large stroked title: "Switching to AR", or "Back to 3D".
  - The status line with dots.
- **Reduced motion:** a short crossfade. There is no hop, drift or iris.
- **Timing:** the iris timings that avoid flashes are kept. One change: `minOn` (the shortest time the cover stays
  closed) went from 460ms to **950ms** (220ms to 300ms under reduced motion).
  - Before the change, the coloured cover opened again before anyone could see it.
  - This adds about half a second to each switch. Lower it in `cover()` in `hud.ts` if that feels slow on a phone.

### 3. Splash (the full branded splash is kept: title art, hero bear, lead, Start, loading bar and the MEDIALIFE badge)
- **Background:** drifting clouds, plus 14 floating hearts and sparkles in `.sp-fx`. They are pure CSS
  transform/opacity and flat colours.
- **Title:** the title drops in, then floats.
- **Staged entrance:** the lead, Start and the badge rise in, one after another.
- **Ready state:** Start gets a breathing ring once it is ready.
- **Start burst:** tapping Start fires `burst()`, 18 particles that are removed after 1.3s. It is skipped under reduced
  motion.
- **Loading:** the loading state shows a small hopping heart.

### 4. Controls

**Bottom right**
- Actions (wand, white glass) and Games (pink) are stacked in `.cbx-dock`, over the talk mic's reserved corner
  (`--cbx-reserved`).
- The dock follows the play state, through the new `HudApi.dock?(show)`:
  - Shown in 3D when no game is running.
  - Shown in AR once she is placed and walking, outside the house, with no game.
  - Hidden while the talk orb is busy: a bubble, the mic explainer, a call, or hang-up. This uses CSS `:has()` on
    `.cb-app`, with `data-orb-busy` on `.cb-app` as the fallback.

**Bottom left:** Move and Reset are unchanged (camera-5's lane). They sit bottom left.

**Selfie and Photo**
- These modes have no dock. One compact **Actions** pill (`.cbx-act1`) sits bottom right, above camera-5's chip strip.
- In Selfie it uses `bottom: … + var(--cbx-strip-h, 0px)`.
- In Photo it sits higher (+56px) so it clears the one pill in `hud.above`.
- It never overlaps the shutter.

**Joystick**
- A pink glass base with a thin ring.
- A flat white arc that spins slowly (the shimmer), and pauses while held.
- A white thumb with a pink heart.
- No arrows. Reduced motion stops the arc.

**Speech bubble**
- It moves left of the dock when both are on screen.
- It lifts above the `hud.above` pill ("Step inside" and similar).

**Measured at 390x844 in AR:** Move (12,764), joystick (139,716), Actions (308,614), Games (308,684), mic (302,756).
Nothing overlaps. The same holds at 375 and 1440.

**How a dock tap reaches the app**
- A tap fires a cancelable `cbx:dock` CustomEvent (`detail: { kind: 'actions' | 'games' }`) on the experience box.
- The app (`App.tsx`) cancels the event and opens the conversation sheet on that tab.
- Without the app (`/experience-dev.html`), the experience falls back to its own sheets: `pickGame()` and a new
  `pickAction()` list of moments.

### 5. Clean-up
- **Staff view removed from the visitor app.** In `TalkPanel` the mode switch is Calm or Chat only. There is no staff
  bar and no staff-transcripts switch.
  - `call_debug` (saved prefs or the admin default) now maps to `chat`, in `prefs.ts` and `uiConfig.ts`.
  - The admin can still pick "Call debug" and transcript visibility, but the visitor app shows Chat.
- **Settings** now open from a gear in the sheet header. The header shows a Back arrow, and the tab bar is hidden while
  Settings is open.
  - Settings now holds only:
    - Tap to talk
    - Cheer Bear answers out loud
    - A short privacy note
    - Mic check
    - Show the welcome again
    - Keyboard shortcuts (on computers)
  - Removed from Settings:
    - The mode radio
    - Staff transcripts
    - "typing plays actions"
    - "my words start actions"
    - The magic-word list
    - Staff info
  - Those items are admin settings, and stay editable in `/admin`. The admin `settingsPanel` toggles for them no longer
    change the visitor app.
- **The sheet** has three tabs: **Talk / Actions / Games**. On phones, the Actions sheet closes after you tap an action,
  so you see it play.
- **TalkOrb:** the old "more" grid button next to the orb (`cb-more`) is gone, because the dock replaces it.
- **Welcome (version 2):**
  - Headline: "Talk to Cheer Bear and watch the magic happen."
  - Three items: Talk to her (Mic), Actions, Games.
  - The untouched round-1 stock welcome is replaced on load by `currentWelcome()`. A welcome the admin has edited is kept.
- **How it works** (menu) is rewritten and short: Talk to her, Actions / Games, 3D / AR, Selfie and Photo.
- **Open-on-phone text:** "The 3D view, talking and games work right here."

## Changes outside my folders (all small and additive)

| File | Change | Tell |
| --- | --- | --- |
| `src/app/components/TalkOrb.tsx` | `showMore = false`; the `cb-more` branch is removed (layout only) | voice-5 |
| `src/app/components/TalkPanel.tsx` | Staff removed (mode switch Calm/Chat, no staff bar or transcription selector) | voice-5 |
| `src/experience/modes/ar/index.ts` | `syncHud`: the gamesBtn block is replaced by one line, `hud.dock?.(walking && !this.inside && !this.game)` | camera-5 |
| `src/experience/modes/showcase/index.ts` | `syncPlay`: the gamesBtn block is replaced by `hud.dock?.(!g)` | |
| `src/experience/types.ts` | `HudApi.dock?(show: boolean \| 'actions')` (camera-5's shutter `hold` param is untouched) | |
| `src/experience/index.ts` | `onDock`, `pickAction`, `hud.dock(false)` before a switch, `'actions'` in face and photo | |
| `src/shared/config.ts` | The `DEFAULT_CONFIG.ui.welcome` copy and items (version 2) | |
| `src/admin/sections/UiSection.tsx` | Adds `Mic` to the admin welcome icon list | |
| `src/app/app.css` | `--top-bar` 104px, or 72px at 700px and wider | |
| `src/app/App.tsx` | `data-orb-busy`, and the `cbx:dock` listener that opens the sheet | |

I did not change `hud.ts` `shutter()`, `ShutterHold`, `engine.ts` `recorder.frame` or `capture.css` (all camera-5's).

## Contracts for the other lanes
- **`--cbx-strip-h`:** camera-5 sets it in px on the `.cbx` root, in Selfie only. My Actions pill reads
  `var(--cbx-strip-h, 0px)`. If the strip changes height, nothing else needs changing.
- **The right slot** (`hud.right`, `.cbx-slot-right`) now belongs to the dock and sits over the talk corner.
  - A future mini shutter in 3D or AR should go in `hud.left` or bottom centre, not `hud.right`.
- **`cbx:dock`:** if another surface wants the sheet, listen on the experience box and call `preventDefault()`.

## How to run the simulator checks
Start your own servers (see `common.md`), then run these from `docs/evidence/chrome-5/sim/`. They use
`../../ui-2/sim/mylib.cjs`.

```
BASE=http://localhost:<web> OUT=<dir> VIDEO=<scratch>/xr/floor.y4m W=390 H=844 MODES=1 IRIS=1 TAG=after node tour.cjs
BASE=… OUT=… VIDEO=… node ar.cjs           # AR placement (test-only settle), bottom-row overlap, Games→sheet, dock hidden in a call, programs
BASE=… OUT=… VIDEO=… [RM=1] node extra.cjs # speech bubble vs dock, dock hidden in Heart Run, cover frames per mode, reduced motion
```

- **Desktop:** use `W=1440 H=900 PHONE=0`.
- **Test-only overrides:**
  - `IRIS=1` slows the iris disc so the shots catch it mid-cover.
  - `ar.cjs` forces the floor "settled" check (`__cbx.internals.engine.wh.settled = () => true`).
  - Neither changes app code.

**Results:**
- No console errors in any run.
- Shader programs stay flat: 3D 38 → 38; AR 39 → 39 after placement, the dock and the sheet.

## Evidence (`docs/evidence/chrome-5/`)
- **Side by sides:** before and after at 390x844 for the splash, main 3D, the sheet tabs, Settings, the menu, the covers
  and the 4 modes.
- **Splash:** at iPhone 13 (390x844), iPhone SE (375x667) and desktop (1440x900).
- **Other frames:**
  - The AR bottom row.
  - The covers mid-switch.
  - The reduced-motion crossfade.
  - The speech bubble beside the dock.
  - Heart Run with no dock.

### Evidence files
- **Before and after at 390x844:**
  - The splash, welcome and showcase: `sbs-splash.jpg`, `sbs-welcome.jpg`, `sbs-mode-showcase.jpg`.
  - The sheet tabs and Settings: `sbs-sheet-{talk,actions,games,settings}.jpg`.
  - The menu: `sbs-menu.jpg`.
  - The mode switches: `sbs-switch-{ar,face,photo,showcase}.jpg`.
  - The modes: `sbs-mode-{ar,face,photo}.jpg`.
- **Splash:**
  - `splash-3-sizes.jpg`: iPhone 13, iPhone SE and desktop.
  - `splash-entrance-390.jpg`: the entrance frame and the ready frame.
- **Mode covers:**
  - `covers-mid-switch-390.jpg`: one frame per mode, mid-switch.
  - `covers-reduced-motion-390.jpg`: the reduced-motion crossfade.
- **Bottom row:** `bubble-dock-heartrun-390.jpg`. It shows the speech bubble beside the dock, Heart Run with no dock,
  the AR bottom row, and the dock hidden in a call.
  - The in-call frame was taken before the bubble lift, so her bubble still sits under "Step inside" there.
    `extra.cjs` checks the lift afterwards: the bubble overlaps nothing.
- **Other sizes:** `375-chrome.jpg` and `1440-chrome.jpg`.

## Open issues
- **Desktop AR in the simulator:** in the 1440x900 run (`PHONE=0`, `?desktop` forcing the camera), the AR switch ended
  on "The camera had a hiccup", then went back to 3D.
  - This is probably because the simulator gives a desktop no device motion. I did not investigate further (camera-5 owns this path).
  - Real computers get the open-on-phone QR instead. My changes do not touch this path.
- **Not tested on a real phone:** the feel of the hop and drift, the 950ms cover, and how the dock sits beside a real
  iOS home bar.
- **`:has()` needs iOS 15.4 or later.** On older iOS the dock still hides through `data-orb-busy`, but the speech-bubble
  shift and lift do not apply.
- **Leftovers to clean up later:** the old `gamesBtn` / `GAMES_ICON` code in `modes/showcase` and `modes/ar` is now
  unused. I left it alone to keep my edits small.
- **The admin `settingsPanel` toggles** and the "Call debug" mode still show in `/admin` but no longer change the
  visitor app. Remove them from the admin when convenient.
- **The Actions sheet's moments** come from the app's `ActionsPanel`. The fallback `pickAction()` lists `MOMENT_NAMES`
  only for the experience-only page.

## Findings for the immersive skill
1. **A colour-coded mode cover needs a minimum time closed (about 900ms or more).** Otherwise a fast mode opens the iris
   before the colour reads, and the transition looks like a flash. Use about 300ms under reduced motion.
2. **When a character UI has a talk orb in the bottom-right corner,** stack the secondary buttons (Actions and Games)
   over the orb's corner as a dock.
   - Hide the dock whenever the orb grows (bubble, call, hang-up) using
     `:has(.bubble, .hangup)`, with a `data-orb-busy` attribute as the fallback.
   - Do not move the orb.
3. **Experience-to-app routing:** fire a cancelable CustomEvent from the vanilla HUD. If the host app does not cancel it,
   use the HUD's own fallback sheet. This keeps the experience-only page working.
4. **A filled joystick thumb in the brand colour reads as a record button.** Use a white thumb with a brand icon on a
   tinted glass base, plus a flat spinning arc as the shimmer.
5. **Splash particles:** CSS-only flat hearts (two rotated rounded rects) and clip-path sparks with per-item CSS
   variables. They cost no shader programs and are easy to switch off under reduced motion.
