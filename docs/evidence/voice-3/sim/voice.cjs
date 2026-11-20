// Voice mode (hold to talk) in the real app, headless Chromium, with a FAKE SpeechRecognition injected by
// addInitScript (headless Chromium has no working recognition) and the fake floor camera.
//   BASE=http://localhost:5201 OUT=<dir> VIDEO=<floor.y4m> NODE_PATH=$(npm root -g) node voice.cjs phone|desktop
// Proves: hold -> interim "rainbow" fires Rainbow once; "go to AR" switches mode; "take a picture" in Selfie captures;
// unknown speech -> "Try saying" chips (a chip works); quick tap -> "Hold me while you talk!"; keyboard hold;
// unsupported browser -> the button opens the magic words. Screenshots of each.
const lib = require('/home/user/cheerbearar/docs/evidence/ui-2/sim/mylib.cjs');
const path = require('path');

const KIND = process.argv[2] || 'phone';
const PHONE = KIND === 'phone';
const W = PHONE ? 390 : 1440, H = PHONE ? 844 : 900;
const SMALL = { w: 375, h: 667 }; // iPhone SE / 8: the AR placing bubble check also runs here
const VIDEO = process.env.VIDEO;
const tag = PHONE ? 'phone' : 'desktop';
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!cond) process.exitCode = 1; };

function fakeRecognition(supported) {
  return ({ supported }) => {
    if (!supported) { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined }); return; }
    window.__recs = [];
    class FakeRec {
      constructor() { this.text = ''; this.continuous = false; this.interimResults = false; window.__recs.push(this); }
      start() { this.started = true; setTimeout(() => { this.onstart && this.onstart(); this.onaudiostart && this.onaudiostart(); }, 40); }
      stop() { this.stopped = true; setTimeout(() => { if (this.text) this.emit(true); this.onend && this.onend(); }, 200); }
      abort() { this.aborted = true; }
      emit(final) {
        const r = [{ transcript: this.text }]; r.isFinal = final;
        this.onresult && this.onresult({ resultIndex: 0, results: [r] });
      }
    }
    window.SpeechRecognition = FakeRec;
    window.webkitSpeechRecognition = FakeRec;
    window.__say = (t) => { const r = window.__recs[window.__recs.length - 1]; if (!r) return false; r.text = t; r.emit(false); return true; };
  };
}

async function boot(supported = true, query = '', size = { w: W, h: H }) {
  const env = await lib.launch({ video: VIDEO, phone: PHONE, w: size.w, h: size.h });
  await env.ctx.addInitScript(fakeRecognition(supported), { supported });
  await env.ctx.addInitScript(() => {
    window.__actions = [];
    window.__photos = 0;
    try { localStorage.clear(); } catch { /* */ }
  });
  await env.page.goto(`${lib.BASE}/?test&desktop${query}`, { waitUntil: 'domcontentloaded' });
  await lib.start(env.page);
  await env.page.evaluate(() => {
    const exp = window.__cbApp.experience;
    exp.on('action', (a) => window.__actions.push(a.name));
    exp.on('photo', () => { window.__photos += 1; });
  });
  await lib.waitFor(env.page, () => window.__cbApp.store.get().started, null, 60000);
  await lib.sleep(1500);
  await env.page.evaluate(() => { const c = window.__cbApp; if (c.store.get().overlay) c.closeOverlay(); });
  await lib.sleep(600);
  return env;
}

async function orbCenter(page) {
  return page.evaluate(() => { const r = document.querySelector('[data-testid="talk-orb"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
}
async function hold(page, phrases, { shotName, beforeRelease } = {}) {
  const c = await orbCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await lib.waitFor(page, () => window.__recs.length && window.__cbApp.store.get().voice === 'listening', null, 10000);
  for (const p of phrases) { await page.evaluate((t) => window.__say(t), p); await lib.sleep(250); }
  if (beforeRelease) await beforeRelease();
  if (shotName) await lib.shot(page, shotName);
  await page.mouse.up();
  await lib.waitFor(page, () => window.__cbApp.store.get().voice === 'idle', null, 10000);
  await lib.sleep(400);
}
/** The voice bubble must never cover Place, Move, the shutter, the joystick, tools or the panel / hang-up buttons. */
async function bubbleClear(page) {
  return page.evaluate(() => {
    const b = document.querySelector('[data-testid="voice-bubble"]');
    if (!b) return { ok: false, why: 'no bubble', near: '' };
    const r = b.getBoundingClientRect();
    const hits = [];
    const near = [];
    for (const n of document.querySelectorAll('.cbx-bottom button, .cbx-stick, .cbx-shutter, [data-cmd], .cbx-above button, .cb-more, .cb-hangup, .cb-orb')) {
      const q = n.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const name = (n.getAttribute('aria-label') || n.textContent || n.className || '').toString().trim().slice(0, 28);
      near.push(name);
      if (q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) hits.push(name);
    }
    return { ok: hits.length === 0, why: hits.join(', '), near: near.join(' | '), bottom: Math.round(innerHeight - r.bottom) };
  });
}
const actions = (page) => page.evaluate(() => window.__actions.slice());
const mode = (page) => page.evaluate(() => ({ mode: window.__cbx.mode, busy: window.__cbApp.store.get().expBusy, entered: window.__cbx.debug().entered }));
async function waitMode(page, m, timeout = 90000) {
  await lib.waitFor(page, (want) => window.__cbx.mode === want && window.__cbx.debug().entered && !window.__cbApp.store.get().expBusy, m, timeout);
}

async function closeReview(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.cbx-review button, .cbx-sheet button')].find((x) => /close|done|back|not now|retake|again/i.test(x.getAttribute('aria-label') || x.textContent || ''));
    if (b) b.click();
  });
  await lib.sleep(800);
}

/** In AR (placing): the live caption and the "Try saying" chips must not cover any bottom control. */
async function arBubbleChecks(page, size) {
  const sz = size.replace('x', '-');
  const st = await page.evaluate(() => ({ placing: !!document.querySelector('[data-cmd="place"]'), place: document.querySelector('[data-cmd="place"]')?.textContent || '' }));
  let cap = null;
  await hold(page, ['banana', 'banana pancakes'], { beforeRelease: async () => { await lib.sleep(400); cap = await bubbleClear(page); await lib.shot(page, `${tag}-ar-${sz}-caption`); } });
  ok(`AR ${size}: the live words clear of every control (placing: ${st.placing ? st.place : 'no'})`, cap && cap.ok, cap ? `${cap.why || 'clear'}; bottom ${cap.bottom}px; near: ${cap.near}` : 'none');
  await lib.sleep(600);
  const unk = await bubbleClear(page);
  await lib.shot(page, `${tag}-ar-${sz}-try-saying`);
  ok(`AR ${size}: "Try saying" chips clear of every control`, unk.ok, `${unk.why || 'clear'}; bottom ${unk.bottom}px`);
  await lib.sleep(9500); // let the chips go
  if (size !== `${SMALL.w}x${SMALL.h}`) return;
  // placed AR stacks tools bottom left (Move, Leave, Games). The fake floor never gives the reticle a hit, so stand in
  // three real-size HUD tools there and check the wide chips bubble lifts above them
  await page.evaluate(() => {
    const left = document.querySelector('.cbx-slot-left');
    for (const t of ['Move', 'Leave', 'Games']) {
      const b = document.createElement('button');
      b.className = 'cbx-tool sim-standin'; b.type = 'button'; b.setAttribute('aria-label', `${t} (sim stand-in)`); b.innerHTML = `<span>${t}</span>`;
      left.appendChild(b);
    }
  });
  await hold(page, ['banana pancakes']);
  await lib.sleep(700);
  const st2 = await bubbleClear(page);
  await lib.shot(page, `${tag}-ar-${sz}-try-saying-tool-stack`);
  ok(`AR ${size} with a Move/Leave/Games stack bottom left: chips lifted clear of it`, st2.ok && st2.bottom > unk.bottom, `${st2.why || 'clear'}; bottom ${st2.bottom}px (was ${unk.bottom}px)`);
  await page.evaluate(() => document.querySelectorAll('.sim-standin').forEach((b) => b.remove()));
  await lib.sleep(9500);
}

(async () => {
  const { browser, page, logs } = await boot(true);
  try {
    // close the sheet on desktop? no: desktop keeps the sidebar; the orb stays beside it
    await lib.shot(page, `${tag}-01-idle-hint`);
    const nudge = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="voice-bubble"]');
      const o = document.querySelector('[data-testid="talk-orb"]').getBoundingClientRect();
      const r = b ? b.getBoundingClientRect() : null;
      return { text: b?.textContent || '', panel: !!document.querySelector('.cb-more'), phone: !!document.querySelector('.cb-callchip'),
        overMic: !!r && r.bottom <= o.top && r.right >= o.left + o.width / 2 && r.left <= o.left + o.width / 2 };
    });
    ok('idle: nudge "Hold to talk" right above the mic, nothing between', nudge.text === 'Hold to talk' && nudge.overMic && !nudge.panel, JSON.stringify(nudge));
    ok('no separate phone button in the column', !nudge.phone);

    // quick tap -> hint
    const c0 = await orbCenter(page);
    await page.mouse.click(c0.x, c0.y);
    await lib.sleep(300);
    const hint = await page.evaluate(() => document.querySelector('[data-testid="voice-bubble"]')?.textContent || '');
    ok('quick tap: "Hold me while you talk!"', /Hold me while you talk/.test(hint), hint);
    await lib.sleep(2800);

    // 1. hold -> interim rainbow fires Rainbow ONCE
    let fireAt = null;
    await hold(page, ['make a', 'make a rainbow', 'make a rainbow please'], {
      shotName: `${tag}-02-holding-caption`,
      beforeRelease: async () => { fireAt = (await actions(page)).filter((a) => a === 'Rainbow').length; },
    });
    await lib.sleep(1500);
    const rb = (await actions(page)).filter((a) => a === 'Rainbow').length;
    ok('interim "rainbow" fired Rainbow while still holding', fireAt === 1, `before release: ${fireAt}`);
    ok('Rainbow fired exactly once (interim + final deduped)', rb === 1, `total ${rb}`);
    if (PHONE) {
      await lib.sleep(3000);
      ok('after the first words the nudge is gone and the panel button is back', await page.evaluate(() => !!document.querySelector('.cb-more') && !document.querySelector('.cb-vbubble.is-nudge')));
    }
    const said = await page.evaluate(() => window.__cbApp.store.get().messages.filter((m) => m.kind === 'bear').map((m) => m.text));
    ok('she answered with a canned line (no trigger word)', said.length >= 1 && !/rainbow|colou?r/i.test(said.join(' ')), said.join(' | '));
    await lib.shot(page, `${tag}-03-after-rainbow`);
    await lib.sleep(3500); // cooldown + her line

    // 2. unknown speech -> chips
    await hold(page, ['banana pancakes']);
    await lib.sleep(300);
    const unk = await page.evaluate(() => ({ text: document.querySelector('.cb-vbubble.is-unknown')?.textContent || '', chips: [...document.querySelectorAll('.cb-vchip')].map((b) => b.textContent) }));
    ok('unknown speech: "Try saying" + 3 chips', /Try saying/.test(unk.text) && unk.chips.length === 3, `${unk.chips.join(', ')}`);
    await lib.shot(page, `${tag}-04-unknown-chips`);
    // the chips stay 9 s; a slow software-GL screenshot can outlast that, so ask again if they are gone
    if (!(await page.evaluate(() => document.querySelectorAll('.cb-vchip').length))) { await hold(page, ['banana pancakes']); await lib.sleep(300); }
    const before = (await actions(page)).length;
    await page.evaluate(() => document.querySelectorAll('.cb-vchip')[1].click()); // "Dance"
    await lib.sleep(1500);
    const after = await actions(page);
    ok('tapping a chip runs it', after.length === before + 1, after.slice(-1)[0]);
    await lib.sleep(3500);

    // 3. keyboard hold (Space on the focused button)
    await page.focus('[data-testid="talk-orb"]');
    await page.keyboard.down('Space');
    await lib.waitFor(page, () => window.__recs.length && window.__cbApp.store.get().voice === 'listening', null, 10000);
    await page.evaluate(() => window.__say('party time'));
    await lib.sleep(300);
    await page.keyboard.up('Space');
    await lib.waitFor(page, () => window.__cbApp.store.get().voice === 'idle', null, 10000);
    await lib.sleep(1200);
    ok('keyboard: hold Space works', (await actions(page)).includes('Party'));
    await lib.sleep(2500);

    if (!PHONE) {
      // desktop: the camera engine does not run in a desktop browser (real visitors get the open-on-phone QR); prove
      // the voice command asked for AR (the experience began the switch), then let it fall back
      await page.evaluate(() => { window.__modes = []; window.__cbx.on('mode', (m) => window.__modes.push(m.mode)); });
      await hold(page, ['go to', 'go to AR']);
      await lib.sleep(1500);
      const asked = await page.evaluate(() => window.__modes.slice());
      ok('"go to AR" asked the experience for AR (desktop)', asked.includes('ar'), asked.join(','));
      await lib.waitFor(page, () => !window.__cbApp.store.get().expBusy, null, 90000);
      await page.evaluate(() => { const b = [...document.querySelectorAll('.cbx-sheet button, .cbx-sheet-btn')].find((x) => /OK|Close/i.test(x.textContent)); b && b.click(); });
      await lib.sleep(800);
      await lib.waitFor(page, () => window.__cbx.mode === 'showcase' && !window.__cbApp.store.get().expBusy, null, 90000).catch(() => {});
      await page.evaluate(() => { window.__modes = []; });
      await hold(page, ['photo']);
      await lib.sleep(1500);
      const asked2 = await page.evaluate(() => window.__modes.slice());
      ok('bare "photo" in 3D (no shutter) asked for 3D Photo (desktop)', asked2.includes('photo'), asked2.join(','));
      await lib.waitFor(page, () => !window.__cbApp.store.get().expBusy, null, 90000);
      await page.evaluate(() => { const b = [...document.querySelectorAll('.cbx-sheet button, .cbx-sheet-btn')].find((x) => /OK|Close/i.test(x.textContent)); b && b.click(); });
      await lib.sleep(800);
      if ((await mode(page)).mode !== 'showcase') { await page.evaluate(() => window.__cbApp.voiceUi.runExample('go to 3d')); await waitMode(page, 'showcase'); }
      await lib.sleep(2500);
    }
    if (VIDEO && PHONE) {
      // 4. "go to AR" (short last word: handed over in the release, a user gesture)
      await hold(page, ['go to', 'go to AR']);
      await waitMode(page, 'ar');
      ok('"go to AR" switched to AR', (await mode(page)).mode === 'ar');
      await lib.sleep(2500);
      await lib.shot(page, `${tag}-05-ar-by-voice`);
      await arBubbleChecks(page, `${W}x${H}`);
      // 5. selfie, then "take a picture"
      await hold(page, ['selfie please']);
      await waitMode(page, 'face');
      ok('"selfie" switched to Selfie', (await mode(page)).mode === 'face');
      await lib.sleep(4000);
      await hold(page, ['take a picture']);
      try { await lib.waitFor(page, () => window.__photos > 0, null, 30000); } catch { /* reported below */ }
      ok('"take a picture" in Selfie captured a photo', (await page.evaluate(() => window.__photos)) > 0);
      await lib.sleep(1200);
      await lib.shot(page, `${tag}-06-selfie-captured`);
      await page.keyboard.press('Escape');
      await closeReview(page);
      // bare "photo" where there is a shutter (Selfie): it takes the photo, it does not switch
      await lib.sleep(2500);
      const p0 = await page.evaluate(() => window.__photos);
      await hold(page, ['photo']);
      try { await lib.waitFor(page, (n) => window.__photos > n, p0, 30000); } catch { /* reported below */ }
      ok('bare "photo" in Selfie (shutter) took a photo, stayed in Selfie', (await page.evaluate(() => window.__photos)) > p0 && (await mode(page)).mode === 'face');
      await page.keyboard.press('Escape');
      await closeReview(page);
      // back to 3D by voice (no gesture needed)
      await page.evaluate(() => window.__cbApp.voiceUi.runExample('go to 3d'));
      await waitMode(page, 'showcase');
      ok('"go to 3D" (chip) back to 3D', (await mode(page)).mode === 'showcase');
      await lib.sleep(2000);
      // bare "photo" where there is no shutter (3D): it opens 3D Photo
      await hold(page, ['photo']);
      await waitMode(page, 'photo').catch(() => {});
      ok('bare "photo" in 3D (no shutter) opened 3D Photo', (await mode(page)).mode === 'photo');
      await lib.sleep(2500);
      await lib.shot(page, `${tag}-13-photo-by-voice`);
      await page.evaluate(() => window.__cbApp.voiceUi.runExample('go to 3d'));
      await waitMode(page, 'showcase');
    }

    // 6. Settings toggle
    await page.evaluate(() => window.__cbApp.openSheet('settings'));
    await lib.sleep(900);
    await page.evaluate(() => { const g = [...document.querySelectorAll('.cb-group')].find((x) => /Talking to Cheer Bear/.test(x.textContent)); if (!g) return; g.scrollIntoView({ block: 'start' }); let p = g.parentElement; while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement; p && p.scrollBy(0, -20); });
    await lib.sleep(400);
    await lib.shot(page, `${tag}-07-settings`);
    const sw = await page.evaluate(() => [...document.querySelectorAll('.cb-switch')].map((b) => b.textContent).filter((t) => /Tap to talk|answers out loud/.test(t)).length);
    ok('Settings has Tap to talk + spoken replies switches', sw === 2);
    // tap-to-talk works
    await page.evaluate(() => [...document.querySelectorAll('.cb-switch')].find((b) => /Tap to talk/.test(b.textContent)).click());
    await page.evaluate(() => window.__cbApp.openSheet('talk'));
    await lib.sleep(700);
    await page.evaluate(() => { const p = document.querySelector('.cb-panel'); if (p) p.scrollTop = 0; });
    await lib.sleep(200);
    await lib.shot(page, `${tag}-08-talk-tab`);
    if (!PHONE) {
      await page.evaluate(() => document.querySelector('.cb-holdbtn').click());
    } else {
      await page.evaluate(() => window.__cbApp.closeSheet());
      await lib.sleep(500);
      const c1 = await orbCenter(page);
      await page.mouse.click(c1.x, c1.y);
    }
    await lib.waitFor(page, () => window.__cbApp.store.get().voice === 'listening', null, 10000);
    await page.evaluate(() => window.__say('sparkle'));
    await lib.sleep(300);
    if (!PHONE) await page.evaluate(() => document.querySelector('.cb-holdbtn').click());
    else { const c2 = await orbCenter(page); await page.mouse.click(c2.x, c2.y); }
    await lib.waitFor(page, () => window.__cbApp.store.get().voice === 'idle', null, 10000);
    await lib.sleep(1200);
    ok('tap-to-talk: tap, say "sparkle", tap', (await actions(page)).includes('Sparkle'));

    const errs = lib.errorsOf(logs).filter((l) => !/favicon|404.*\.map/.test(l));
    ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' || '));
  } catch (e) {
    ok('run', false, String(e && e.stack || e));
    await lib.shot(page, `${tag}-zz-error`).catch(() => {});
  } finally {
    await browser.close();
  }

  // 7. unsupported browser -> fallback
  const u = await boot(false);
  try {
    const st = await u.page.evaluate(() => window.__cbApp.store.get().voice);
    ok('unsupported: state', st === 'unsupported', st);
    await lib.shot(u.page, `${tag}-09-unsupported-idle`);
    const c = await orbCenter(u.page);
    await u.page.mouse.click(c.x, c.y);
    await lib.sleep(900);
    const s = await u.page.evaluate(() => ({ open: window.__cbApp.store.get().sheetOpen, tab: window.__cbApp.store.get().tab, toast: window.__cbApp.store.get().toast?.text }));
    ok('unsupported: the button opens the magic words with a friendly line', s.open && s.tab === 'actions' && /tap a magic word/.test(s.toast || ''), JSON.stringify(s));
    await lib.shot(u.page, `${tag}-10-unsupported-fallback`);
  } catch (e) {
    ok('unsupported run', false, String(e));
  } finally {
    await u.browser.close();
  }
  // 8. calling lives in the Talk tab: "Call Cheer Bear" starts the (demo) call; the orb is the call orb meanwhile
  const k = await boot(true, '&mockVoice=fast');
  try {
    await lib.sleep(500);
    ok('no phone button beside the mic (calls available)', !(await k.page.evaluate(() => !!document.querySelector('.cb-callchip'))));
    await k.page.evaluate(() => { const c = window.__cbApp; c.updatePrefs?.({ micExplained: true }); c.openSheet('talk'); });
    await lib.sleep(700);
    const label = await k.page.evaluate(() => document.querySelector('.cb-voicecard-call')?.textContent || '');
    ok('Talk tab has the "Call Cheer Bear" button', /Call Cheer Bear/.test(label), label);
    await lib.shot(k.page, `${tag}-11-talk-tab-call`);
    await k.page.evaluate(() => document.querySelector('.cb-voicecard-call').click());
    await lib.sleep(400);
    await k.page.evaluate(() => { const b = document.querySelector('.cb-mic .cb-btn.is-primary'); if (b) b.click(); });
    await lib.waitFor(k.page, () => window.__cbApp.store.get().call === 'in-call', null, 20000);
    // (desktop: the sidebar's call card stands in for the orb while open; close it to see the orb)
    await k.page.evaluate(() => window.__cbApp.closeSheet()); await lib.sleep(600);
    ok('the Talk tab button starts the (demo) call; the orb becomes the call orb', await k.page.evaluate(() => document.querySelector('.cb-orb')?.classList.contains('is-live')));
    await lib.shot(k.page, `${tag}-12-in-call`);
    await k.page.evaluate(() => window.__cbApp.hangUp());
    await lib.waitFor(k.page, () => window.__cbApp.store.get().call === 'idle', null, 20000);
    await lib.sleep(500);
    ok('after the call the orb is a mic again', await k.page.evaluate(() => document.querySelector('.cb-orb').classList.contains('is-voice')));
  } catch (e) {
    ok('calls run', false, String(e));
  } finally {
    await k.browser.close();
  }

  // 9. the bubble while placing in AR on a small phone (375x667): never over Place / Move / tools / the mic column
  if (VIDEO && PHONE) {
    const m = await boot(true, '', SMALL);
    try {
      await hold(m.page, ['go to', 'go to AR']);
      await waitMode(m.page, 'ar');
      await lib.sleep(2500);
      await arBubbleChecks(m.page, `${SMALL.w}x${SMALL.h}`);
    } catch (e) {
      ok('small phone AR run', false, String(e));
      await lib.shot(m.page, `${tag}-zz-small-error`).catch(() => {});
    } finally {
      await m.browser.close();
    }
  }

  console.log(results.join('\n'));
})();
