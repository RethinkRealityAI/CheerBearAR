# Cheer Bear AR: architecture

One web app, one page, no iframes. You talk to Cheer Bear on a voice call; what she says makes things happen in the
scene (her house pops up, a rainbow, a party...), her mouth moves with her voice, and you can see her as a 3D
showcase, place her in your room, take a selfie with her or a 3D photo.

## What this replaces

| Old (two projects glued together) | New (this repo) |
|---|---|
| Mattercraft / Zappar project (AR, 3D, face filter, 3D photo) published to webxr.run and embedded in an iframe | `src/experience/`: plain three.js + the 8th Wall engine binary (world tracking and face effects in ONE session) |
| `postMessage` (`TRIGGER_ANIMATION`, `SPEECH_TEXT`, `VISEME_UPDATE`) between the React app and the iframe | Direct calls on `ExperienceApi` (`src/shared/contracts.ts`) |
| Express + WebSocket server on Google Cloud Run; Twilio Media Streams -> server -> OpenAI Realtime -> `/events` WebSocket | Netlify Functions (plain HTTP) + transcription and trigger matching in the browser; no long-lived server |
| Config in Cloud SQL (Postgres), models in Google Cloud Storage | Netlify Blobs for config; models and media are static files in `public/` |
| Lip sync test page with a second bear model, FFT bands, mesh tearing | `src/bear` + `src/lipsync`: one bear for everything, clean blend shapes, smooth speech-driven visemes |

Why the realtime part moves to the browser: Netlify Functions cannot hold a WebSocket open, so Twilio Media Streams
cannot stream call audio to our server any more. The browser already has both sides of the call as MediaStreams
(the Twilio Voice SDK), so it sends them straight to OpenAI Realtime transcription over WebRTC, using a short-lived
client secret minted by a function. The keyword classifier is deterministic and runs in the browser; the optional
OpenAI intent fallback is a function. API keys never reach the client.

## Folders and owners

Each folder has ONE owner while the rebuild is in progress. Do not edit files outside your folders; if you need a
change elsewhere, write it in `docs/handoff/<your-name>.md` and code against the contract.

| Folder | What | Owner |
|---|---|---|
| `src/shared/` | `contracts.ts` (boundaries), `theme.css` (tokens), config types + defaults, keyword classifier | contracts/theme: orchestrator. config + classifier: server-voice |
| `src/bear/`, `src/lipsync/`, `src/audio/`, `public/models/cheer-bear*`, `tools/blender/` | The character (`BearCharacter`), lip sync engine, shared AudioContext, model build scripts, `/lab/lipsync` test page (`src/bear/lab/`) | bear-lipsync |
| `src/experience/` (except `modes/face`, `modes/photo`, `capture`) | Engine boot, splash, mode switching, in-camera HUD, showcase mode, AR mode, actions, props; `public/models/props/`, `public/media/` | xr-core |
| `src/experience/modes/face/`, `src/experience/modes/photo/`, `src/experience/capture/` | Selfie filter, 3D Photo, capture, reveal, share | xr-capture (starts after xr-core) |
| `netlify/functions/`, `netlify/lib/` (shared server helpers), `scripts/`, `src/voice/`, `netlify.toml`, `.env.example`, README dev section | Functions, Twilio client, browser transcription, trigger dispatch, config client | server-voice |
| `src/app/`, `src/admin/`, `src/main.tsx` | React shell and routes, talk button, chat, game modes, hints, settings, admin panel | app-ui |

Routes: `/` the experience, `/admin` the admin panel, `/lab/lipsync` the lip sync test page (unlinked).

## Screen layout (phone, portrait) — everyone designs to this

```
+--------------------------------------+
| wordmark      [mode switcher]   menu |   top bar: experience
|        game progress chip            |   app (only while a game mode is on)
|                                      |
|              hint pill               |   experience (white on black glass, about 5 words)
|                                      |
|            THE SCENE                 |
|                                      |
|        speech bubble / caption       |   experience (what Cheer Bear says)
|                                      |
| [Move]      (joystick)        (talk) |   bottom row: Move = experience, bottom left, always there once placed
|            or (shutter)              |   joystick or shutter = experience, bottom centre, never overlapped
+--------------------------------------+   talk button = app, bottom right, 72px + margin (reserved corner)
```

- The experience owns everything tied to the camera and scene: splash, mode switcher, hint pill, Place / Move,
  joystick, shutter, photo review sheet, its menu (How it works, Start again, Licences).
- The app owns the conversation: the talk button (call orb) bottom right, which opens a bottom sheet with call
  controls, chat, quick actions, game mode, hints and settings. On desktop (wider than 900px) the sheet is a right
  sidebar and the scene fills the rest.
- The app's layer sits above the experience container with `pointer-events: none`, except its own controls.
- Shared tokens: `src/shared/theme.css` (colours, font, glass, radius). Use them; do not invent new colours.

## House rules (Dapo's, non-negotiable)

1. Full branded splash on load: title art, hero (the bear), one-line lead, Start (disabled "Loading…" until ready),
   loading bar, "Activated by MEDIALIFE". Never a bare button. No instructions or licence text on the splash.
2. Computers: camera modes show an "Open this on your phone" QR sheet, never a raw engine error. Detect phones by
   user agent (`/Android|iPhone|iPad|iPod|Mobile/i` or MacIntel with touch points), never by touch alone.
   `?desktop` skips the check (simulator). The 3D showcase and the conversation DO work on computers.
3. No gradients anywhere (CSS, SVG, canvas, 3D). Flat colours; the rainbow is flat stripes.
4. Shutter bottom centre, never overlapped. Joystick bottom centre in walking modes.
5. World tracking: Move / reset placement is always on screen once placed (bottom left here, because bottom right is
   the talk button); moving keeps the scene's state (open house stays open).
6. In-camera hint = white text on translucent black glass, about 5 words, never blue or a brand colour.
7. Licences (8th Wall engine binary / Niantic Spatial, three.js, fonts) only behind a small "Licences" link in the
   menu. Never show 8th Wall / Niantic / Zappar / Mattercraft names to users.
8. One experience: modes switch in place, no page reloads, no separate pages per mode.
9. Reduced motion: soften, never freeze or block.
10. Say plainly what was and was not tested on a real phone. Everything here is simulator-tested until Dapo tests.
11. Secrets only in Netlify env vars / functions. Nothing secret in the client bundle or the repo.

## Reference material (read-only)

- Mattercraft export: `/mnt/user-data/uploads/CheerBearAR/` (`Scenes/*.zcomp`, `Scripts/*.ts`, `3D/`, `Images/`,
  `Video/`, `index.html` = the old splash). Readable scene summaries (node trees, props, timelines) are in
  `/home/user/cb-ref/*.txt` (`Main`, `AR`, `3d`, `Face-filter`, `3D-Photo`, `House`).
- Old app: `/mnt/user-data/uploads/Personality-ARAI/` (`PROJECT_GUIDE.md`, `server.ts`, `src/`, `docs/plans/`).
- Blender source of the rigged bear: `/mnt/user-data/uploads/Projects--Cheer Bear/3D Models/Character/CB-rigged.blend`.
- MEDIALIFE's working examples: `/home/user/medialife/public/labs/demos/shared/shell.js` (splash, world placement,
  face, camera swap in one engine session, photo), `.../wear-it-meet-it/`, `.../camera-swap/`, `.../joystick-robot/`,
  `/home/user/medialife/public/evade/bobo-booth/` (face effects), `/home/user/medialife/public/evade/xr/world-health.js`,
  `/home/user/medialife/public/vendor/ar-kit/hint.css`.
- The immersive skill (engines, pitfalls, patterns, simulator testing): `/mnt/project-files/skills/immersive/`
  (`SKILL.md`, `references/8thwall/*.md`, `references/ux-and-house-rules.md`, `snippets/sim-camera-test.mjs`,
  `library/8thwall-legacy/`). Read it before writing AR code; list what you learned in your handoff file so the
  skill can be updated.

## Working together in this checkout

Several workers edit `/home/user/cheerbearar` at the same time.

- Do not run git commands that change state (no commit, checkout, stash, reset). The orchestrator commits.
- Only edit your own folders. `package.json`: add a dependency with `npm install <pkg>` (one command, retry once if
  it collides), never hand-edit other entries.
- `npx tsc --noEmit` shows everyone's errors; fix only yours. Use your own dev port (`PORT=51xx npm run dev`).
- Chromium + Playwright are pre-installed (`require('playwright')`, `chromium.launch()`); never install Playwright.
- Large binaries: keep each model under about 3 MB and each video under about 4 MB where you can (phones on mobile
  data). Do not copy unused source files into `public/`.
- End by writing `docs/handoff/<your-name>.md`: what you built, how to run and test it, what is simulator-tested vs
  untested, open issues, anything another owner must do, and findings worth adding to the immersive skill.
