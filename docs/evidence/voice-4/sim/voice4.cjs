// Voice-4: "it says it can't hear me". Every listening failure mode, in the REAL app (headless Chromium, software GL),
// with a FAKE SpeechRecognition whose behaviour each scenario sets (window.__sim): permission prompt delay, Android
// ending early while held, no interim results + late final, each error code, a faked Permissions API. Screenshots of
// every message at 390x844 and of the Mic check view (phone + desktop).
//   BASE=http://localhost:5212 OUT=<dir> NODE_PATH=$(npm root -g) node voice4.cjs phone|desktop
// Nothing here is a real phone or real speech recognition.
const lib = require('/home/user/cheerbearar/docs/evidence/ui-2/sim/mylib.cjs');
const { chromium } = require('playwright');
const path = require('path');

const KIND = process.argv[2] || 'phone';
const PHONE = KIND === 'phone';
const W = PHONE ? 390 : 1440, H = PHONE ? 844 : 900;
const OUT = process.env.OUT || path.join(__dirname, '..');
const tag = PHONE ? 'phone' : 'desktop';
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!cond) process.exitCode = 1; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 72, timeout: 120000 });

function installFakes() {
  window.__sim = { startDelay: 40, noInterim: false, finalDelay: 200, errorOnStart: '', perm: 'granted' };
  window.__recs = [];
  window.__audioGum = 0;
  // count audio getUserMedia calls (the camera's video-only ones are fine)
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => { if (c && c.audio) window.__audioGum += 1; return orig(c); };
  }
  // the Permissions API: 'microphone' answers window.__sim.perm, change events on __setPerm
  const status = new EventTarget();
  Object.defineProperty(status, 'state', { get: () => window.__sim.perm });
  const perms = navigator.permissions;
  const origQuery = perms && perms.query ? perms.query.bind(perms) : null;
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: (d) => (d && d.name === 'microphone') ? Promise.resolve(status) : origQuery ? origQuery(d) : Promise.reject(new Error('no')) } });
  window.__setPerm = (p) => { window.__sim.perm = p; status.dispatchEvent(new Event('change')); };
  class FakeRec {
    constructor() { this.text = ''; this.o = { ...window.__sim }; window.__recs.push(this); }
    start() {
      this.started = true;
      setTimeout(() => {
        if (this.aborted) return;
        this.onstart && this.onstart(); this.onaudiostart && this.onaudiostart();
        if (this.o.errorOnStart) { this.onerror && this.onerror({ error: this.o.errorOnStart }); this.end(); }
      }, this.o.startDelay);
    }
    stop() { this.stopped = true; setTimeout(() => { if (this.aborted) return; if (this.text) this.emit(true); this.end(); }, this.o.finalDelay); }
    abort() { this.aborted = true; }
    end() { if (this.ended) return; this.ended = true; this.onend && this.onend(); }
    emit(final) { const r = [{ transcript: this.text, confidence: 0.9 }]; r.isFinal = final; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); }
  }
  window.SpeechRecognition = FakeRec;
  window.webkitSpeechRecognition = FakeRec;
  const cur = () => window.__recs[window.__recs.length - 1];
  window.__say = (t) => { const r = cur(); if (!r || r.aborted) return false; r.onsoundstart && r.onsoundstart(); r.onspeechstart && r.onspeechstart(); r.text = t; if (!r.o.noInterim) r.emit(false); return true; };
  window.__endNow = (code) => { const r = cur(); if (!r) return; if (code) r.onerror && r.onerror({ error: code }); r.end(); };
}

async function boot({ ua = 'android', query = '', w = W, h = H } = {}) {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: PHONE, hasTouch: PHONE, userAgent: PHONE ? UA[ua] : undefined, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(installFakes);
  await ctx.addInitScript(() => { window.__actions = []; try { localStorage.clear(); localStorage.setItem('cb.app.prefs.v1', JSON.stringify({ voiceNudgeDone: true, orbNudgeDone: true })); } catch { /* */ } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${lib.BASE}/?test&desktop${query}`, { waitUntil: 'domcontentloaded' });
  await lib.start(page);
  await page.evaluate(() => window.__cbApp.experience.on('action', (a) => window.__actions.push(a.name)));
  await lib.waitFor(page, () => window.__cbApp.store.get().started, null, 60000);
  await lib.sleep(1500);
  await page.evaluate(() => { const c = window.__cbApp; if (c.store.get().overlay) c.closeOverlay(); });
  await lib.sleep(500);
  return { browser, page, logs };
}

const sim = (page, o) => page.evaluate((o) => Object.assign(window.__sim, o), o);
const orbCenter = (page) => page.evaluate(() => { const r = document.querySelector('[data-testid="talk-orb"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const bubble = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-testid="voice-bubble"]');
  return b ? { kind: [...b.classList].find((c) => c.startsWith('is-') && c !== 'is-live') || '', text: b.querySelector('.cb-vbubble-text')?.textContent || '', help: b.querySelector('.cb-vbubble-help')?.textContent || '', chips: [...b.querySelectorAll('.cb-vchip')].map((c) => c.textContent) } : null;
});
const state = (page) => page.evaluate(() => window.__cbApp.store.get().voice);
const actions = (page) => page.evaluate(() => window.__actions.slice());
async function clearUi(page) {
  await page.evaluate(() => { const c = window.__cbApp; c.voiceUi.clearBubble(); if (c.store.get().sheetOpen) c.closeSheet?.(); });
  await lib.sleep(300);
}

/** Press, run `during` while held, release after `holdMs`, wait for idle. */
async function hold(page, { holdMs = 900, during, afterMs = 600 } = {}) {
  const c = await orbCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const t0 = Date.now();
  if (during) await during();
  const left = holdMs - (Date.now() - t0);
  if (left > 0) await lib.sleep(left);
  await page.mouse.up();
  await lib.waitFor(page, () => { const v = window.__cbApp.store.get().voice; return v !== 'starting' && v !== 'listening' && v !== 'finishing'; }, null, 15000);
  await lib.sleep(afterMs);
}

(async () => {
  const { browser, page, logs } = await boot();
  try {
    // 1. "Getting ready…" until the mic opens, then "Talk now!" (Android needs ~0.3-1 s before it hears anything)
    await sim(page, { startDelay: 900 });
    const c = await orbCenter(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await lib.sleep(300);
    const ready = await bubble(page);
    await shot(page, `${tag}-01-getting-ready`);
    await lib.sleep(1000);
    const now = await bubble(page);
    await shot(page, `${tag}-02-talk-now`);
    ok('before the mic opens the bubble says "Getting ready…", then "Talk now!"', /Getting ready/.test(ready?.text) && /Talk now/.test(now?.text), `${ready?.text} -> ${now?.text}`);
    await page.evaluate(() => window.__say('rainbow'));
    await lib.sleep(300);
    await page.mouse.up();
    await lib.sleep(1200);
    ok('...and the words then work (Rainbow)', (await actions(page)).includes('Rainbow'));
    ok('no microphone stream opened next to the recogniser (0 audio getUserMedia calls)', (await page.evaluate(() => window.__audioGum)) === 0, `${await page.evaluate(() => window.__audioGum)}`);
    await lib.sleep(2500); await clearUi(page);

    // 2. hold, say nothing -> one kind line, no chips yet
    await sim(page, { startDelay: 40 });
    await hold(page, { holdMs: 1200 });
    const b1 = await bubble(page);
    await shot(page, `${tag}-03-no-speech`);
    ok('nothing said: "I didn’t hear anything. Hold me and try again!"', /didn’t hear anything/.test(b1?.text) && !b1.chips.length, JSON.stringify(b1));
    // 3. again -> chips + a grown-up line
    await hold(page, { holdMs: 1200 });
    const b2 = await bubble(page);
    await shot(page, `${tag}-04-no-speech-again`);
    ok('nothing said twice: "I still can’t hear you" + 2 magic-word chips + a grown-up line', /still can’t hear/.test(b2?.text) && b2.chips.length === 2 && !!b2.help, JSON.stringify(b2));
    const before = (await actions(page)).length;
    await page.evaluate(() => [...document.querySelectorAll('.cb-vbubble .cb-vchip')][1]?.click());
    await lib.sleep(1200);
    ok('a chip in the problem bubble runs its magic word', (await actions(page)).length === before + 1, (await actions(page)).slice(-1)[0]);
    await lib.sleep(2000); await clearUi(page);

    // 4. Android ends recognition after a pause while still held -> restarts; the words after the pause count
    const r0 = await page.evaluate(() => window.__recs.length);
    let midBubble = null;
    await hold(page, {
      holdMs: 2200,
      during: async () => {
        await lib.sleep(400);
        await page.evaluate(() => window.__endNow('no-speech')); // Android gives up after a short silence
        await lib.sleep(500);
        midBubble = await bubble(page);
        await page.evaluate(() => window.__say('dance'));
      },
    });
    const r1 = await page.evaluate(() => window.__recs.length);
    ok('Android early end while held: a fresh recogniser, no "didn’t hear" while holding, "dance" still works', r1 - r0 === 2 && !/hear/.test(midBubble?.text || '') && (await actions(page)).includes('Dance'), `recognisers ${r1 - r0}, mid bubble "${midBubble?.text}"`);
    await lib.sleep(2500); await clearUi(page);

    // 5. no interim results, final 2.5 s after the release
    await sim(page, { noInterim: true, finalDelay: 2500 });
    await hold(page, { holdMs: 1000, during: async () => { await lib.sleep(300); await page.evaluate(() => window.__say('sparkle')); }, afterMs: 400 });
    ok('no interim + late final (2.5 s after letting go): still heard (Sparkle)', (await actions(page)).includes('Sparkle'));
    await sim(page, { noInterim: false, finalDelay: 200 });
    await lib.sleep(2500); await clearUi(page);

    // 6. error codes -> specific lines
    const cases = [
      ['network', /internet/, `${tag}-05-network`],
      ['audio-capture', /Another app has the mic/, `${tag}-06-audio-capture`],
      ['aborted', /Hold me and try again|didn’t hear/, null],
    ];
    for (const [code, re, name] of cases) {
      await sim(page, { errorOnStart: code });
      await hold(page, { holdMs: 900 });
      const b = await bubble(page);
      if (name) await shot(page, name);
      ok(`error "${code}": ${re}`, re.test(b?.text || ''), JSON.stringify(b));
      ok(`error "${code}": not blocked (the mic button stays a mic)`, (await state(page)) === 'idle');
      await clearUi(page);
    }
    await sim(page, { errorOnStart: '' });

    // 7. the permission prompt: a quick tap while the browser asks -> "Tap Allow", the recogniser is not aborted
    await sim(page, { perm: 'prompt', startDelay: 2500 });
    await page.evaluate(() => window.__setPerm('prompt'));
    const n0 = await page.evaluate(() => window.__recs.length);
    const cp = await orbCenter(page);
    await page.mouse.click(cp.x, cp.y);
    await lib.sleep(400);
    const bp = await bubble(page);
    await shot(page, `${tag}-07-permission-prompt`);
    const rp = await page.evaluate((n) => { const r = window.__recs[n]; return r ? { stopped: !!r.stopped, aborted: !!r.aborted } : null; }, n0);
    ok('quick tap during the permission prompt: "Tap Allow, then hold me and talk!", recogniser not stopped/aborted', /Tap Allow/.test(bp?.text || '') && rp && !rp.stopped && !rp.aborted, `${JSON.stringify(bp)} ${JSON.stringify(rp)}`);
    await page.evaluate(() => window.__setPerm('granted')); // the user taps Allow
    await lib.sleep(2800);
    const ba = await bubble(page);
    await shot(page, `${tag}-08-allowed-now-hold`);
    ok('after Allow (the mic opened): "Yay! Now hold me and talk!"', /Now hold me and talk/.test(ba?.text || ''), JSON.stringify(ba));
    await sim(page, { startDelay: 40 });
    await lib.sleep(3000); await clearUi(page);

    // 8. not-allowed but the permission is not denied (prompt dismissed) -> soft, press again works
    await sim(page, { errorOnStart: 'not-allowed', perm: 'prompt' });
    await hold(page, { holdMs: 900 });
    const bs = await bubble(page);
    await shot(page, `${tag}-09-not-allowed-soft`);
    ok('not-allowed with the permission still "prompt": "Tap Allow when you’re asked…", not blocked', /Tap Allow when/.test(bs?.text || '') && (await state(page)) === 'idle', JSON.stringify(bs));
    await clearUi(page);

    // 9. not-allowed and really denied -> blocked: Actions tab + toast with how to allow it
    await sim(page, { errorOnStart: 'not-allowed', perm: 'denied' });
    await page.evaluate(() => window.__setPerm('denied'));
    await hold(page, { holdMs: 900, afterMs: 900 });
    const bd = await page.evaluate(() => { const s = window.__cbApp.store.get(); return { voice: s.voice, open: s.sheetOpen, tab: s.tab, toast: s.toast?.text || '' }; });
    await shot(page, `${tag}-10-denied-toast`);
    ok('mic denied: blocked, Actions tab, toast says how to allow it', bd.voice === 'denied' && bd.open && bd.tab === 'actions' && /microphone is off/.test(bd.toast) && /allow the Microphone/.test(bd.toast), JSON.stringify(bd));
    await page.evaluate(() => window.__cbApp.setTab?.('talk'));
    await lib.sleep(600);
    await shot(page, `${tag}-11-denied-talk-tab`);
    const tt = await page.evaluate(() => document.querySelector('.cb-voicecard')?.textContent || '');
    ok('Talk tab explains it too (with the grown-up line)', /microphone is off/i.test(tt) && /allow the Microphone/.test(tt), tt.slice(0, 120));
    // the grown-up switches it back on in Settings -> unblocked, no reload
    await page.evaluate(() => window.__setPerm('granted'));
    await lib.sleep(400);
    ok('mic allowed again in Settings: the button is a mic again (no reload)', (await state(page)) === 'idle', await state(page));
    await sim(page, { errorOnStart: '', perm: 'granted' });
    await page.evaluate(() => window.__cbApp.closeSheet?.());
    await lib.sleep(600);

    // 10. Settings > Mic check opens the diagnostics; a test hold logs every event
    await page.evaluate(() => { window.__cbApp.openSheet(); window.__cbApp.setTab?.('settings'); });
    await lib.sleep(700);
    const link = await page.evaluate(() => { const l = document.querySelector('.cb-settings-link'); l?.scrollIntoView({ block: 'center' }); return !!l; });
    await lib.sleep(400);
    await shot(page, `${tag}-12-settings-mic-check`);
    ok('Settings has a small "Mic check" link', link);
    await page.evaluate(() => document.querySelector('.cb-settings-link').click());
    await lib.waitFor(page, () => !!document.querySelector('.cb-diag-hold'), null, 20000);
    await lib.sleep(500);
    const hb = await page.evaluate(() => { const r = document.querySelector('.cb-diag-hold').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(hb.x, hb.y);
    await page.mouse.down();
    await lib.sleep(300);
    await page.evaluate(() => window.__say('make a rainbow'));
    await lib.sleep(400);
    await page.mouse.up();
    await lib.sleep(900);
    await shot(page, `${tag}-13-mic-check`);
    const diag = await page.evaluate(() => ({
      steps: [...document.querySelectorAll('.cb-diag-steps li.is-on')].map((l) => l.textContent),
      words: document.querySelector('.cb-diag-words')?.textContent || '',
      log: document.querySelector('[data-testid="voice-diag-log"]')?.textContent || '',
      facts: document.querySelector('.cb-diag-facts')?.textContent || '',
    }));
    ok('Mic check: the step lights show start, audiostart, soundstart, speechstart, result, end', ['start', 'audiostart', 'soundstart', 'speechstart', 'result', 'end'].every((s) => diag.steps.includes(s)), diag.steps.join(','));
    ok('Mic check: words heard and the log has the earlier app holds too (network, not-allowed...)', /make a rainbow/.test(diag.words) && /error\s+network/.test(diag.log) && /error\s+not-allowed/.test(diag.log) && /restart/.test(diag.log), diag.words);
    ok('Mic check: facts show browser, recognition and permission', (PHONE ? /Chrome 142 Android/ : /Chrome \d+/).test(diag.facts) && /webkitSpeechRecognition|SpeechRecognition/.test(diag.facts) && /granted/.test(diag.facts), diag.facts.slice(0, 160));
    await page.evaluate(() => [...document.querySelectorAll('.cb-diag-btn')].find((b) => /Copy log/.test(b.textContent)).click());
    await lib.sleep(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok('Mic check: "Copy log" puts the facts + the full log on the clipboard', /Cheer Bear mic check/.test(clip) && /UA: /.test(clip) && /#\d+ \+0\.\d{3}s/.test(clip), `${clip.length} chars`);
    await page.evaluate(() => document.querySelector('.cb-diag-body').scrollTo(0, 9999));
    await lib.sleep(300);
    await shot(page, `${tag}-14-mic-check-log`);
    await page.evaluate(() => document.querySelector('.cb-diag-close').click());
    await lib.sleep(400);
    ok('Mic check closes', !(await page.evaluate(() => !!document.querySelector('.cb-diag'))));

    const errs = lib.errorsOf(logs).filter((l) => !/favicon|404.*\.map/.test(l));
    ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' || '));
  } catch (e) {
    ok('run', false, String(e && e.stack || e));
    await shot(page, `${tag}-zz-failure`).catch(() => undefined);
  } finally {
    await browser.close();
  }

  if (PHONE) {
    // 11. iPhone with Siri & Dictation off: service-not-allowed -> the Siri line, blocked, Actions tab
    const k = await boot({ ua: 'ios' });
    try {
      await sim(k.page, { errorOnStart: 'service-not-allowed' });
      await hold(k.page, { holdMs: 900, afterMs: 900 });
      const s = await k.page.evaluate(() => { const st = window.__cbApp.store.get(); return { voice: st.voice, tab: st.tab, toast: st.toast?.text || '' }; });
      await shot(k.page, `${tag}-15-ios-siri-off`);
      ok('iOS service-not-allowed: "Turn on Siri & Dictation…" with the Settings path, blocked', /Siri & Dictation/.test(s.toast) && /Enable Dictation/.test(s.toast) && s.voice === 'denied', JSON.stringify(s));
    } catch (e) {
      ok('ios run', false, String(e));
    } finally {
      await k.browser.close();
    }
    // 12. ?voicediag opens the Mic check straight away (what we send Dapo)
    const d = await boot({ query: '&voicediag' });
    try {
      await lib.waitFor(d.page, () => !!document.querySelector('.cb-diag'), null, 20000);
      await lib.sleep(600);
      await shot(d.page, `${tag}-16-voicediag-url`);
      ok('?voicediag opens the Mic check after Start', true);
    } catch (e) {
      ok('voicediag run', false, String(e));
    } finally {
      await d.browser.close();
    }
  }
  console.log(results.join('\n'));
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
})();
