# Handoff: voice-3 (voice mode: hold to talk, no call, no Twilio, no AI)

Dapo's ask: "Can we have just a voice mode where we can hold on the mic button and speak our actions or control
things and say the trigger words for things to happen? ... we don't need any AI or anything like that."

Done. With no call live, the main round talk button (bottom right) is now a **mic**: hold it, say what should happen,
let go. Trigger words fire as soon as they are heard; "AR", "selfie", "take a picture", "place", "move", "play heart
run"... do the thing; Cheer Bear answers with a short canned line in the browser's voice. Calling still works from
the Talk tab ("Call Cheer Bear", also the demo call); during a call the round button is the call button as before.
The right-hand column is only the mic and the panel button (follow-up 1: the separate phone button is gone).

**Nothing here was tested on a real phone, with real speech recognition, or with a real microphone.** Every browser
check used headless Chromium with `SpeechRecognition` replaced by a fake (headless Chromium has none that works) and
Chromium's fake audio device for the level meter.

**Honest privacy note (also in Settings, for parents):** this is not on-device. The browser's Web Speech API does the
listening: Chrome sends the audio to Google's speech service, Safari to Apple's (free, no key). Nothing goes to our
server and no AI of ours is involved; the matching of words to actions is local code. Firefox and some in-app
browsers have no speech recognition: there the button opens the magic-word buttons instead.

## What it does (the kid's view)

| You | What happens |
|---|---|
| First visit | "Hold to talk" sits right above the mic, its tail pointing at it; the panel button above the mic waits until you have said something (or 12 s) so nothing sits between them |
| Hold the pink mic | It grows, turns white with a pink mic, a light haptic tick; two pink rings follow your voice level; a white bubble above shows your words live with a red dot |
| Say "rainbow" (while still holding) | The rainbow starts at once (interim result), once per hold |
| Let go | Camera things you said run now (the release is the tap the camera needs); one canned answer from her ("Ooh, look up!") in her speech bubble + voice |
| Quick tap | "Hold me while you talk!" |
| Say something it doesn't know | "Hmm! Try saying:" + 3 chips (two magic words from the live config + "Go to AR"/"Go to 3D"); tapping a chip runs it |
| Hold, but say nothing | "I didn't hear you. Hold me and talk!" |
| Browser can't listen / mic blocked | The button shows sparkles and opens the Actions tab with "This browser can't hear you, so tap a magic word instead!" (never a dead button) |
| Keyboard | Focus the button, hold Space or Enter |
| Can't hold (motor needs) | Settings > "Tap to talk": tap to start, tap to stop (also stops by itself ~0.9 s after a finished phrase, 9 s max) |

### What you can say (`src/voice/commands.ts`, pure, local)
- **Every trigger word and its synonyms from the live config** (`localClassifier.keywords` / `synonyms` /
  `morphologyEnabled`), plus a plural; an admin's new word works by voice at once. They go through the call's own
  `TriggerPipeline` (`voice.voiceMode.fireTrigger` -> `pipeline.fire(keyword, 'user', 'local')`): cooldown, dispatch
  spacing, the app's word-game rules ("user" triggers play but don't count, same as before) and the chat action log.
- **Modes:** "3D" / "three D" / "3-D" / "back to 3D"; "AR" / "a r" / "A.R." / "augmented reality" / "put her in my
  room"; "selfie"; "3D photo" / "photo mode" / "go to photo" (always switch). "Take a selfie" / "take a 3D photo"
  switch there, or shoot when already there.
- **Bare "photo" / "picture"** (follow-up 2): where the screen has a shutter (Selfie, 3D Photo, and AR as soon as it
  shows one: `ExperienceApi.canCommand('capture')`) it takes the photo; elsewhere (3D, AR today) it opens 3D Photo.
  It waits for the next words or the release, so "photo mode" never also presses the shutter.
  (`resolveCapture()` in `src/voice/commands.ts`, unit tested; the app mirrors it in `src/app/voiceMode.ts`.)
- **Camera:** "take a picture/photo/pic", "cheese", "say cheese" -> shutter (in 3D/AR it takes you to Selfie, where
  the shutter is); "place" / "put her here" -> Place; "move" (alone) / "move her" -> Move.
- **Games:** "play heart run" (also "hard run", "art run"), "play heart hoops" / "basketball", "stop the game" /
  "stop", "pause", "keep going" / "resume", "again" / "play again" / "one more time" (no game over: repeats your last
  magic word).
- **Fun:** "hello" / "hi Cheer Bear" (only at the start of what you say) -> Wave; "I love you" / "give me a hug" ->
  the long-press hug (3D, placed AR; elsewhere a wave).
- Robustness: lower case, punctuation stripped, number words, "share bear"/"cheer bare"/"chair bear" -> cheer bear,
  "rain bow", "selfy". **Whole words only** ("rain" never fires Rainbow, "dancer" never Dance, "are" is not AR).
  "don't dance" / "stop dancing" / "no rainbow" fire nothing. Overlaps: the longest reading wins ("play heart run" is
  the game, not Running; "a magic horse" can be an admin's Unicorn synonym, not Magic); same length: built-in
  commands beat trigger words. A match on the last word of an interim result waits for the next result when that word
  is under 4 letters ("hi" may become "hide", "ar" -> "art"); the release accepts it.

### Camera modes need a gesture: how that is handled
Interim matches for camera modes and the shutter are queued and run **inside the pointerup / keyup handler**
(`VoiceMode.release()` hands over "what was said so far" synchronously, then the app runs it). A camera command heard
only in the final words (after the release) runs if `navigator.userActivation.isActive` is still true (Chrome keeps
it ~5 s); otherwise a white bubble "Ready for AR?" with a **"Tap to open the camera"** chip asks for one more tap.
Not verified on iOS: whether iOS counts the pointerup of a long press as activation for `DeviceMotionEvent.requestPermission`
(AR still starts without motion permission on Android; on iOS the experience's own flow applies).

### She answers (no AI) (`src/voice/voiceReplies.ts`)
One short line per hold for the first command (e.g. House -> "Come and see where I live!", AR -> "Let me visit your
room!", capture -> "Smile!"), spoken with the existing browser voice + text visemes (`DemoBear.say`), shown in her
speech bubble and the chat. **No line contains a trigger word**: each is checked against the LIVE keyword config
(with and without morphology) before use (an admin adding "Look" just skips lines containing it), and the session
also claims every keyword on her line's transcript id. Spoken only after the hold ends (her voice is never heard by
the recognizer). On by default; Settings > "Cheer Bear answers out loud"; admin default `voiceMode.spokenReplies`.

## Files

```
src/voice/commands.ts        matcher + CommandTracker (one hold: each command once, interim short-word rule)
src/voice/voiceReplies.ts    canned answers, live-config safe
src/voice/holdToTalk.ts      HoldListener (recognition per press: continuous + interim, stop on release, 1.5 s final
                             wait, 15 s max, tap-to-talk auto stop) + MicMeter (getUserMedia analyser; if the meter
                             and recognition fight over the mic (audio-capture) the meter is dropped; no meter -> the
                             ring pulses per word)
src/voice/voiceMode.ts       VoiceMode: listener + tracker + events (state, text, level, commands{phase}, done)
src/voice/session.ts         `voiceMode` getter (lazy) on VoiceSessionExt; DemoBear.say for her lines
src/voice/demoBear.ts        + say(text, { chat, claimed })
src/voice/triggerPipeline.ts fire(keyword, speaker, via = 'manual') (via added, default unchanged)
src/voice/speechInput.ts     RecognitionLike.onaudiostart? (optional, additive)
src/voice/index.ts           exports the voice mode types + matchVoiceCommands
src/shared/config.ts         `voiceMode: { enabled: true, holdToTalk: true, spokenReplies: true }` (validated; old
                             stored configs get the defaults; a bad stored section falls back alone)
scripts/check-voice-commands.ts  23 checks (matcher, tracker, replies vs keywords, HoldListener/VoiceMode with a fake
                             recognition); run by `npm run test:server` via one import line in check-voice-logic.ts
scripts/check-config.ts      + voiceMode check
```

## Changes outside src/voice (small, additive; please review)
- `src/shared/contracts.ts`: `ExperienceCommand` gains `'hug'`; `ExperienceApi.canCommand?(name)` (optional, new in
  the follow-up: "would this command do something right now", e.g. a usable shutter on screen; runs nothing).
- `src/experience/index.ts` (xr-core / games-3): one import + a 4-line `command()` that delegates to
  `src/experience/commands.ts` (new), plus `canCommand()` (same file's `modeCanCommand`: finds the usable button,
  never clicks). It asks the active mode's optional `command(name)` first (games-3: implement
  `pause` / `resume` / `again` there or extend `runModeCommand`), else **presses the mode's own button**: `.cbx-shutter`
  for capture, `[data-cmd="place"|"move"]` for Place / Move (hidden or disabled = false, nothing happens), and `hug`
  calls `hugBear()` on the showcase / placed-AR stage.
- `src/experience/types.ts`: `Mode.command?(name)` (optional).
- `src/experience/modes/ar/index.ts`, `modes/photo/index.ts`: one line each tagging Place / Move with `data-cmd`.
- `src/app/` (app-ui): `voiceMode.ts` (new: the app side, press/release/click, dispatch, bubbles, gesture rule),
  `components/VoiceCard.tsx` (new: Talk tab "Hold to talk" + examples + "Call Cheer Bear"), `TalkOrb.tsx` (voice
  state, hold/keyboard handlers, level rings, bubble + `useClearOfControls`, first-time nudge; call states unchanged), `TalkPanel.tsx` (VoiceCard
  instead of the big call card when no call is live; calm tips text), `SettingsPanel.tsx` ("Talking to Cheer Bear":
  Tap to talk, answers out loud, the privacy line), `controller.ts` (creates `voiceUi`, `callsAvailable`, cancels a
  hold when a call starts), `state/appState.ts`, `state/prefs.ts` (`tapToTalk`, `spokenReplies`, `voiceNudgeDone`),
  `state/uiConfig.ts` (`ui.voiceMode`), `app.css` (voice section, `.cb-voicecard`, `.cb-vbubble`; `.cb-orb` long-press rules).
- `src/admin/sections/AdvancedSection.tsx`: labels/hints for `voiceMode` (it shows under "Other settings").

## Layout decisions / push-back
- **House rules kept:** the right column is the mic + the panel button only (never toward the centre). Move stays
  bottom left, the shutter / joystick bottom centre. No gradients.
- **The voice bubble never covers a control (follow-up 3):** CSS puts it 146 px above the dock (clear of the joystick
  / shutter); `TalkOrb`'s `useClearOfControls` then measures the experience's bottom controls that sit under the
  bubble horizontally (`.cbx-bottom button, .cbx-stick, .cbx-shutter, [data-cmd], .cbx-above button`) and lifts the
  bubble 12 px above the highest one, re-checked every 400 ms while it shows (controls come and go). This matters in
  AR placing on small phones, where the wide "Try saying" bubble reaches over the left stack (Move / Games). The sim
  checks the live caption and the chips while placing in AR at 375x667 and 390x844 (rect overlap with every control).
- **Follow-up 1 (6-year-old):** the separate phone button is gone; calling is the Talk tab's "Call Cheer Bear".
  The first-time nudge says "Hold to talk" right above the mic with its tail on it; to keep the panel button from
  sitting between them, the panel button appears once the child has said something (or after 12 s).
- **Follow-up 4 (iOS long press):** `.cb-orb` (all states) and `.cb-holdbtn`: `-webkit-touch-callout: none`,
  `user-select: none`, `touch-action: none`; `contextmenu` is prevented on the orb in every state and on the Talk
  tab's hold button.
- **Push-back:** the phone bottom sheet covers the mic, so the Talk tab has its own big "Hold to talk" button. On
  desktop the mic stays visible beside the open sidebar in voice mode.

## How to run / test
```bash
npm run test:server        # ... voice commands: 23 passed (plus config 16 with the voiceMode check)
npx tsc --noEmit           # clean for these files
API_PORT=6201 npx tsx scripts/dev-api.ts &
API_PROXY=http://127.0.0.1:6201 SIM_PORT=5201 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
cd docs/evidence/voice-3/sim
BASE=http://localhost:5201 OUT=<dir> VIDEO=<floor.y4m> NODE_PATH=$(npm root -g) node voice.cjs phone   # or desktop
```
`voice.cjs` injects a fake `SpeechRecognition` (`window.__say(text)` drives interim results; `stop()` delivers the
final) and checks: idle nudge; quick tap hint; interim "rainbow" fires Rainbow before release and exactly once in
total; her canned answer has no trigger word; unknown speech chips + a chip works; keyboard Space hold; "go to AR" ->
AR; "selfie" -> Selfie; "take a picture" in Selfie -> a photo; chip "go to 3d" -> 3D; Settings switches; tap-to-talk;
no console errors; unsupported browser -> sparkles button opens the Actions tab with the friendly toast; no phone
button in the column; the Talk tab's "Call Cheer Bear" starts the demo call, the orb becomes the call orb, and after
hanging up it is a mic again; bare "photo" in Selfie takes a photo and in 3D opens 3D Photo; in AR placing (390x844
and a second boot at 375x667) the live caption and the "Try saying" chips overlap no control (rect test against
Place, Move, tools, shutter, joystick, the panel / hang-up buttons and the mic), plus, at 375x667, with a stand-in
Move / Leave / Games stack bottom left (the fake floor never lets her be placed) the chips lift above it.

## Simulator results (2026-11-19, after the orchestrator's follow-ups 1-4)
Run with the sim above against my own dev servers (fake `SpeechRecognition` that speaks scripted interim/final
results; real app, real experience, software GL; fake camera video).

- **Phone 390x844 (+ a second boot at 375x667): 30/30 PASS.** First-time "Hold to talk" sits right above the mic
  with nothing between (no panel button yet, no phone button), and the panel button is back after the first words;
  quick-tap hint; interim "rainbow" fires while still holding and exactly once; a canned reply with no trigger word;
  unknown speech -> "Try saying" + 3 chips, a chip runs; hold Space; "go to AR" -> AR; in AR placing at 390x844 and
  375x667 the live caption and the chips overlap no control, and with a stand-in Move / Leave / Games stack at
  375x667 the chips lift from 162 px to 240 px above the bottom, clear of it; "selfie" -> Selfie; "take a picture"
  captures; bare "photo" in Selfie captures and stays; "go to 3D"; bare "photo" in 3D opens 3D Photo; Settings
  switches; tap-to-talk; no console errors; unsupported browser -> Actions tab + friendly toast; the Talk tab's
  "Call Cheer Bear" starts the demo call, the orb is the call orb, after hanging up a mic again.
- **Desktop 1440x900: 20/20 PASS.** Same flows minus the camera checks ("go to AR" and bare "photo" in 3D only
  checked as the mode request: real desktop visitors get the open-on-phone QR).
- Not reached in the sim: a real placed-AR state (the fake floor never gives the reticle a hit, so Place stays
  "Getting ready…"); the lifted-bubble case uses stand-in HUD tools of the real size and class.

Evidence (looked at each): `docs/evidence/voice-3/phone-01..13-*.jpg` (idle "Hold to talk", holding caption, after
rainbow, unknown chips, AR by voice, selfie captured, settings, talk tab, unsupported idle + fallback, Talk tab call
button, in call, 3D Photo by voice), `phone-ar-390-844-*` / `phone-ar-375-667-*` (caption, chips, chips lifted over a
tool stack) and `desktop-01..04, 07..12-*.jpg`.

## NOT verified (needs real devices)
1. Real recognition: Chrome Android/desktop and iOS Safari, children's voices, interim result timing (how fast
   "rainbow" really fires), whether Chrome Android plays its start/stop beeps on every hold, and whether iOS keeps
   `interimResults` working.
2. Mic meter + recognition at the same time (Android Chrome may refuse a second capture: then recognition errors
   `audio-capture` once, the meter is dropped for the session and the ring pulses per word instead; that first hold
   says "Oops! Hold me and try again."). iOS: opening the mic may route her reply to the earpiece or duck it.
3. Permission prompts during a hold: the first hold shows the browser's mic prompt; letting go to tap Allow ends that
   hold ("Now hold me and talk!"). Fine in the sim (permission auto-granted), unverified on devices.
4. Camera start from the release gesture on iOS (motion permission) and the "Tap to open the camera" fallback.
5. Long-press side effects on iOS (callout / selection off with CSS, `touch-action: none`, `contextmenu` prevented).

## Findings worth adding to the immersive skill
- Push-to-talk on the web: start `SpeechRecognition` (continuous + interim) on pointerdown, `setPointerCapture` so a
  drifting finger doesn't end it, `touch-action: none`; stop on pointerup and wait ~1.5 s for the final; treat < 250 ms
  as a tap and show "hold" help instead of listening.
- Fire on interim results for speed, dedupe per hold by command id; hold back a match on a short last word (< 4
  letters) until the next result or the release ("hi" -> "hide", "ar" -> "art").
- Camera-start commands said by voice: run them inside the release handler (a real user gesture); after that, gate on
  `navigator.userActivation.isActive` and fall back to a one-tap chip.
- Canned character replies must be validated against the live keyword list at runtime and claimed on the trigger
  pipeline, or an admin's new keyword can make her own answer fire a moment.
- Never a dead button: no recognition (Firefox, in-app browsers) or a blocked mic -> the button opens tap-able
  actions with one friendly line.
