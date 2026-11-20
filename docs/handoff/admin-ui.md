# admin-ui handoff

The admin panel (`/admin`) rebuilt as small React components on the new `AdminApi`. The old panel was one 175 KB file
(`Personality-ARAI/src/pages/Admin.tsx`); this one is ~3,400 lines over 34 files, each section on its own.

## How to run

- `PORT=5184 npm run dev`, then open `http://localhost:5184/admin-dev.html` (my own dev entry, no router needed).
  - Real local functions: sign in with the dev default `admin` / `admin` (the functions runner allows it locally).
  - `?mock`: in-browser practice API, any username, password `demo`. `?mock&fail=save` makes every save fail,
    `?mock&expire=20` ends the session after 20 s.
- The app worker lazy-loads `src/admin/AdminPage.tsx` (default export) at `/admin`. It imports its own CSS
  (`@/shared/theme.css` + `src/admin/admin.css`, all scoped under `.adm-root`).
- Tests: `node src/admin/dev/e2e/flow.cjs` (see header for phone / real-API variants) and `node src/admin/dev/e2e/edge.cjs`.

## Component map

```
AdminPage.tsx        root: loads the API, sign-in, session expiry, section in the URL hash (#games)
├─ api.ts            loadAdminApi(): real adminApi via import.meta.glob (src/voice/index.ts, else src/voice/adminApi.ts),
│                    falls back to the mock in dev only (never silently in a production build); isAuthError()
├─ LoginScreen.tsx
├─ AdminContext.tsx  the editing model: saved + draft, edit(recipe), errors, changed paths, dirty/error sections,
│                    save (optimistic + rollback), discard, adopt (reset/restore), loadDraft (import), call()
├─ AdminShell.tsx    top bar, practice banner, left nav (desktop) / section <select> (phones), SaveBar,
│                    beforeunload guard, Ctrl/Cmd+S
├─ lib/configDiff.ts changedPaths, diffPatch (sends only changed parts), deepMerge, setIn
├─ lib/validate.ts   plain-words validation keyed by path; the server's validateConfig runs as a backstop
├─ lib/sections.ts   section list, which config paths each owns, KNOWN_KEYS / OBSOLETE_KEYS
├─ sections/         Overview, Mode, Privacy, Intent (keywords + live tester), Trigger, Sms, GameModes, Ui
│                    (text, colours, starting layout, buttons, welcome editor + preview, settings-panel items),
│                    LipSync (generic), Advanced (generic, only shown when the config has keys the panel does not know),
│                    History, Backup (export / import / reset)
├─ ui/               form kit: Field/TextField/TextArea, Toggle, Select (dropdown or radio cards), NumberField,
│                    ColorField, TagInput (word chips or sentence list), Section/Group, SaveBar, Toast, ConfirmDialog
│                    (native <dialog>), AutoFields (renders any settings object from its value types)
└─ dev/              mockAdminApi.ts (uses the shared applyConfigPatch / coerceConfig / testPhrase, so it behaves like
                     the server), main.tsx (admin-dev.html entry), e2e/*.cjs
```

## Editing model

- One draft of the whole config. Every change is `edit(d => { ... })` on a clone.
- Changed leaves are counted per path ("5 unsaved changes"); nav items show an orange dot (unsaved) or a red count
  (problems). Save is disabled while there are problems; "N to fix first" jumps to and focuses the first bad field.
- Save sends `diffPatch(saved, draft)`: only changed parts. Lists are sent whole; `localClassifier.synonyms` and
  `.examples` are sent whole when anything in them changes, because the server REPLACES those maps (so deletes stick —
  verified against the real functions).
- Optimistic: the bar clears at once; on error the previous saved copy comes back, the edits stay, and a toast says
  "Not saved: … try Save again".
- Expired sign-in (401 from any call): back to the sign-in screen with a notice; the unsaved edits are kept and
  re-applied on top of the fresh config after signing in again.
- Import loads into the draft only (review, then Save). Reset and History restore save straight away (confirmed first).
- Destructive actions confirm: discard, sign out with unsaved edits, remove keyword (lists the game modes it is removed
  from), delete game mode, remove welcome item, restore, reset, import over unsaved edits.

## Old features: kept / changed / dropped

| Old | Now |
|---|---|
| Mode & visibility, privacy, SMS policy, trigger policy | Kept, plain-words helper text on every setting, ms fields show seconds, sliders |
| Intent engine + classifier (keywords, synonyms, examples, morphology, search) | Kept. Keyword list + editor side by side (chips on phones). Keywords without their own reaction are tagged "general". Example phrases: hint says they are AI-only (the local classifier ignores them) |
| Test a phrase (saved config only) | Live as you type, uses the unsaved draft |
| Game modes (create/edit/enable, trigger words, hints, active) | Kept + Duplicate; trigger words as a chip picker from the keyword list; warns about trigger words that are no longer keywords |
| UI customisation (text, colours, default states, button visibility, welcome modal, settings panel) | Kept; colour fields have brand swatches from the theme tokens; welcome editor has a live preview, reorder, "Show it again to everyone" (bumps version) |
| Lip sync display toggles | Generic renderer: any field added to `AppConfig.lipSync` appears automatically (labels/ranges via `LIPSYNC_META`). Link to `/lab/lipsync` |
| Export / import JSON | Kept (download, copy, file or paste; accepts `{config: …}` wrappers from the old API) |
| Config history | Kept, with Restore (new; the old panel only listed it) |
| Revert | Discard (confirmed) |
| Cloud SQL "database connected" badge | Replaced by Overview: Twilio / OpenAI / storage / admin sign-in, with what to do when missing |
| AR iframe URL, GCS model list/upload, lip sync background/model URL, Twilio phone number | Dropped (gone from the architecture; `twilioPhoneNumber` is server-only now). Hidden if an old config still carries them |
| Dark mode toggle, collapsible sections, register-admin route | Dropped: the left nav replaces collapsing; admins come from env vars |
| Reset to defaults | New, behind a danger confirm |

## Tested

All with Playwright (Chromium), at 1440x900 and 390x844. No console errors (the only error logged in the real-API run
is the browser's own line for the deliberate wrong-password 401).

| Check | Mock | Real local functions (`npm run dev`, file store) |
|---|---|---|
| Login, wrong password message | ✓ both sizes | ✓ 1440 + 390 |
| Inline range error, Save disabled | ✓ | ✓ |
| Edit trigger policy, privacy, keywords (+synonyms), game mode (new, words, hint), colour; save | ✓ | ✓ |
| Reload shows saved values | ✓ | ✓ |
| Test phrase with unsaved keyword | ✓ | ✓ |
| Export -> edit -> import round trip (2 changes into draft) | ✓ | ✓ |
| History restore | ✓ | ✓ |
| Discard, reset (confirm dialogs) | ✓ | ✓ |
| Deleted synonym stays deleted after save + reload | – | ✓ |
| Phone section picker | ✓ | ✓ |
| Save failure rolls back, edits kept | ✓ (`fail=save`) | not forced |
| Session expiry keeps edits | ✓ (`expire=3`) | not tested (12 h tokens); relies on `ApiError.status === 401` |

Evidence: `docs/evidence/admin-ui/` (`mock-1440-*`, `mock-390-*`, `real-1440-*`, plus `mock-390-20-save-failed`,
`mock-1440-20-session-expired`). Nothing was tested on a real phone.

## Needs from server-voice

1. **`src/voice/index.ts` re-exporting `adminApi`**. Until it exists the panel imports `src/voice/adminApi.ts`
   directly (via glob, so nothing breaks either way).
2. `status()` returns `adminProblems`; the panel only shows a generic "admin password not set". Fine as is; could list them.
3. Unknown top-level keys are dropped by `mergeBySchema`, so a new setting only becomes editable once it is in
   `DEFAULT_CONFIG` (then it appears under "Other settings", or under Lip sync for `lipSync.*`).
4. `test-phrase` with a draft that fails validation returns 400; the tester shows that message. Client validation
   catches the usual cases first.

## Notes for the app worker

- Route `/admin` → `lazy(() => import('@/admin/AdminPage'))`. The page sets `document.title` and restores it on unmount.
- `admin-dev.html` at the repo root is a dev-only entry; it is not in the production build input.
