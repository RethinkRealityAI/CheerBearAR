# Handoff: voice-4 ("when pressing and holding the mic, it says it can't hear me")

Dapo's phone test (round 3): *"The only issue I'm having is that, when pressing and holding the mic, it says it can't
hear me, so my audio is not transmitting through for some reason."* His phone/browser is not known yet.

**Nothing here was tested on a real phone, with real speech recognition or a real microphone.** Every browser check
used headless Chromium with `SpeechRecognition` replaced by a fake whose behaviour each scenario sets (headless
Chromium has no working recognition), Chromium's fake audio device and a faked Permissions API. The cause ranking
below is reasoning from the code plus public reports, not a reproduction on Dapo's device. The new **Mic check**
view exists so his phone can tell us the real answer.

## What to ask Dapo (once this is deployed)

1. Open `https://cheer-bear-ar.netlify.app/?voicediag`, tap Start. The Mic check opens (also: menu > Settings >
   "Mic check", a small link under "Talking to Cheer Bear").
2. Hold **Hold and talk**, say "rainbow", let go. Then tick **Level meter** (the old round-3 behaviour) and do it again.
3. Close it, hold the real mic button once or twice as normal, reopen Mic check (Settings), tap **Copy log** (or
   Share) and paste it to us. The log has his browser, permission, every recognition event with timestamps, and the
   exact error code of each hold (app holds and test holds).

## Every path to a "can't hear you" message (round 3 code), and the real-world causes

Round 3 had two messages with "hear" in them:
- **"I didn't hear you. Hold me and talk!"** (`app/voiceMode.ts onDone`): recognition reported `start` but no words
  came before the end of the hold. Paths: the recogniser heard silence; it ended by itself while the button was still
  held (`end` before release -> `no-speech`, shown while still holding); `no-speech` error; the final arrived more than
  1.5 s after release (the wait timed out with no text); `aborted`.
- **"This browser can't hear you, so tap a magic word instead!"** (toast, Actions tab opens, button turns to
  sparkles): no `SpeechRecognition` (Firefox, some in-app browsers), the constructor threw, or
  `language-not-supported`.
Others: "Oops! Hold me and try again." (`audio-capture`, `network`, other codes), "Your microphone is off..."
(`not-allowed` and `service-not-allowed`, both blocked the button for the whole session), "Now hold me and talk!"
(let go before the mic opened, e.g. the permission prompt).

### Likely cause ranking for Dapo's report
1. **The level meter's second microphone stream (most likely; Android Chrome / Samsung Internet; iOS too).** Round 3
   opened `getUserMedia({audio})` for the ring's level meter the moment recognition fired `start`. On Android the
   page's capture and the speech service's capture compete for the one microphone; the recogniser then gets silence
   (no results -> "I didn't hear you" on *every* hold, which matches "my audio is not transmitting"), or
   `audio-capture`. Reports: Android Chrome "only whichever started first could use the microphone" and "when the
   recognition was working, the recording was just a quiet file" [1][2]; on iOS "getUserMedia() and SpeechRecognition
   are treated as separate microphone sessions; one may block the other" (Jan 2026) [3]. Round 3's handoff already
   listed this as unverified (its fallback only reacted to `audio-capture`, not to silent failure). **Fixed: no
   second stream at all**; the ring follows recognition's own events.
2. **Android ends recognition after a short silence even in continuous mode** ("the microphone shows only for 1 or 2
   seconds; if there is no voice activity it turns off" [4]). A child who presses, waits for the beep / thinks, then
   talks got "I didn't hear you" while still holding. **Fixed: restart a fresh recogniser while held**, keep the words.
3. **Recognisers with no interim results and late finals** (some Android / Samsung speech services give only a final,
   after `stop()`; on a slow network it can take > 1.5 s). Round 3 gave up 1.5 s after the release with no text.
   **Fixed: wait for `end`**, up to 4 s when nothing has been heard yet (1.5 s when words are in).
4. **In-app browser or a browser without working recognition** (link opened inside WhatsApp / Instagram / Gmail on
   iOS, Android WebView, Brave which exposes the API but fails with `network` [5], Firefox). Shows "This browser
   can't hear you" (or Oops). Can't be fixed in code; now says *what* to do (open in Chrome / Safari).
5. **iOS specifics:** Siri & Dictation off -> `service-not-allowed` [6][7] (round 3 said "Your microphone is off",
   wrong advice); iOS speech + audio playback interfere [8][9], and round 3 spoke a silent `speechSynthesis` utterance
   (the iOS unlock) in the same gesture that started recognition. **Fixed:** the Siri line, and the unlock moved to the
   release (after `stop()`).
6. **Permission prompt on the first hold:** the prompt appears during the press; letting go to tap Allow ended (and
   with a < 250 ms tap, *aborted*) the recogniser mid-prompt. Once per device, wording "Now hold me and talk", so it
   doesn't match the report well, but a dismissed prompt then gave `not-allowed` and blocked voice for the session.
   **Fixed:** never stop/abort before the mic opens; `not-allowed` is checked against the Permissions API.

Checked and ruled out in our build: the camera session does not hold the microphone (`XR8.run` with `cameraConfig`
only, no `XR8.MediaRecorder` module; `world-health.ts` only touches video constraints), and `start()` was already
called synchronously in `pointerdown` (no await before it). Her voice was already cancelled on press (`hush()` ->
`speechSynthesis.cancel()`).

## What changed

```
src/voice/holdToTalk.ts   HoldListener rewritten (same API + additions):
                          - no getUserMedia meter by default (MicMeter only with ?voicemeter, for A/B on a device)
                          - ring from recognition events: breathing at audiostart, up on soundstart/speechstart, a
                            pulse per result (onLevel still 0..1 ~30 fps)
                          - start() synchronous in press(); fresh recogniser per press AND per restart (old unhooked)
                          - ended by itself while held (no-speech, aborted, Android silence): restart, keep the words
                            (max 4 restarts; two instant ends in a row or network/audio-capture/not-allowed stop it)
                          - released before the mic opened: no stop()/abort() until it opens (permission prompt),
                            then dropped quietly (10 s cap)
                          - after release: wait for `end`, 1.5 s with words, 4 s without
                          - every outcome has HoldResult.problem (+ error, restarts, startDelayMs)
                          - not-allowed: asks the Permissions API; really denied -> blocked, else "not-allowed-soft"
                            (not blocked); unblock() when the permission comes back (watchMicPermission)
                          - Android repeated-prefix results folded (foldRepeat)
                          - everything written to the Mic check log
src/voice/voiceHelp.ts    NEW, pure: HoldProblem codes, voicePlatform() (iOS/Android/Samsung/in-app/Brave/Firefox),
                          problemHelp() -> one kind line for the child, a grown-up line, chips?, block?
src/voice/voiceLog.ts     NEW: ring buffer of mic/recognition events (+ subscribe, format) for the Mic check
src/voice/voiceMode.ts    permission watch (unblocks), speech unlock moved from press to release, done carries
                          { problem, help }; too-short during a prompt -> permission-pending; repeat count (second
                          time in a row -> chips + grown-up line)
src/voice/speechInput.ts  RecognitionLike: optional soundstart/speechstart/speechend/soundend/audioend/nomatch,
                          result confidence (additive)
src/voice/index.ts        exports the voiceHelp types
src/app/voiceMode.ts      bubbles per problem ("Getting ready…" -> "Talk now!", then the problem line + chips + help);
                          quick tap during the prompt releases instead of aborting ("Tap Allow, then hold me and
                          talk!", then "Yay! Now hold me and talk!"); blocked cases say why (toast + Talk tab)
src/app/components/TalkOrb.tsx       'problem' bubble (help line, chips), no red dot while "Getting ready", mounts the
                                     Mic check host
src/app/components/VoiceCard.tsx     blocked: the specific reason + the grown-up line
src/app/components/SettingsPanel.tsx small "Mic check" link under "Talking to Cheer Bear"
src/app/components/VoiceDiagHost.tsx NEW: ?voicediag / openVoiceDiag(); portal; lazy chunk (8 KB js + 5 KB css, only
                                     downloaded when opened)
src/app/components/VoiceDiag.tsx     NEW: the Mic check view
src/app/components/voiceDiag.css     NEW (flat colours, no gradients)
scripts/check-voice-hold.ts          NEW: 24 Node checks with a browser-like fake recogniser (below)
```

### What the child sees now (all flat white/yellow bubbles above the mic, clear of the joystick/shutter)

| Cause | Bubble (child) | Grown-up line | Chips | Button |
|---|---|---|---|---|
| press, mic not open yet | "Getting ready…" then "Talk now!" (red dot only once listening) | | | |
| nothing said | "I didn't hear anything. Hold me and try again!" | | | mic |
| nothing said, 2nd time in a row | "I still can't hear you. Tap a magic word!" | speak close; no other app on the mic (in-app browser: open in Chrome/Safari) | 2 | mic |
| let go before the mic opened | "Keep holding me while you talk!" | | | mic |
| let go to answer the permission prompt | "Tap Allow, then hold me and talk!" -> "Yay! Now hold me and talk!" | iOS may ask twice | | mic |
| `not-allowed`, permission still prompt | "Tap Allow when you're asked, then hold me again!" | | 2 | mic |
| `not-allowed`, permission denied | toast + Actions tab: "Your microphone is off, so tap a magic word!" | per browser: iOS "aA > Website Settings > Microphone", Android "icon left of the address > Permissions" | Actions | sparkles until allowed again (no reload) |
| `service-not-allowed` iOS | "Turn on Siri & Dictation so I can hear you!" | Settings > General > Keyboard > Enable Dictation; Screen Time | Actions | sparkles |
| `service-not-allowed` other | "I can't listen in this browser. Tap a magic word!" | open in Chrome / Safari | Actions | sparkles |
| `network` | "I need the internet to hear you!" | runs online; Brave blocks it | 2 | mic |
| `audio-capture` | "Another app has the mic. Close it and try again!" | a call / assistant / recorder | 2 | mic |
| `aborted`, start() threw, other | "Oops! Hold me and try again." (2nd time: + chips) | | | mic |
| no recognition / `language-not-supported` | "This browser can't hear you, so tap a magic word!" | Firefox / in-app: use Chrome or Safari | Actions | sparkles |

### Mic check (`?voicediag`, Settings > Mic check)
Facts (browser, counts-as-phone by the house-rule test, `SpeechRecognition`/`webkitSpeechRecognition`/none, mic
permission live, microphones, secure page, online, in-app browser, language, call/view), a **Hold and talk** button
running the same `HoldListener` (step lights: start, audiostart, soundstart, speechstart, result, end, error, restart;
live words; verdict with the problem code), options **Continuous**, **Live words** (interim), **Level meter** (opens
the second stream, to confirm cause 1 on a device), **Mic only test** (getUserMedia alone, 3 s level bar, track label),
the log (app holds too) with **Copy log** (clipboard, falls back to execCommand) and **Share** (Web Share).

## How to run / test
```bash
npm run test:server          # ... voice commands 23 passed, voice hold 24 passed (new), all others unchanged
npx tsc --noEmit             # clean
API_PORT=6212 npx tsx scripts/dev-api.ts &
API_PROXY=http://127.0.0.1:6212 SIM_PORT=5212 SIM_CACHE=<scratch>/vite-cache npx vite --config scripts/vite.sim.config.mjs &
cd docs/evidence/voice-4/sim && BASE=http://localhost:5212 OUT=<dir> NODE_PATH=$(npm root -g) node voice4.cjs phone|desktop
cd docs/evidence/voice-3/sim && BASE=... VIDEO=<floor.y4m> ... node voice.cjs phone|desktop   # round-3 regression
```

### Node checks (`scripts/check-voice-hold.ts`, 24)
Fake recogniser with: start delay (prompt), no interim + late final, deaf while another stream holds the mic, start()
throwing, an error on start, ending by itself. Proves: start() synchronous in press, hush before, unlock after;
no getUserMedia while listening; **reproduces the report with the old meter** (deaf recogniser -> "didn't hear", no
trigger) and the default now hears "rainbow"; Android early end -> restart, words after the pause count, old instance
unhooked; words kept across a restart; late final (2.5 s) still heard; release during the prompt is not stopped,
dropped after the mic opens -> permission-pending; too-short; 7 error cases (message, block or not, chips, no prompt
loop / fresh recogniser); no-speech twice -> chips; bounded restarts on instant ends; start() throws -> not blocked;
permission back -> unblocked; fresh recogniser per hold; Android repeat folding; ring rises on speech, 0 on release;
the log has every event; every line short and kind.

### Simulator (real app, headless Chromium, 2026-11-19)
- **voice-4 phone 390x844: 29/29 PASS** (`voice4.cjs phone`): Getting ready -> Talk now; 0 audio getUserMedia calls
  while listening; nothing said (x2, chips run); Android early end -> 2 recognisers, no message while held, "dance"
  works; no interim + late final; network / audio-capture / aborted lines, not blocked; permission prompt quick tap
  (recogniser not stopped or aborted) -> "Tap Allow" -> "Yay! Now hold me and talk!"; soft not-allowed; denied ->
  Actions + toast + Talk tab with the how-to, unblocked when the permission comes back; Settings Mic check link; Mic
  check steps, words, log of earlier holds, facts, Copy log (clipboard read back); no console errors; iPhone UA
  `service-not-allowed` -> Siri & Dictation toast; `?voicediag` opens it after Start.
- **voice-4 desktop 1440x900: 27/27 PASS** (same minus the iOS and ?voicediag boots).
- **Round-3 regression (`voice-3/sim/voice.cjs`): phone 30/30, desktop 20/20 PASS** with these changes.
- Evidence (looked at each): `docs/evidence/voice-4/phone-01..16-*.jpg`, `desktop-01..14-*.jpg`. Fixed after looking:
  the grown-up line in the Talk tab and the Mic check link were low contrast on the dark glass; the red recording
  dot showed during "Getting ready"; the Mic check header on desktop was not aligned with its column.

## NOT verified (needs real devices)
1. That cause 1 is Dapo's cause. The Mic check's Level meter toggle is there to confirm it on his phone.
2. Restarting recognition while held without a fresh gesture on iOS Safari (if iOS refuses, the hold ends with the
   words so far, or "I didn't hear anything"; never a block).
3. Real event order / timing per browser (Safari's `audiostart`, Samsung's interim results, Chrome Android's beeps per
   restart: a restart may beep again).
4. Whether not stopping the recogniser during the permission prompt behaves as intended on Chrome Android / iOS.
5. iOS creating a new recogniser per hold: one report says each new instance can play the start sound / re-ask
   permission [3]; we keep a fresh one per hold (stale instances after `end` are a known failure source). Watch for it.
6. Permissions API on iOS (`microphone` query is Safari 16+); without it a `not-allowed` is treated as a real refusal.

## Changes outside my folders (small, additive; please review)
- `src/app/state/appState.ts`: `VoiceBubble.kind` gains `'problem'`; optional `help?: string`.
- `src/app/app.css` (voice section only): `.cb-vbubble.is-problem`, `.has-chips`, `.cb-vbubble-help`,
  `.cb-voicecard-help`, `.cb-settings-link`.
- `scripts/check-voice-commands.ts` (voice-3's): one `await sleep(5)` in the denied test (the permission check is
  async now) and one import line for `check-voice-hold.ts`.

## Findings for the immersive skill
- **Never open `getUserMedia({audio})` while `SpeechRecognition` runs** (level meters, recorders, WebRTC). Android has
  one capture client; iOS treats them as separate mic sessions. The recogniser hears silence and returns nothing, with
  no error. Drive "listening" visuals from recognition events (`audiostart`, `soundstart`, `speechstart`, results).
- Push-to-talk on Android: recognition ends by itself after ~1-2 s of silence even with `continuous: true`. While the
  button is held, restart a NEW recogniser on `end` and keep the words; cap restarts and stop on instant ends.
- After `stop()`, wait for `end`, not a fixed 1.5 s: some recognisers give no interim results and the final can take
  2-3 s on mobile networks.
- Don't `stop()`/`abort()` a recogniser before it has started (the permission prompt): release it when `start`
  arrives. Treat `not-allowed` as a real refusal only if `navigator.permissions.query({name:'microphone'})` says
  `denied`; watch that status's `change` to re-enable the button without a reload.
- iOS `service-not-allowed` = Siri & Dictation off (Settings > General > Keyboard > Enable Dictation, Screen Time).
  Brave and Android WebViews expose the API but fail (`network` / `not-allowed`): tell people to open Chrome / Safari.
- Don't speak (even a silent `speechSynthesis` unlock) in the same gesture that starts recognition on iOS; unlock in
  the release instead.
- Ship a hidden diagnostics view (`?voicediag`) with a copyable event log on any voice feature: it turns "it can't hear
  me" into an error code and a timeline.

## Sources
[1] Stack Overflow (2014), "speech recognition and getUserMedia" (Android 4.4 / Chrome 31: only whichever started first
could use the mic): https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/21093398/speech-recognition-and-getusermedia
[2] Stack Overflow, "failure to record audio while using webkitSpeechRecognition on Android Chrome":
https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/questions/25920854/failure-to-record-audio-while-using-webkitspeechrecognition-on-android-chrome
[3] lilting.ch (2026-01-23), "Why WebRTC Audio Won't Work with the SpeechRecognition API": https://lilting.ch/en/articles/webrtc-webspeech-realtime-translation
[4] react-speech-recognition issue (Android Chrome continuous stops after 1-2 s without voice):
https://lightrun.com/answers/jamesbrill-react-speech-recognition-react-speech-recognition-does-not-work-in-chrome-for-mobile ;
Android duplicate results: https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/35112561/speech-recognition-api-duplicated-phrases-on-android
[5] Brave: "webkitSpeechRecognition disabled and no way of detection": https://lightrun.com/answers/brave-brave-browser-webkitspeechrecognition-disabled-and-no-way-of-detection
[6] WebKit bug 225298 "Speech recognition service is not available" (enable Siri or Dictation): https://bugs.webkit.org/show_bug.cgi?id=225298
[7] WebKit bug 239816 (service-not-allowed in WKWebView): https://bugs.webkit.org/show_bug.cgi?id=239816
[8] WebAudio/web-speech-api issue 96 (iOS: recognition stops delivering after video play/pause): https://github.com/WebAudio/web-speech-api/issues/96
[9] TechNetExperts, "iOS Safari SpeechRecognition not working" (mic session lock-up after media playback; vendor page,
unverified): https://www.technetexperts.com/ios-safari-speechrecognition-not-working/
Also: Chrome on-device Web Speech (`processLocally`) is desktop only; Android still uses the cloud/system service:
https://groups.google.com/a/chromium.org/g/blink-dev/c/VNOok2dbmHM ; Samsung Internet support/permissions notes:
https://medium.com/samsung-internet-dev/speaking-to-the-web-with-the-web-speech-api-980d12d34244
