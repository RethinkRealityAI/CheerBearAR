# Handoff: ui-2 (round 2 UI polish: mode switcher, HUD, app layer)

Dapo's note: "slick and pretty good" already; make it a bit better and slicker, **especially the mode switcher**. Same product,
more premium. Everything below was checked in the headless simulator (Chromium + swiftshader). **Nothing was tested on a
real phone.**

## What changed

### Tokens (`src/shared/theme.css`, additive; old names still work)
- One radius scale `--cb-r-xs/sm/md/lg/xl/pill` (`--cb-radius`, `--cb-radius-sm` now alias it).
- One shadow style `--cb-shadow-1/2/3` (soft, ink-tinted), `--cb-focus` ring.
- One motion set: `--cb-ease` (out), `--cb-ease-in`, `--cb-ease-io`, `--cb-ease-spring` (small overshoot),
  `--cb-dur-1..4` (120 / 220 / 380 / 560 ms). Reduced motion: no overshoot, shorter durations (soften, never freeze).
- Fredoka weights `--cb-w-body 450 / label 560 / strong 640 / heavy 700`.
- Glass and fills: `--cb-glass-hint*` (the shared hint look), `--cb-scrim`, `--cb-on-glass-soft`, `--cb-fill-1..3`.
- Still no gradients anywhere.

### Mode switcher (`src/experience/hud/hud.ts`, `hud.css`)
- `role="tablist"` with `role="tab"` buttons, `aria-selected`, roving `tabindex`. Arrow keys / Home / End move focus,
  Enter / Space switch (manual activation, because each switch may start a camera). Visible focus ring on both the
  pill and the other tabs.
- **One sliding white pill** behind the tabs, moved only by `transform` from a CSS variable `--i` (no measuring, no
  layout), springing with `--cb-ease-spring` plus a short "jelly" squish as it lands.
- Icon + label on every tab. When the switcher is narrower than 300 px (all phones), a container query stacks icon over
  label. It fits at 320 px. Desktop shows icon and label side by side.
- **Switching state:** while the camera starts, the pill breathes and a thin ring pulses out of it (no spinner). Other
  tabs get `aria-disabled` (not `disabled`, so keyboard focus is not lost). A tap during a switch is remembered (small
  dot under the tab), and **the last tap wins** once the switch ends. The haptic tick is `navigator.vibrate(8)`, in a
  try block.
- Hover state (pointer devices) and a pressed icon squash.
- `data-mode` attributes and `.cbx-switch [data-mode=…]` selectors stay, so the existing sim scripts still work.

### Mode change transition
- `hud.cover(text)` is now a **flat pink iris**: one disc, scaled with `transform` only, grows from the tapped tab. The
  target mode's icon sits in a white badge that breathes, with the cover text below it. `cover(null)` fades the cover
  off the new view. A fast swap still gets the whole wipe (the cover stays up at least ~0.46 s). Reduced motion gets a
  plain crossfade.
- While the cover is up, the top bar stays above it (the busy switcher stays visible) and the rest of the HUD fades out.
- `cover()` now returns a `Promise` that resolves when the old view is fully covered (it is never cancelled).
- **Change outside my folders:** in `src/experience/index.ts` `switchTo()`, one line became
  `if (from) await hud.cover(...)`. Without the await, the old 3D canvas was torn down before the iris covered it, so
  a flat sky flashed. This adds about 0.35 s to each switch. To revert, drop the `await`.

### Rest of the HUD
- **Hint pill:** the same white-on-black-glass look. It rises and fades in; a text change makes it lift out and rise
  back in. It slides down (transform only) by `--cb-top-reserve` when the app's chip or toast is under the top bar.
- **Speech bubble:** a white bubble with a small pink "CHEER BEAR" name and a tail pointing up at her. The words reveal
  one by one. If new text continues what is showing (a growing transcript), only the new words animate; a grown
  partial word is replaced in place. Long speech keeps the latest ~24 words. Screen readers get the plain text in a
  hidden live region; the animated words are `aria-hidden`.
- **HUD toast** ("Placed!"): a white chip that springs in.
- **Bottom controls** share one look: glass, `--cb-shadow-1`, the same press scale, and focus rings. Joystick: the
  white four-way knob stays; it now has a shadow, springs home on release, and the ring brightens while you hold it.
  Shutter: a subtle edge so it reads on white scenes. Place pill: the same 3D press as Start.
- **Splash:** the layout is unchanged. The title floats in once. Start pops when it becomes ready, lifts on hover, and
  presses down; the loading bar eases and fades away. On the white card the focus ring is ink.
- **Sheets** (menu, QR, errors, licences) are now at **z-index 60** (they were 40, under the app layer, which broke
  the z-index contract). The scrim is a token, the corners use the radius scale, and the sheet entrance springs.

### App layer (`src/app`)
- **Top slot** (`App.tsx` `TopSlot`): the game chip and toast measure themselves with a ResizeObserver and set
  `--cb-top-reserve` on `<html>`, so the experience's hint pill always slides below them. GameChip no longer sets a fixed
  50 px. `--top-bar` is now 72 px, because the switcher is taller.
- **Toasts:** a compact chip under the top bar that springs in and shrinks away (exit animation kept for 260 ms).
  "You found …": a pink chip with a white sparkle badge and a one-shot burst of six flat rainbow dots.
- **Talk orb:** the visuals moved to `.cb-orb-face`, so rings can sit behind it.
  - Idle: a slow breath.
  - Calling / ringing: ripples and a wiggling phone (no spinner).
  - In call: green.
  - **Speaking:** two rings follow her **voice level**.
  - Error: one shake and a red ring.

  The level comes from `src/app/state/voiceLevel.ts` (new): an analyser on the remote stream, or else the viseme
  `amplitude`. It runs only while the orb is subscribed, writes styles from rAF, and causes no React renders. If there
  is no level, the old CSS pulse is used.
- **Nudge bubble** ("Tap to call Cheer Bear") now sits above the panel button, clear of the joystick. It shows only in
  the 3D view and never while her caption is showing. The new store flag `captionOn` is set in the controller next to
  `setSpeechText`.
- **Chat:** works like a modern messenger.
  - Her bubbles are white on the left, with her avatar on the last bubble of a group; yours are on the right in the
    primary colour.
  - Corners join inside a group; new lines pop in from their side (only lines that arrive after the list mounts).
  - A **typing indicator** (three dots in her bubble) shows while her words stream in, or for up to 12 s after you say
    or type something during a call. It only shows when her answer will actually appear in the chat.
  - The composer is one white pill with an inset send button.
- **Sheet:** the tabs and the "Just talk / Chat" control use the same sliding pill as the switcher. Quick actions are
  chips. Games are cards with an icon, a meta tag and a check badge. Panels fade up when you switch tabs. Buttons get
  a 3D press.
- **Welcome and other dialogs:** a spring entrance and a fading backdrop. On the welcome dialog the badge pops and the
  items stagger in. The radius and shadow tokens are used throughout.
- **Change to dev-only code:** `src/app/dev/MockVoice.ts` (the fallback when the voice module fails to load) now emits
  `remoteStream: null` and fake viseme frames. Its old empty MediaStream made the bear's lip sync throw
  `createMediaStreamSource … no audio track`.

## Run / test

```bash
API_PORT=6193 npx tsx scripts/dev-api.ts &
API_PROXY=http://127.0.0.1:6193 SIM_PORT=5193 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
cd docs/evidence/ui-2/sim
BASE=http://localhost:5193 OUT=<dir> node tour.cjs                 # splash, welcome, main, hint+toast, speech, sheet, call
BASE=… OUT=… W=375 H=667 node tour.cjs ;  BASE=… OUT=… W=1440 H=900 PHONE=0 node tour.cjs
BASE=… OUT=… VIDEO=<floor.y4m> MODES=1 node tour.cjs               # 3D -> AR -> Selfie -> Photo -> 3D -> AR -> 3D
BASE=… OUT=… VIDEO=<floor.y4m> node iris.cjs                       # cover, rapid taps (last wins), back-and-forth, keyboard
BASE=… OUT=… node chat.cjs ; node orb.cjs ; RM=1 node fps.cjs      # chat/typing/tabs, orb states + voice level, fps + reduced motion
```
`mylib.cjs` adds a `start()` helper. In dev, StrictMode boots the app twice, so `window.__cbx` can point at the disposed
instance; the helper uses `window.__cbApp.experience` and clicks Start until the experience has started.

## Simulator results (2026-11-19)
- 390x844, 375x667 and 1440x900: every tour ran with **zero console errors**.
- Every mode was reachable through the switcher with the fake floor camera (`?desktop`).
- Rapid taps (Selfie → Photo → 3D within 120 ms): the queue showed `showcase` and the switch ended in 3D.
- Three AR ↔ 3D back-and-forths ended clean.
- Keyboard: focus the selected tab, press ArrowRight then Enter → AR. Focus stays on the tab, and `tabindex` is roving.
- Toast and hint shown together: the hint slides below the toast and chip, with no overlap.
- The talk orb follows the voice level (wave scale up to about 1.5 while she talks, with the voice module's demo
  visemes).
- Typing dots show, then her streamed reply bubble replaces them.
- FPS in 3D (swiftshader): 11 to 13 with the HUD and app layer visible, against 10 with both hidden, so the UI costs
  nothing measurable. Nothing animates constantly over the canvas except the orb's idle ring, which is
  transform/opacity on a non-blurred element. No backdrop-filter element animates while idle.
- Reduced motion: crossfade cover, no overshoot, the hint and toast still appear, nothing frozen.

Evidence: `docs/evidence/ui-2/` holds side-by-sides (`switcher-before-after`, `main-before-after-390`,
`toast-hint-before-after-390`, `sheet-before-after-390`, `chat-before-after-390`), plus `modes-switching-390`,
`mode-cover-sequence-390`, `talk-orb-states`, `chat-typing-390`, `iphone-se-375x667`, `desktop-1440x900`,
`desktop-topbar-zoom`, `reduced-motion-390`, and single after-shots.

## Untested / open
- **No real phone.** Not tested on hardware: the spring timings, the haptic tick, the container-query switcher on iOS
  Safari (iOS 16+ needed; older iOS falls back to the horizontal layout), the analyser on a real Twilio remote stream
  (Chrome may give silence for WebRTC streams not attached to a media element; the orb then falls back to the CSS
  pulse), and safe areas on notched phones.
- I could not catch the iris mid-growth in a screenshot: swiftshader screenshots take longer than the animation. I saw
  the full cover, the busy switcher and the fade. When playback was slowed with CDP, the JS timers still ran at full
  speed, so that capture is not representative either.
- If her caption shows while no call is on (a test-only case), the nudge can sit beside the speech bubble at 375 px.
  The real flow sets `captionOn` and hides the nudge.
- `showcasePrograms` read 21 in the fps run; xr-core's handoff said 17. The difference comes from other workers'
  scene changes, not from the UI.

## Findings for the immersive skill
1. **Sliding selection pill with zero measuring:** equal grid columns plus an absolutely positioned pill
   `width: calc((100% - 2*pad) / n)` and `transform: translateX(calc(var(--i) * 100%))`. Set `--i` from JS; the
   transform transition gives 60 fps with no layout.
2. **Mode-change iris:** scale ONE big disc (`2R` square, `border-radius: 50%`, centred on the tap) from 0.001 to 1.
   It stays on the compositor, unlike `clip-path`. Await the cover before tearing down the old renderer, or the empty
   background flashes. Keep a minimum on-time so fast swaps still read as a complete wipe.
3. Keep the top bar above the mode cover (raise the HUD only while covering), so the busy switcher stays visible.
4. Use `aria-disabled`, not `disabled`, on tabs during a busy switch, so keyboard focus is not lost.
5. Drive "voice level" rings from a rAF subscriber that writes `style.transform` directly. Never put a 60 Hz value in
   React state.
6. Under heavy CPU load, `page.waitForFunction` sometimes stalled; a `page.evaluate` polling loop was reliable. In
   dev, StrictMode creates two experiences: use the one the app holds.
