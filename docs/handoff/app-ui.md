# Handoff: app-ui

Owner folders: `src/app/`, `src/main.tsx`, `docs/evidence/app-ui/`.

The old app was one 131 KB `App.tsx` that talked to an iframe by `postMessage`. This replaces it with small React
components, a tiny store and one controller class that calls the typed APIs in `src/shared/contracts.ts`.

## Component map

```
main.tsx                    theme.css + base.css once, StrictMode, page ErrorBoundary, router
  /                         app/App.tsx
  /admin/*                  admin/AdminPage.tsx       (lazy, via import.meta.glob; "not ready" page if missing)
  /lab/lipsync              bear/lab/LipSyncLab.tsx   (lazy, same)
  *                         RoutePages.NotFound

App.tsx
  .cb-stage                 experience container (no z-index; the experience owns it)
  .cb-layer (z 40)          pointer-events: none except own controls; wrapped in a "layer" ErrorBoundary
    .cb-layer-stage
      GameChip              "2 of 4 words" + dots; tap = hints
      Toast                 role=status; "found" variant with flat rainbow stripes
      TalkOrb               call orb, bottom right, 72 px (+ hang-up / "more" button above it, MicExplainer)
    ConversationSheet       phone: bottom sheet (drag, snap half/full); >= 900 px: right sidebar
      TalkPanel             CallCard, ModeSwitch, CalmTips | MessageList + Composer
      ActionsPanel          quick actions -> fireTrigger(word, 'quick-action')
      GamesPanel            game picker, word chips, Hints, Start over
      SettingsPanel         mode, toggles, magic words (read only), welcome again, shortcuts, Staff info
  Overlays                  native <dialog>: Welcome, Hint, Completion, Keyboard shortcuts

controller.ts               AppController: boot, all wiring, every user action
state/store.ts              createStore + useStore (useSyncExternalStore, shallow selector compare)
state/appState.ts           the whole AppState shape
state/prefs.ts              localStorage prefs ('cb.app.prefs.v1'), safe wrapper
state/uiConfig.ts           AppConfig -> UiSettings (texts, flags, colours snapped to theme tokens, games...)
state/game.ts               pure game rules (decideTrigger, applyFound, resolveGameMode, ...)
loaders.ts                  loads experience / voice / audio unlock, with fallbacks
hooks/useShortcuts.ts       desktop keyboard shortcuts
hooks/useViewportVars.ts    visualViewport -> --cb-vvh, --cb-kb
dev/MockExperience.ts       stand-in experience (flat stage, CSS bear, fake HUD) for ?mock / missing module
dev/MockVoice.ts            scripted voice, plus UnavailableVoice and a local config client
```

## Wiring (controller.ts)

`boot(container)` loads the experience and voice modules in parallel, then:

| From | To |
|---|---|
| `voice.on('trigger')` | `decideTrigger` (game rules) -> `experience.trigger(keyword)` if it fires; action line in chat |
| `voice.on('remoteStream')` | `experience.setSpeechStream(stream)` (lip sync) |
| `voice.on('transcript')`, Cheer Bear, final | `experience.setSpeechText(text)` only when `transcriptsVisible(config, uiMode)`; cleared after `min(9 s, 2.5 s + 50 ms/char)` |
| `voice.on('status')` | call state; in-call -> `trigger('WakeUp')`, ended -> `endSpeech()` + `trigger('Sleep')` |
| `experience.on('started')` | opens the sheet (pref or device default), starts the game timer, schedules the welcome after `welcome.delayMs` |
| `experience.on('userGesture')` | audio unlock |
| `configClient.subscribe` | `applyConfig` (texts, flags, colours, keywords, games) |
| boot | `experience.setReservedCorner(88)` |

Every call tap runs `unlockAudio()` synchronously inside the gesture.

**Z-index contract:** the app layer is 40, and the experience container has no z-index. The experience HUD must stay below 40, and its full-screen sheets (menu, photo preview) must be at 60 or above. Modals use the top layer (`<dialog>`).

## Game rules (state/game.ts, matches PROJECT_GUIDE section 10)

- Only words that **Cheer Bear** says count. Typed text, quick actions and the user's own speech still play the reaction, but never count.
- While a game is on, a word Cheer Bear says that is not in that game is skipped. Staff view shows the reason ("skipped: not in this game").
- One and done: a found word does not fire again until reset.
- A game resets on Play again, on a game-mode change, and when the completion modal closes.
- Chat Time (`chat-time`), and any mode with an empty word list, uses all keywords.

## URL flags (dev and test)

| Flag | Effect |
|---|---|
| `?mock` | MockExperience + MockVoice (no network) |
| `?mockExperience` | MockExperience with the real voice module |
| `?mockVoice=fast,silent` | the real voice module's own demo mode |
| `?autostart` | the mock splash starts by itself |
| `?mockFast` / `?mockNoScript` / `?mockMicDenied` | MockVoice speed / no script / mic denied |
| `?showCorner` | outlines the reserved corner on the mock stage |

In DEV, `window.__cbApp` (controller) and `window.__cbMock` (mock logs, `voice.say()`) are exposed. Production never loads MockVoice. If the voice module fails there, the app uses UnavailableVoice, which gives a friendly "can't call right now".

## Real modules vs mocks (as of this handoff)

| Module | Status | Tested how |
|---|---|---|
| `src/voice` (session, configClient, demo mode) | landed | Real module in demo mode (`?mockExperience&mockVoice=fast,silent`). Game completed in 12.9 s; triggers, remoteStream, transcripts, status `code`/`mock` extras. `/api/config` loaded through the dev server. **No real Twilio/realtime call was made.** |
| `src/experience/index.ts` | **not landed** (only core, hud, scene, types) | Every run used MockExperience. The real `mount`, `trigger`, `setReservedCorner`, `setSpeechStream` and HUD layering are **untested**. |
| `src/audio` / bear `unlockAudio` | landed | Loaded and called; audible output not verified (headless). |
| `/admin`, `/lab/lipsync` | landed | Routes load with no page errors. |

**Not tested on a real phone.** Nothing here was run on iOS or Android hardware. Phone sizes were emulated in headless Chromium.

## Evidence (`docs/evidence/app-ui/`)

- `phone390-*`, `phone320-*`, `desktop-*` (01 to 15): welcome, idle, mic explainer, connecting, in call and speaking, sheet calm/chat/staff, settings, actions, games, game in progress, hints, completion, after Play again.
- `phone390-16` to `21`: call error, error sheet, real-voice demo call with in-scene caption, real-voice chat, input focused, reduced motion.
- `run-mockvoice-completed.jpg` and `run-realvoice-completed.jpg`: scripted game runs, both completed with zero console errors.
- `keyboard-*.jpg`: keyboard-only pass (mic explainer, shortcuts dialog, settings focus).
- `route-admin.jpg`, `route-lab.jpg`, `route-404.jpg`.

`npx tsc --noEmit` is clean for the whole repo at the time of writing.

## UX changes from the old app, and why

1. **One call orb (bottom right) plus one "more" button above it**, replacing the old orb menu and its separate overlays. Tap to call is the main job. The more button (only when idle or in error) reaches chat, games and settings without starting a call. During a call, a red hang-up button sits above the orb, and press-and-hold on the orb also ends the call.
2. **One panel for everything.** On phones it is a bottom sheet; on desktop it is a sidebar. Chat, actions, games and settings are tabs in it, replacing separate floating modals that covered the scene.
3. **A one-line microphone explainer before the browser prompt**, shown once. After a denial, a clear tip explains how to allow the mic.
4. **The transcript `chat_only` bug is fixed.** The old check returned false for every mode; it now means "chat mode only".
5. **Only Cheer Bear's speech counts in games**, so a child can't "win" by typing words. Typed words and quick actions still play the reaction.
6. **Users can no longer edit trigger keywords.** They are read-only "magic words". Admin settings became a read-only "Staff info" summary that links to `/admin`.
7. **Call debug is labelled "Staff"**, and partial transcripts and skipped triggers show only there.
8. **The call-mode toggle and `uiDelayMs` are dropped.** The UI waits for the experience's `started` event, then honours `welcome.delayMs`.
9. **Admin colours snap to the nearest theme token**, each with a fixed on-colour for contrast. No gradients, no free hex.
10. **Kid-friendly copy:** "Tap to call Cheer Bear", "One moment… she's still busy!", "You found 'Magic'!".
11. **Desktop keyboard shortcuts:** Ctrl/Cmd+K panel, Ctrl+/ settings, Ctrl+G games, `?` help, Esc closes.
12. **Accessibility and layout:**
    - 48 px+ targets, visible focus ring, live regions for call state and toasts.
    - Native `<dialog>` with focus return.
    - Reduced motion softens animation rather than freezing it.
    - Safe-area insets.
    - The sheet sits above the on-screen keyboard via `visualViewport`, so there is no layout shift.

## Open issues

- **Real experience is untested.** Once `src/experience/index.ts` lands, rerun `e2e.cjs` with `?mockVoice=fast,silent` and without `?mock`, and check the HUD z-index against the contract above.
- **Speaking detection uses transcripts only** (900 ms after a final, 1.6 s after a partial), so the orb pulse can lag the audio.
- **Desktop sidebar resize:** the app dispatches a `resize` event after the sidebar toggles. The experience should use a `ResizeObserver` on its container instead.
- **The hang-up button sits above the 88 px reserved corner** (it is inside the app's own column, not over the shutter/joystick/Move). Worth a look on the real HUD.
- **`fireTrigger` is assumed to emit `trigger`** back through the voice emitter. This is confirmed with the real voice module.
- **Default config texts** ("Start Call", "Cheer Bear AI") come from `DEFAULT_CONFIG` and are owned by server-voice/admin.
- **No real-phone testing:** keyboard open, iOS Safari audio unlock, and mic permission prompts are all untested.
- **After the welcome closes, focus goes to `body`**, because there is no invoker. It is harmless, but the first Tab starts from the top.

## Requests to other owners

- **xr-core / experience:**
  - Keep the HUD below z 40 and full-screen sheets at 60 or above.
  - Use a `ResizeObserver` on the container.
  - Ideally add a `speaking` (audio level) event so the orb pulse follows the real voice.
- **admin-ui:** offer theme tokens (not free colour pickers) for brand colours, since the app snaps to tokens anyway.
- **server-voice:** review the default texts in `DEFAULT_CONFIG` (for example, use "Call Cheer Bear" instead of "Start Call").
