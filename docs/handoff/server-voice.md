# Handoff: server-voice

Backend moved from Express + WebSockets on Cloud Run / Cloud SQL / GCS to Netlify Functions + Blobs. Realtime work
(transcription, trigger matching, dispatch) moved into the browser (`src/voice`). Everything below was tested with
**no real credentials**; the "Not verified" section says exactly what Dapo must check and how.

## What I built

```
netlify/functions/            one file per endpoint (modern `export default (req, context)` + `export const config`)
  config.ts                   GET  /api/config            public config + which services are set up (booleans)
  token.ts                    GET  /api/token             Twilio Voice access token (old grants); 503 not_configured
  voice.ts                    POST /api/voice             TwiML webhook: same <Dial> + caller ID, NO <Start><Stream>
  realtime-session.ts         POST /api/realtime-session  OpenAI Realtime transcription client secret (2 min)
  intent.ts                   POST /api/intent            OpenAI intent fallback (hybrid / openai engines)
  sms.ts                      POST /api/sms               SMS bridge, always to CHEER_BEAR_NUMBER
  admin.ts                    /api/admin/*                login, config get/put/reset, history, restore, test-phrase, status
netlify/lib/                  shared server helpers (outside netlify/functions so Netlify never treats them as functions)
  http.ts  env.ts  auth.ts  store.ts  openai.ts
src/shared/config.ts          AppConfig types (trimmed), DEFAULT_CONFIG, schema-driven deep merge, validation, coercion
src/shared/classifier.ts      deterministic keyword classifier (browser + functions), resolveIntents with `via`
src/voice/                    browser voice layer
  index.ts                    entry: createVoiceSession, configClient, adminApi (+ ApiError, MOCK_SCRIPT, types)
  session.ts                  VoiceSession: call lifecycle, transcription wiring, SMS, page lifecycle
  twilioCall.ts               Twilio Device/Call (lazy-loaded SDK, iOS-safe patterns, shares the app AudioContext)
  transcriber.ts              OpenAI Realtime transcription over WebRTC, reconnect, client-side commit for no-VAD models
  triggerPipeline.ts          classify -> dedupe -> cooldown -> queue -> dispatch (pure logic)
  mock.ts, mockAudio.ts       demo call (?mockVoice); mockAudio.ts is the only Web Audio use in src/voice
  configClient.ts adminApi.ts api.ts emitter.ts
scripts/dev.ts, dev-api.ts    `npm run dev`: local functions runner + Vite proxy
scripts/check-*.ts            tests (see below); voice-harness.ts = browser harness for the headless test
public/media/voice/mock-cheer-bear.wav   110 KB speech sample for the demo call (copied from the old test-audio.wav)
netlify.toml, .env.example, README (Local development, Environment variables, Deploying, What changed)
```

Also edited: `vite.config.ts` (proxy `xfwd: true` so the same-origin check passes through the dev proxy) and
`package.json` scripts (`dev`, `dev:web`, `dev:api`, `test:server`, `test:voice`). No dependencies added.

## Endpoints

| Method + path | Auth | Limits | Notes |
|---|---|---|---|
| GET `/api/config` | none | - | `{ config, services: { calls, transcription, sms, intentAi }, updatedAt }`. CDN-cached 10 s (tag `config`, purged on admin save) |
| GET `/api/token` | same-origin | 30/min/IP (instance) | `{ token, identity, ttl }`; random `guest-…` identity; 503 `not_configured` + `mockAvailable` |
| POST/GET `/api/voice` | Twilio signature when `TWILIO_AUTH_TOKEN` set | 32 KB body | Dials `To` only if it is `CHEER_BEAR_NUMBER` or in `ALLOWED_DIAL_TARGETS`, else `<Say>` + `<Hangup/>`. `answerOnBridge`, `record-from-answer` (off with `TWILIO_RECORD_CALLS=false`) |
| POST `/api/realtime-session` | same-origin | **Netlify rule 20/60 s per IP+domain** + 20/min instance | `{ speaker }` -> `{ clientSecret, expiresAt, model, commit: 'server'\|'client', callsUrl }`. `user` refused unless `allowUserAudioToOpenAI` |
| POST `/api/intent` | same-origin | 60/min instance | `{ text, keywords? }` -> `{ intents, engine, available }`; no OpenAI call when engine is `local` |
| POST `/api/sms` | same-origin | **Netlify rule 10/60 s** + 10/min instance | `{ message }` (1-1600 chars). `to` ignored unless allowed |
| POST `/api/admin/login` | - | 10/min + 5 failures -> 5 min lockout (instance) | `{ token, username, expiresAt, devDefaults }` (12 h HS256 JWT) |
| GET/PUT `/api/admin/config` | Bearer | 250 KB | PUT = DeepPartial; 400 `{ error: 'invalid_config', errors: [...] }` |
| POST `/api/admin/config/reset` | Bearer | | |
| GET `/api/admin/history` | Bearer | | `{ history: [{ id, at, by, summary }] }` (last 30, newest first) |
| POST `/api/admin/history/restore` | Bearer | | `{ id }` |
| POST `/api/admin/test-phrase` | Bearer | | `{ text, draft? }` -> `{ matches, engine, tokens, details, text }` |
| GET `/api/admin/status` | Bearer | | `{ twilio, openai, sms, storage, adminConfigured, adminProblems, webhookSignatureCheck, transcribeModel }` |

Errors are always `{ error: <code>, message }` JSON. No CORS headers are sent (same-origin only); requests carrying a
foreign `Origin` / `Sec-Fetch-Site: cross-site` get 403. The free Netlify plan allows 2 code-based rate-limit rules,
used on the two endpoints that cost money; the in-memory limits are per warm instance (best effort).

## Environment variables

`.env.example` lists every one with a line each. Required for calls: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`,
`TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`, `CHEER_BEAR_NUMBER` (+ strongly recommended
`TWILIO_AUTH_TOKEN`). SMS: `TWILIO_AUTH_TOKEN` too. Transcription / AI intent: `OPENAI_API_KEY`. Admin (required on
any deployed site): `ADMIN_USERNAME`, `ADMIN_PASSWORD` (10+ chars or bcrypt hash), `JWT_SECRET` (32+ chars).
Optional: `ALLOWED_DIAL_TARGETS`, `TWILIO_SMS_FROM`, `TWILIO_RECORD_CALLS`, `TWILIO_WEBHOOK_URL`,
`OPENAI_TRANSCRIBE_MODEL`, `OPENAI_INTENT_MODEL`, `OPENAI_BASE_URL`, `ALLOWED_ORIGINS`, `CHEERBEAR_STORE`,
`CHEERBEAR_STORE_DIR`, `API_PORT`. Dropped: `DATABASE_URL*`, `TWILIO_TWIML_APP_SID_LOCAL`, `NGROK_*`, GCS vars,
`ADMIN_SECRET`, `CROSS_ORIGIN_ISOLATION`.

## How to run locally

```bash
npm run dev                         # app :5173 + functions :6173 (PORT=51xx moves both; API_PORT overrides)
open http://localhost:5173/?mockVoice=fast   # demo call, no accounts
npm run dev:api                     # functions only
npx netlify-cli dev                 # alternative: Netlify's emulator on :8888 (uses [dev] in netlify.toml)
```

Locally with no `.env`: admin is `admin` / `admin` (login response has `devDefaults: true`); config is saved in
`.tmp/config-store/` (gitignored).

## Test results (all run on 2026-11-19, all passing)

| Command | What | Result |
|---|---|---|
| `npx tsx scripts/check-classifier.ts` | tokens/bigrams, all core keywords, synonyms, "wake up", substrings not matched, morphology, admin keywords, multi-word keywords, cache refresh, English-only, AI answer mapping, engines local/hybrid/openai, failing AI | 20 passed |
| `npx tsx scripts/check-config.ts` | deep merge, obsolete keys dropped, record/list replacement, game mode restore, enum/range/colour/URL/keyword/duplicate validation, coercion of broken stored config, diff summary | 14 passed |
| `npx tsx scripts/check-voice-logic.ts` | trigger pipeline: spacing, cooldown, user gating, partials, per-transcript dedupe, English-only, hybrid/openai, typed text, manual triggers, dispose | 12 passed |
| `npx tsx scripts/check-functions.ts` | every function through the local runner: config; token/voice "not configured" without crashing; token JWT grants with fake env; **TwiML snapshot**; dial allowlist; signature validation incl. `TWILIO_WEBHOOK_URL`; realtime-session request shape sent to a fake OpenAI (GA `client_secrets`, `type: transcription`), gpt-live-transcribe variant and retry; admin login refusals (no env / admin/admin / short secret), real creds, bcrypt, dev defaults, forged / `alg:none` tokens; config get/put/invalid/too large; test-phrase with draft; intent (fake OpenAI); history/restore/reset; status leaks no values; SMS validation, open-relay refusal, 429 | 32 passed |
| `npx tsx scripts/check-voice-browser.ts` | headless Chromium (`--autoplay-policy=no-user-gesture-required`, fake media): demo call status flow, partial->final transcripts, **all 11 core triggers in script order**, triggers after their transcript and spaced 1 s, remote stream carries sound and silence (lip sync input), sendText/fireTrigger/mute/endCall, no transcripts after hang-up; real mode without Twilio -> `code: 'not_configured'`; `mock: 'auto'` fallback; **the WebRTC transcriber end to end against a fake OpenAI peer** (SDP POSTed with the client secret, `oai-events` channel, delta/completed parsing, audio track received, stop leaves the call track live); client-side commits for a no-VAD model | 6 passed |
| `npx tsc --noEmit` | whole project | 0 errors |
| Netlify bundler | `@netlify/zip-it-and-ship-it@16` (in my scratchpad) on `netlify/functions`: detects exactly the 7 functions with the right paths/methods and both rate-limit rules; the bundled `config`, `voice`, `admin` run in Node (memory store fallback, TwiML, admin refusal) | ok |
| `npm run dev` smoke test | `/api/config`, `/api/admin/login` (with Origin through the proxy), `/api/token` via Vite on :5191 | ok |
| Browser bundle | `src/voice` builds to 60 KB + a lazy 279 KB Twilio chunk; no `process.env`, crypto, JWT or key names in it | ok |

## NOT verified (needs real accounts or a deployed site) and how Dapo checks each

1. **A real Twilio call.** Deploy, set the env vars, set the TwiML app Voice URL to `https://<site>/api/voice` (POST).
   On a phone open the site, tap the talk button: expect "Ringing…", Cheer Bear's phone rings, status "in-call" when
   she answers, her voice audible, mouth moving. Check the Netlify function log for `/api/voice` (200, no 403). If
   403: set `TWILIO_WEBHOOK_URL` to exactly the URL in the Twilio console. Also check: `answerOnBridge` gives a ringing
   state before she answers; hang up from either side returns the app to idle; mute works.
2. **Real OpenAI transcription over WebRTC.** With `OPENAI_API_KEY` set, during a call open the debug view
   (transcription state should go `connecting` -> `live` for `cheer_bear`) and set admin transcript visibility to
   `chat_and_call_debug`: her words should appear within about a second; saying "rainbow" should fire Rainbow. The
   things I could not test against OpenAI itself: that `/v1/realtime/calls` accepts a **transcription** client
   secret over WebRTC (docs show it for realtime sessions; the client_secrets reference allows `type:
   'transcription'`), that forwarding the remote Twilio track into a second RTCPeerConnection works on **iOS
   Safari** (falls back to routing through the shared AudioContext if `addTrack` throws, but not if it silently
   sends silence), and the vocabulary `prompt` / `keywords` hint (the function retries without it on a 400).
   If transcripts never arrive, try `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe`.
3. **User-side transcription** (`allowUserAudioToOpenAI` on): the user's mic via `call.getLocalStream()`.
4. **Netlify Blobs on a deployed site.** `/admin` > Overview should say storage `blobs`; save a change, reload,
   check it persists and appears in History; open the site in another browser and see it within ~1 minute.
5. **Netlify platform rate limits** (rules on realtime-session and sms): only enforced on Netlify; hammer
   `/api/sms` with curl and expect 429 after 10/min.
6. **SMS bridge**: during a call, type in chat with `sendTypedChatToSms` on; Cheer Bear's phone gets the text.
7. **Sharing the AudioContext with the Twilio SDK** (sets the SDK's private static `Device._audioContext` to the
   app's context before the first Device): verify on an iPhone that ringtones/call audio work and only one
   AudioContext exists (Safari Web Inspector > Timelines, or `performance` audio). If anything is odd, delete
   `shareAudioContext(...)` in `src/voice/twilioCall.ts`; the SDK then makes its own (two contexts total).
8. Real phones in general (house rule 10): nothing here has run on a real phone.

## Contract changes I need (implemented as compatible extras; please fold into `contracts.ts`)

1. `VoiceSession.startCall(opts?: { to?: string; mock?: boolean })` - `mock: true` starts the demo call (the "user
   opts in" path when `/api/token` says Twilio is not configured).
2. `VoiceEvents['status']` gains `code?: 'not_configured' | 'mic_denied' | 'token_failed' | 'call_failed' | 'demo'`
   and `mock?: boolean` (exported as `VoiceStatusEvent`; app-ui already reads them).
3. `createVoiceSession(opts: { getConfig(): AppConfig; mock?: 'url' | 'auto' | 'always' | 'never'; endCallWhenHidden?: boolean })`.
4. `ConfigClient` gains `readonly services: { calls; transcription; sms; intentAi }` (exported `ConfigClientExt`).
5. `AdminApi.status()` returns more fields (`sms`, `adminProblems`, `webhookSignatureCheck`, `transcribeModel`);
   `testPhrase` also returns `tokens`, `details`. Errors thrown are `ApiError { status, code, message }`.
6. Note: `DeepPartial<T>` maps arrays to objects; the store treats any list in a patch as a full replacement.

## Behaviour notes and changes from the old server (deliberate)

- `AppConfig` trimmed: removed `arIframeUrl`, `twilioPhoneNumber` (now env only), `lipSync.modelUrl`,
  `lipSync.backgroundImageUrl`. Unknown/obsolete keys in stored or posted configs are dropped silently. Kept but
  marked legacy: `ui.useCallMode`, `defaultCallMode*`, `uiDelayMs` (default now 0) - app-ui decides.
  Default `callButtonText` is now "Call Cheer Bear", `hangupButtonText` "End call" (app-ui asked).
- Dispatch spacing fix: the old queue fired a burst enqueued item by item all at once; now `dispatchIntervalMs` is
  measured from the last dispatch. `first_only` vs `queue_all` behave as before (practically the same, since
  duplicates are refused on enqueue); I did not make `first_only` drop other words because game progress counts
  trigger events.
- AI intent fallback: the old code discarded any AI keyword not literally in the text, which made `hybrid`/`openai`
  a no-op. Now AI answers only have to be configured keywords. Classifier `examples` are passed to the AI as hints.
- `/api/voice` and `/api/sms` only reach `CHEER_BEAR_NUMBER` (+ `ALLOWED_DIAL_TARGETS`); the old ones were an open
  dialler / SMS relay. Token identity is random per browser (was `'user'` for everyone).
- Device is never `register()`ed (only needed for incoming calls). No Twilio `edge` pinned (old: `ashburn`).
- Ending the call when the page is hidden (old iOS-safe behaviour) is on by default (`endCallWhenHidden: false` to
  disable). `pagehide` disposes the session; after a bfcache restore (`pageshow` with `persisted`) app-ui must create
  a new session.
- Game-mode filtering of triggers, "WakeUp" on connect / "Sleep" on hang-up, transcript visibility rules stay in
  the app (app-ui already does this).

## Notes for other owners

- **app-ui:** call `unlockAudio()` (from `@/bear` or `@/audio/context`) in the same tap as `startCall()`; the demo
  call's voice uses the shared AudioContext. A `speaking` level event was asked for: the bear already exposes
  `speaking`, and the remote stream is available for any meter, so I did not add one to the voice emitter.
- **bear-lipsync:** in the demo, `remoteStream` is a `MediaStreamAudioDestinationNode` stream from the shared
  context (works with `createMediaStreamSource`, verified in the harness); on a real call it is the Twilio remote
  WebRTC stream (your muted `<audio>` attach covers Chrome).
- **xr-core:** I added `public/media/voice/mock-cheer-bear.wav` (110 KB) under your `public/media/`.
- **orchestrator:** `netlify/lib/` is a new folder next to `netlify/functions/` (helpers must live outside the
  functions folder). `docs/ARCHITECTURE.md` could list it under server-voice.

## Findings worth adding to the immersive skill

- Netlify modern functions: helpers in `netlify/functions/` subfolders risk being treated as functions; keep them in
  `netlify/lib/`. Code-based `config.rateLimit` works on all plans but the free plan allows only 2 rules per project.
  `getStore()` throws `MissingBlobsEnvironmentError` synchronously off-Netlify, so a fallback is easy.
- OpenAI Realtime GA: browser transcription = `POST /v1/realtime/client_secrets` with `session.type:
  'transcription'`, then SDP to `/v1/realtime/calls` with the `ek_…` secret; events
  `conversation.item.input_audio_transcription.delta` / `.completed` keyed by `item_id`. `gpt-live-transcribe`
  needs `turn_detection: null` + client `input_audio_buffer.commit`, and `languages: [...]` (plural).
- `RTCPeerConnection.getStats()` `media-source.audioLevel` gives a free VAD level for an outgoing track without any
  AudioContext.
- Twilio Voice SDK 2.x keeps one private static AudioContext (`Device._audioContext`), created lazily; it can be
  pre-seeded with the app's shared context.
- Testing: functions passed to Playwright `page.evaluate` from a `tsx` script get `__name()` wrappers that throw in
  the page; pass plain-JS strings (`addScriptTag({ content })`) for anything with named inner functions. On the
  answering side, a WebRTC data channel is often already `open` when `datachannel` fires. Chromium's fake mic beeps
  roughly twice a second (never 700 ms of silence).
- A two-page WebRTC loopback (second page answers the SDP via `page.route`) tests a Realtime client end to end with
  no OpenAI account.
