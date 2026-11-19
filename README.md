# Cheer Bear AR

Talk to Cheer Bear and bring her into your room: a voice-driven character experience with a 3D showcase,
world-tracked AR, a selfie filter and a 3D photo, in one web app.

Rebuilt from the Mattercraft + Cloud Run version onto MEDIALIFE's own stack (three.js, 8th Wall world and face
tracking, Netlify). See `docs/ARCHITECTURE.md`.

## Local development

Needs Node 22. No Google Cloud, tunnels, Docker or Netlify CLI.

```bash
npm install
npm run dev                 # app on http://localhost:5173, functions on :6173 (Vite proxies /api to them)
PORT=5180 npm run dev       # another port (functions on PORT+1000, or set API_PORT)
```

`npm run dev` (`scripts/dev.ts`) starts two things: `scripts/dev-api.ts`, a tiny runner that mounts every
`netlify/functions/*.ts` handler on one port using each function's own `config.path`, `method` and `rateLimit`
(restarts when a function or `src/shared` changes), and Vite with `API_PROXY` pointing at it.

- Without any `.env` everything still runs: `/api/config` serves the defaults, calls report "not set up", and the
  admin panel accepts `admin` / `admin` **locally only** (never on a deployed site).
- **Demo call without accounts:** open `http://localhost:5173/?mockVoice` and tap the talk button. Cheer Bear
  "rings", answers and says scripted lines containing every trigger word; transcripts, triggers and lip sync run
  through the real pipeline. `?mockVoice=fast` (3x speed), `?mockVoice=silent` (no sound), or both:
  `?mockVoice=fast,silent`.
- Real services: copy `.env.example` to `.env` and fill in what you have (Twilio, OpenAI, admin). For a real call
  locally, Twilio must still reach `/api/voice` on a public URL: use a deploy preview for that (see below).
- Config saved from `/admin` is kept in `.tmp/config-store/` (delete it to reset).
- Alternative: `npx netlify-cli dev` runs the same functions with Netlify's own emulator (including a local Blobs
  store) on http://localhost:8888, using the `[dev]` block in `netlify.toml`.

Checks (no credentials needed):

```bash
npm run test:server   # classifier, config validation, trigger pipeline, every function via the local runner
npm run test:voice    # headless Chromium: demo call end to end + the OpenAI WebRTC transcriber against a fake peer
```

## Environment variables

All server-side, set in Netlify (Site configuration > Environment variables) or `.env` locally. Full list with one
line each: `.env.example`. None of them reach the browser; `/api/config` only says which services are set up.

| Group | Variables |
|---|---|
| Calls | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`, `CHEER_BEAR_NUMBER`, `TWILIO_AUTH_TOKEN` (signature checks), optional `ALLOWED_DIAL_TARGETS`, `TWILIO_RECORD_CALLS`, `TWILIO_WEBHOOK_URL` |
| SMS bridge | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (or `TWILIO_SMS_FROM`), `CHEER_BEAR_NUMBER` |
| Transcription / intent | `OPENAI_API_KEY`, optional `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_INTENT_MODEL` |
| Admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD` (or a bcrypt hash), `JWT_SECRET` (32+ chars) |

## Deploying on Netlify

1. **Connect the repo:** Netlify > Add new project > Import from Git. Build settings come from `netlify.toml`
   (`npm run build`, publish `dist`, functions in `netlify/functions`, Node 22).
2. **Set the environment variables** above (scope: Functions). Admin refuses to run on a deployed site without
   `ADMIN_USERNAME`, a real `ADMIN_PASSWORD` and a 32+ character `JWT_SECRET`.
3. **Point Twilio at the site:** Twilio Console > Voice > TwiML > TwiML Apps > your app (the `TWILIO_TWIML_APP_SID`)
   > Voice Configuration > Request URL `https://<your-site>/api/voice`, method **HTTP POST**. If you later see 403s
   in the function log for `/api/voice` (signature mismatch, e.g. behind another domain), set
   `TWILIO_WEBHOOK_URL` to exactly the URL entered in Twilio.
4. **Blobs:** nothing to set up; the config store (`cheerbear-config`) is created on first save. Check
   `/admin` > Overview: storage should say `blobs`.
5. Deploy. Deploy previews work too, with two things to know: they share the site's Blobs store (an admin save on a
   preview changes the live config) and real calls from a preview still use the TwiML app's Voice URL, i.e. the
   production `/api/voice` (fine: it only returns the dial instructions).

Endpoints (all under `/api`): `GET config`, `GET token`, `POST voice` (Twilio webhook), `POST realtime-session`,
`POST intent`, `POST sms`, and `/api/admin/*` (`login`, `config`, `config/reset`, `history`, `history/restore`,
`test-phrase`, `status`).

## What changed from the Cloud Run version

| Before (Express on Cloud Run) | Now (Netlify) |
|---|---|
| `<Start><Stream>` sent both call tracks to `/media-stream`; the server bridged them to OpenAI Realtime over WebSocket | No media stream. The browser already has both sides of the call, so it sends Cheer Bear's audio (and the user's mic only if `allowUserAudioToOpenAI`) straight to OpenAI Realtime **transcription over WebRTC**, with a 2-minute client secret from `POST /api/realtime-session` |
| Transcripts and triggers pushed over the `/events` WebSocket; trigger queue on the server | Keyword classifier, cooldown, dedupe and dispatch run in the browser (`src/voice`); the AI intent fallback is `POST /api/intent` |
| Config in Cloud SQL (Postgres), pushed over `/events` | Netlify Blobs (current + last 30 versions); the app re-checks `GET /api/config` every minute and on tab focus |
| Models uploaded to GCS, `/admin/models`, AR iframe URL | Static files in `public/`; those admin fields are gone |
| ngrok / tunnel scripts, `TWILIO_TWIML_APP_SID_LOCAL`, `/health`, `/version` | Not needed: `npm run dev` for everything except a real call; a deploy preview for real calls |
| `/voice` dialled any `To`; `/send-sms` texted any number | Only `CHEER_BEAR_NUMBER` (plus `ALLOWED_DIAL_TARGETS`); Twilio signatures are checked when `TWILIO_AUTH_TOKEN` is set |
| Admin defaulted to `admin` / `admin` | Refused on deployed sites; JWTs signed with `JWT_SECRET` only |
