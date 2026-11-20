// voice-5: a full demo-call conversation in the REAL app (real experience, real voice module), headless Chromium.
// speechSynthesis and SpeechRecognition are faked (headless Chromium has neither working): the fake voice records
// every line with its start/end time and speaks ~230 ms per word (word boundaries optional: BOUNDARIES=0 for a voice
// that sends none, like many Android voices); the fake recogniser records when it is open, hears the speaker (her
// words become results while it is open: the echo test) and `__child(text)` makes the child talk into it.
// No ?mockVoice: "Call Cheer Bear" must start the demo call by itself where calling is not set up.
//   BASE=http://localhost:5223 OUT=<dir> NODE_PATH=$(npm root -g) node call.cjs phone|desktop
const lib = require('/home/user/cheerbearar/docs/evidence/ui-2/sim/mylib.cjs');

const KIND = process.argv[2] || 'phone';
const PHONE = KIND === 'phone';
const W = PHONE ? 390 : 1440, H = PHONE ? 844 : 900;
const BOUNDARIES = process.env.BOUNDARIES !== '0';
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!cond) process.exitCode = 1; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), KIND, ...a);

function fakes({ boundaries }) {
  const T0 = performance.now();
  const now = () => Math.round(performance.now() - T0);
  window.__spoken = [];
  window.__recs = [];
  window.__open = null;
  class FakeUtterance { constructor(text) { this.text = text; this.pitch = 1; this.rate = 1; this.volume = 1; this.voice = null; } }
  const voices = [{ name: 'Albert', lang: 'en-US', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true }];
  const synth = {
    speaking: false, pending: false, cur: null,
    getVoices() { return voices; },
    speak(u) {
      if (!u.text.trim()) return;
      const rec = { text: u.text, voice: u.voice ? u.voice.name : null, pitch: u.pitch, rate: u.rate, start: now(), end: -1, cancelled: false };
      window.__spoken.push(rec);
      this.cur = u; this.rec = rec; this.speaking = true;
      const words = [...u.text.matchAll(/[A-Za-z0-9'’]+/g)];
      let i = 0;
      setTimeout(() => {
        if (this.cur !== u) return;
        u.onstart && u.onstart({});
        const next = () => {
          if (this.cur !== u) return;
          // the open mic hears the speaker
          const r = window.__open;
          if (r && i > 0) { r.heardBear = (r.heardBear || 0) + 1; r.results[0] = Object.assign([{ transcript: words.slice(0, i).map((w) => w[0]).join(' ') }], { isFinal: false }); r.onresult && r.onresult({ resultIndex: 0, results: r.results }); }
          if (i < words.length) { if (boundaries) u.onboundary && u.onboundary({ name: 'word', charIndex: words[i].index }); i++; setTimeout(next, 230); }
          else { this.cur = null; this.speaking = false; rec.end = now(); u.onend && u.onend({}); }
        };
        next();
      }, 60);
    },
    cancel() { const u = this.cur; if (this.rec && this.rec.end < 0) { this.rec.end = now(); this.rec.cancelled = true; } this.cur = null; this.speaking = false; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    resume() {}, pause() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;
  class FakeRec {
    constructor() { this.results = []; this.info = { start: -1, stop: -1 }; }
    start() { this.info.start = now(); window.__recs.push(this.info); window.__open = this; setTimeout(() => { this.onstart && this.onstart(); this.onaudiostart && this.onaudiostart(); }, 60); }
    stop() { this.info.stop = now(); if (window.__open === this) window.__open = null; const fin = this.text; setTimeout(() => { if (fin) { this.results[this.results.length - 1 || 0] = Object.assign([{ transcript: fin }], { isFinal: true }); this.onresult && this.onresult({ resultIndex: 0, results: this.results }); } this.onend && this.onend(); }, 200); }
    abort() { this.info.stop = now(); this.info.aborted = true; if (window.__open === this) window.__open = null; }
  }
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = FakeRec;
  // the child talks: words arrive as interim results (80 ms apart), the final 500 ms after the last word
  window.__child = (text, { final = true } = {}) => {
    const r = window.__open;
    if (!r) return false;
    const words = text.split(' ');
    const idx = r.results.length;
    r.text = text;
    words.forEach((_, i) => setTimeout(() => {
      if (window.__open !== r) return;
      r.results[idx] = Object.assign([{ transcript: words.slice(0, i + 1).join(' ') }], { isFinal: false });
      r.onresult && r.onresult({ resultIndex: idx, results: r.results });
    }, i * 80));
    if (final) setTimeout(() => {
      if (window.__open !== r) return;
      r.results[idx] = Object.assign([{ transcript: text }], { isFinal: true });
      window.__childFinalAt = now();
      r.onresult && r.onresult({ resultIndex: idx, results: r.results });
    }, words.length * 80 + 500);
    return true;
  };
  window.__now = now;
}

(async () => {
  const env = await lib.launch({ phone: PHONE, w: W, h: H });
  const { page, logs } = env;
  await env.ctx.grantPermissions(['microphone']);
  await env.ctx.addInitScript(fakes, { boundaries: BOUNDARIES });
  await env.ctx.addInitScript(() => { try { localStorage.clear(); } catch { /* */ } window.__actions = []; });
  await page.goto(`${lib.BASE}/?test&desktop`, { waitUntil: 'domcontentloaded' });
  await lib.start(page);
  await page.evaluate(() => {
    window.__cbApp.experience.on('action', (a) => window.__actions.push(a.name));
    window.__phases = [];
    let last = '';
    window.__cbApp.store.subscribe(() => { const t = window.__cbApp.store.get().callTurn; const k = t.phase + (t.text ? ':' + t.text : ''); if (k !== last) { last = k; window.__phases.push(`${window.__now()} ${k}`); } });
    window.__sawDots = 0;
    new MutationObserver(() => { if (document.querySelector('.cb-vbubble-dots')) window.__sawDots += 1; }).observe(document.body, { subtree: true, childList: true });
    window.__caps = []; let lc = false;
    window.__cbApp.store.subscribe(() => { const s = window.__cbApp.store.get(); if (s.captionOn !== lc) { lc = s.captionOn; window.__caps.push(`${window.__now()} cap=${lc} phase=${s.callTurn.phase} voice=${s.voice}`); } });
  });
  await lib.waitFor(page, () => window.__cbApp.store.get().started, null, 60000);
  await lib.sleep(1500);
  await page.evaluate(() => { const c = window.__cbApp; if (c.store.get().overlay) c.closeOverlay(); });
  await lib.sleep(500);
  const st = () => page.evaluate(() => { const s = window.__cbApp.store.get(); return { call: s.call, demo: s.callDemo, turn: s.callTurn, speaking: s.speaking, caption: s.captionOn, bubble: s.voiceBubble }; });
  const phase = async () => (await st()).turn.phase;
  const waitPhase = (p, ms = 20000) => lib.waitFor(page, (want) => window.__cbApp.store.get().callTurn.phase === want, p, ms);
  const lines = () => page.evaluate(() => window.__spoken.map((u) => u.text));

  // 1) Start the call the way a child does: Talk tab "Call Cheer Bear" (no ?mockVoice: calling is not set up here)
  await page.evaluate(() => window.__cbApp.openSheet('talk'));
  await lib.sleep(600);
  const callBtn = await page.$('.cb-voicecard-call, .cb-callcard .cb-btn.is-primary');
  ok('Talk tab has "Call Cheer Bear"', !!callBtn);
  if (callBtn) await callBtn.click(); else await page.evaluate(() => window.__cbApp.requestCall());
  await lib.sleep(400);
  if (await page.evaluate(() => window.__cbApp.store.get().micAsk)) {
    const b = await page.$('.cb-mic .cb-btn.is-primary');
    if (b) await b.click(); else await page.evaluate(() => window.__cbApp.confirmMic());
  }
  await page.evaluate(() => window.__cbApp.closeSheet());
  await lib.waitFor(page, () => window.__cbApp.store.get().call === 'ringing', null, 15000);
  await lib.shot(page, `${KIND}-01-ringing`);
  await lib.waitFor(page, () => window.__cbApp.store.get().call === 'in-call', null, 15000);
  ok('without Twilio, "Call Cheer Bear" starts the demo call (no "calling isn\'t working")', (await st()).demo === true);
  await lib.waitFor(page, () => window.__spoken.length > 0 && window.speechSynthesis.speaking, null, 15000);
  await lib.sleep(900);
  await lib.shot(page, `${KIND}-02-greeting-bubble-grows`);
  const greetCaption = await st();
  ok('her words show in her speech bubble WHILE she talks (demo call)', greetCaption.caption === true && greetCaption.turn.phase === 'bear');
  await waitPhase('listening');
  // her last line stays ~1.2 s, then the turn bubble takes its place
  await lib.waitFor(page, () => !window.__cbApp.store.get().captionOn, null, 5000);
  await lib.sleep(300);
  await lib.shot(page, `${KIND}-03-your-turn`);
  ok('after her greeting it is your turn ("Your turn!" bubble)', await page.evaluate(() => /Your turn/.test(document.querySelector('[data-testid="voice-bubble"]')?.textContent || '')));

  // 2) Conversation turns
  const turnsLog = [];
  const child = async (text, opts) => {
    await lib.waitFor(page, () => window.__cbApp.store.get().callTurn.phase === 'listening' && !!window.__open, null, 20000);
    await lib.sleep(150);
    const heard = await page.evaluate(([t, o]) => window.__child(t, o), [text, opts]);
    if (!heard) log('child talked but no mic was open:', text);
    return heard;
  };
  async function turn(text, shotHearing) {
    await waitPhase('listening');
    const before = (await lines()).length;
    await child(text);
    if (shotHearing) { await lib.sleep(text.split(' ').length * 80 + 100); await lib.shot(page, shotHearing); }
    await lib.waitFor(page, (n) => window.__spoken.length > n, before, 15000);
    const r = await page.evaluate(() => ({ line: window.__spoken[window.__spoken.length - 1], finalAt: window.__childFinalAt }));
    const gap = r.line.start - r.finalAt;
    turnsLog.push({ you: text, her: r.line.text, gapMs: gap });
    log(`you: "${text}" -> Cheer Bear (${gap} ms): "${r.line.text}"`);
    await lib.waitFor(page, () => !window.speechSynthesis.speaking, null, 20000);
    return r.line.text;
  }
  await turn('hi Cheer Bear how are you', `${KIND}-04-hearing-your-words`);
  // the "thinking" dots between your words and her answer
  const nGood = (await lines()).length;
  await child('good');
  await lib.waitFor(page, () => window.__cbApp.store.get().callTurn.phase === 'thinking', null, 8000).catch(() => undefined);
  const sawThinking = await page.evaluate(() => window.__phases.slice(-6).some((p) => / thinking/.test(p)));
  log('phases:', JSON.stringify(await page.evaluate(() => window.__phases.slice(-12))));
  if (sawThinking && (await phase()) === 'thinking') await lib.shot(page, `${KIND}-05-thinking`);
  ok('her old line is gone while you talk or she thinks (no two bubbles at the bottom)', await page.evaluate(() => !window.__cbApp.store.get().captionOn || window.__cbApp.store.get().callTurn.phase === 'bear'));
  await lib.waitFor(page, (n) => window.__spoken.length > n, nGood, 15000);
  const goodAns = (await lines())[nGood];
  turnsLog.push({ you: 'good', her: goodAns });
  log(`you: "good" -> Cheer Bear: "${goodAns}"`);
  ok('"thinking" shows between your words and her answer', sawThinking);
  ok('the thinking dots render in the bubble', await page.evaluate(() => window.__sawDots > 0));
  ok('"good" after "how are you?" gets a happy answer, not "not sure"', !/not sure|Hmm|still here|still there/i.test(goodAns), goodAns);
  await lib.waitFor(page, () => !window.speechSynthesis.speaking, null, 20000);
  await turn('my name is Sam');
  const dance = await turn('can you dance');
  await lib.sleep(1200);
  await lib.shot(page, `${KIND}-06-dance`);
  await turn('tell me a joke');
  await turn('knock knock');
  const boo = await turn('boo');
  await turn("don't cry it's only a joke");
  await turn('can you sing me a song');
  ok('knock knock: "Boo who?"', boo === 'Boo who?', boo);
  ok('"can you dance?" -> she says dance', /dance/i.test(dance), dance);

  // 3) Barge-in by touch: tap the mic while she talks
  await child('tell me a story');
  await lib.waitFor(page, () => window.speechSynthesis.speaking, null, 15000);
  await lib.sleep(700);
  await page.click('[data-testid="talk-orb"]');
  await lib.sleep(250);
  const barge = await st();
  ok('tap the mic while she talks: she stops and it is your turn', !(await page.evaluate(() => window.speechSynthesis.speaking)) && ['listening', 'hearing'].includes(barge.turn.phase), barge.turn.phase);
  if (barge.caption) log('caps:', JSON.stringify(await page.evaluate(() => window.__caps.slice(-6))), JSON.stringify(await page.evaluate(() => window.__phases.slice(-6))));
  ok('after a tap her caption goes at once (no two bubbles)', !barge.caption, String(barge.caption));
  await lib.shot(page, `${KIND}-07-barge-in-your-turn`);
  await lib.sleep(600);

  // 4) A voice command in the call
  const before = (await lines()).length;
  await child('take a picture');
  await lib.waitFor(page, (n) => window.__spoken.length > n, before, 15000);
  const cam = await st();
  const camLine = (await lines()).slice(-1)[0];
  log('take a picture ->', camLine, JSON.stringify(cam.bubble));
  ok('"take a picture" in the call is a command (camera mode or the shutter), not small talk', /camera|tap|smile|cheese|selfie|photo/i.test(camLine + ' ' + (cam.bubble?.text || '')), camLine);
  await lib.sleep(200);
  await lib.shot(page, `${KIND}-08-command-in-call`);
  await lib.sleep(700);
  // no camera in this headless browser: the friendly "camera is switched off" sheet opens; close it like a child would
  const okBtn = page.getByRole('button', { name: /^OK$/ });
  if (await okBtn.count()) { await okBtn.first().click(); log('closed the camera-off sheet'); }
  await lib.sleep(600);
  await page.evaluate(() => window.__cbApp.voiceUi.clearBubble());
  await lib.waitFor(page, () => !window.speechSynthesis.speaking, null, 20000);

  // 5) Chat view of the conversation (Chat mode in the Talk tab)
  await page.evaluate(() => { const c = window.__cbApp; c.setUiMode('chat'); c.openSheet('talk'); });
  await lib.sleep(800);
  await lib.shot(page, `${KIND}-09-chat-shows-the-conversation`);
  const msgs = await page.evaluate(() => window.__cbApp.store.get().messages.filter((m) => m.kind === 'user' || m.kind === 'bear').map((m) => [m.kind, m.text, m.source]));
  ok('the conversation shows in the chat (your words and hers)', msgs.filter((m) => m[0] === 'user').length >= 5 && msgs.filter((m) => m[0] === 'bear').length >= 5, `${msgs.length} messages`);
  await page.evaluate(() => window.__cbApp.closeSheet());
  await lib.sleep(500);

  // 6) Half duplex / echo over the whole call
  const timing = await page.evaluate(() => ({ spoken: window.__spoken, recs: window.__recs }));
  const overl = [];
  for (const u of timing.spoken) for (const r of timing.recs) {
    const rEnd = r.stop < 0 ? 1e12 : r.stop; const uEnd = u.end < 0 ? 1e12 : u.end;
    if (r.start < uEnd - 5 && rEnd > u.start + 80) overl.push(`${u.text.slice(0, 20)}`);
  }
  ok('the mic is never open while she talks (half duplex; warm-up at ring time excluded)', overl.length === 0, overl.slice(0, 3).join(' | '));
  const heardBear = timing.recs.reduce((n, r) => n + (r.heardBear || 0), 0);
  const userFinals = await page.evaluate(() => window.__cbApp.store.get().messages.filter((m) => m.kind === 'user').map((m) => m.text));
  ok('she never answers her own voice', !userFinals.some((t) => timing.spoken.some((u) => u.text.toLowerCase().startsWith(t.toLowerCase()) && t.length > 6)), `${heardBear}`);
  const gaps = turnsLog.filter((t) => typeof t.gapMs === 'number').map((t) => t.gapMs);
  ok('your words end -> her voice under 1.2 s every turn', gaps.every((g) => g < 1200), gaps.join(', '));
  const acts = await page.evaluate(() => window.__actions.slice());
  const trig = await page.evaluate(() => window.__cbApp.store.get().messages.filter((m) => m.kind === 'action').map((m) => m.text));
  log('actions:', JSON.stringify(trig), JSON.stringify(acts));
  ok('moments fired only when asked (Dance), never from small talk', trig.length >= 1 && trig.every((t) => /dance|wake|sleep/i.test(t)), trig.join(', '));

  // 7) Quiet: nobody talks -> one "still there?" -> paused ("Tap me to talk!")
  await waitPhase('listening');
  await lib.waitFor(page, () => /still/i.test(window.__spoken[window.__spoken.length - 1].text), null, 25000);
  await waitPhase('paused', 30000);
  await lib.sleep(400);
  await lib.shot(page, `${KIND}-10-paused-tap-to-talk`);
  const pausedRecs = (await page.evaluate(() => window.__recs.length));
  await lib.sleep(2500);
  ok('quiet: one "still there?", then it waits for a tap (no endless listening)', (await page.evaluate(() => window.__recs.length)) === pausedRecs);
  await page.click('[data-testid="talk-orb"]');
  await waitPhase('listening', 5000).then(() => ok('a tap resumes listening', true), () => ok('a tap resumes listening', false));

  // 8) Hang up, then hold to talk: "how are you" gets a spoken answer (not only "Try saying")
  await page.evaluate(() => window.__cbApp.hangUp());
  await lib.waitFor(page, () => window.__cbApp.store.get().call === 'idle', null, 10000);
  await lib.sleep(2500);
  ok('hang up: mic closed', await page.evaluate(() => window.__open === null));
  const orb = await page.evaluate(() => { const r = document.querySelector('[data-testid="talk-orb"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const n0 = (await lines()).length;
  await page.mouse.move(orb.x, orb.y);
  await page.mouse.down();
  await lib.waitFor(page, () => window.__cbApp.store.get().voice === 'listening', null, 10000);
  await page.evaluate(() => window.__child('how are you today', { final: false }));
  await lib.sleep(700);
  await page.mouse.up();
  await lib.waitFor(page, (n) => window.__spoken.length > n, n0, 10000).catch(() => undefined);
  const holdAns = (await lines()).slice(n0);
  await lib.sleep(700);
  await lib.shot(page, `${KIND}-11-hold-to-talk-answers`);
  log('hold "how are you today" ->', JSON.stringify(holdAns));
  log('hold caps:', JSON.stringify(await page.evaluate(() => window.__caps.slice(-4))), JSON.stringify(await page.evaluate(() => ({ b: window.__cbApp.store.get().voiceBubble, v: window.__cbApp.store.get().voice }))));
  ok('hold to talk: your words step aside while her answer shows (no two bubbles)', await page.evaluate(() => { const s = window.__cbApp.store.get(); return !(s.captionOn && document.querySelector('[data-testid="voice-bubble"]')); }));
  ok('hold to talk "how are you today" -> she answers (same brain as the call)', holdAns.length === 1 && /cheery|happy|great/i.test(holdAns[0]), holdAns.join(' | '));

  const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !/favicon|8th|xr8|404/i.test(l));
  ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  console.log(JSON.stringify(turnsLog, null, 1));
  await env.browser.close();
})().catch((e) => { console.error(e); console.log(results.join('\n')); process.exit(1); });
