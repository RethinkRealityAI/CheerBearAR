// The real app at /?mockVoice with the real experience: a full demo conversation through the chat UI.
// speechSynthesis and speech recognition are faked (headless Chromium has neither): the fake voice records what she
// says and sends word boundaries every 110 ms. Checks: she greets once and waits, answers typed messages out loud,
// her mouth moves (bear morph weights sampled), "can you dance?" fires Dance once, small talk fires nothing,
// nothing loops. Screenshots the chat.
//   BASE=http://localhost:5192 node demo.cjs phone|desktop
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:5192';
const OUT = path.join(__dirname, '..');
const which = process.argv[2] || 'phone';
const phone = which === 'phone';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), which, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_SPEECH = `
  window.__spoken = [];
  class FakeUtterance { constructor(text) { this.text = text; this.pitch = 1; this.rate = 1; this.volume = 1; this.voice = null; } }
  const voices = [{ name: 'Albert', lang: 'en-US', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true }];
  const synth = {
    speaking: false, pending: false, cur: null,
    getVoices() { return voices; },
    speak(u) {
      window.__spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, voice: u.voice ? u.voice.name : null, at: Date.now() });
      if (!u.text.trim()) return;
      this.cur = u; this.speaking = true;
      const words = [...u.text.matchAll(/[A-Za-z0-9'\\u2019]+/g)];
      let i = 0;
      setTimeout(() => {
        if (this.cur !== u) return;
        u.onstart && u.onstart({});
        const next = () => {
          if (this.cur !== u) return;
          if (i < words.length) { u.onboundary && u.onboundary({ name: 'word', charIndex: words[i].index }); i++; setTimeout(next, 110); }
          else { this.cur = null; this.speaking = false; u.onend && u.onend({}); }
        };
        next();
      }, 40);
    },
    cancel() { const u = this.cur; this.cur = null; this.speaking = false; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    resume() {}, pause() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;
  class FakeRec { start() { setTimeout(() => this.onstart && this.onstart(), 5); } stop() { this.onend && this.onend(); } abort() {} }
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = FakeRec;
`;

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    permissions: ['microphone'],
  });
  await ctx.addInitScript({ content: FAKE_SPEECH });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || /\[experience|\[xr|\[app/.test(m.text())) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?test&desktop&mockVoice=fast`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, { timeout: 240000, polling: 250 });
  await page.click('.cbx-start');
  for (let i = 0; ; i += 1) {
    const st = await page.evaluate(() => ({ cbx: !!window.__cbx, started: !!(window.__cbx && window.__cbx.started), app: !!window.__cbApp, start: !!document.querySelector('.cbx-start'), startDisabled: document.querySelector('.cbx-start')?.disabled }));
    if (st.cbx && st.started && st.app) break;
    if (i % 5 === 0) log('waiting for start', JSON.stringify(st), errors.slice(-3).join(' | '));
    if (i > 5 && st.start && !st.startDisabled) await page.click('.cbx-start').catch(() => undefined);
    if (i === 20) await page.screenshot({ path: '/tmp/claude-0/-home-user/4f1b8cb4-b3be-5904-9e8a-0dd5421f629c/scratchpad/voice2/stuck.jpg', type: 'jpeg' }).catch(() => undefined);
    if (i > 150) throw new Error('experience did not start');
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.__cbApp.closeOverlay(); });
  await page.evaluate(() => { const c = window.__cbApp; c.setUiMode('chat'); c.openSheet('talk'); });
  await sleep(500);

  // Sample the bear's mouth (morph weights) every 40 ms from here on.
  await page.evaluate(() => {
    const meshes = [];
    window.__cbx.internals.bear.object.traverse((o) => { if (o.morphTargetDictionary && o.morphTargetInfluences) meshes.push(o); });
    window.__mouth = [];
    setInterval(() => {
      let jaw = 0; let vis = 0; let top = '';
      for (const m of meshes) {
        for (const [name, i] of Object.entries(m.morphTargetDictionary)) {
          const v = m.morphTargetInfluences[i];
          if (name === 'jawOpen') jaw = Math.max(jaw, v);
          if (name.startsWith('viseme_') && v > vis) { vis = v; top = name; }
        }
      }
      window.__mouth.push({ t: Date.now(), jaw, vis, top, speaking: window.speechSynthesis.speaking });
    }, 40);
  });

  // Start the demo call from the talk orb (mic explainer first if shown).
  // (the talk orb is hidden behind the open sheet on phones; the call button in the sheet does the same thing)
  const btn = await page.$('.cb-callcard button.cb-btn, .cb-callcard button');
  if (btn) await btn.click(); else await page.evaluate(() => window.__cbApp.requestCall());
  await sleep(400);
  if (await page.evaluate(() => window.__cbApp.store.get().micAsk)) await page.evaluate(() => window.__cbApp.confirmMic());
  await page.waitForFunction(() => window.__spoken.filter((u) => u.text.trim()).length >= 1, null, { timeout: 30000, polling: 250 });
  await page.waitForFunction(() => !window.speechSynthesis.speaking, null, { timeout: 30000, polling: 250 });
  log('greeting:', JSON.stringify(await page.evaluate(() => window.__spoken.filter((u) => u.text.trim()).map((u) => [u.text, u.voice, u.pitch, u.rate]))));
  await sleep(4000); // she should wait here, not carry on talking
  const afterWait = await page.evaluate(() => window.__spoken.filter((u) => u.text.trim()).length);
  log('lines spoken after greeting + 4 s wait:', afterWait);

  const say = async (text) => {
    const before = await page.evaluate(() => window.__spoken.filter((u) => u.text.trim()).length);
    await page.fill('#cb-input', text);
    await page.press('#cb-input', 'Enter');
    await page.waitForFunction((n) => window.__spoken.filter((u) => u.text.trim()).length > n, before, { timeout: 30000, polling: 250 });
    await page.waitForFunction(() => !window.speechSynthesis.speaking, null, { timeout: 30000, polling: 250 });
    await sleep(1600);
    const spoken = await page.evaluate(() => window.__spoken.filter((u) => u.text.trim()).map((u) => u.text));
    log(`you: "${text}" -> Cheer Bear: "${spoken[spoken.length - 1]}"`);
  };
  await say('hi! how are you?');
  await say('my name is Sam');
  await say('can you dance?');
  await sleep(1500);
  if (phone) await page.screenshot({ path: path.join(OUT, 'phone-01-demo-chat-dance.jpg'), type: 'jpeg', quality: 70 });
  await say('tell me a joke');
  await sleep(4000);

  const res = await page.evaluate(() => {
    const s = window.__cbApp.store.get();
    const msgs = s.messages.map((m) => ({ kind: m.kind, text: m.text, final: m.final, source: m.source, note: m.note, trig: m.trigger }));
    const mouth = window.__mouth;
    const talking = mouth.filter((x) => x.speaking);
    const quiet = mouth.filter((x) => !x.speaking).slice(-20);
    const tops = {};
    for (const x of talking) if (x.vis > 0.25) tops[x.top] = (tops[x.top] || 0) + 1;
    return {
      msgs,
      mouth: {
        samples: mouth.length, talking: talking.length,
        maxJaw: Math.max(...talking.map((x) => x.jaw)), maxVis: Math.max(...talking.map((x) => x.vis)),
        movingShare: talking.filter((x) => x.jaw > 0.08 || x.vis > 0.15).length / Math.max(1, talking.length),
        quietMaxJaw: Math.max(...quiet.map((x) => x.jaw)),
        tops,
      },
      moment: window.__cbx.status ? window.__cbx.status : null,
    };
  });
  const actions = res.msgs.filter((m) => m.kind === 'action');
  log('actions in chat:', JSON.stringify(actions.map((a) => [a.text, a.trig && a.trig.speaker, a.trig && a.trig.played, a.note])));
  log('bear messages:', JSON.stringify(res.msgs.filter((m) => m.kind === 'bear' && m.final).map((m) => [m.text, m.source])));
  log('user notes:', JSON.stringify(res.msgs.filter((m) => m.kind === 'user').map((m) => [m.text, m.note || ''])));
  log('mouth:', JSON.stringify(res.mouth));
  await page.screenshot({ path: path.join(OUT, `${phone ? 'phone' : 'desktop'}-02-demo-chat-joke.jpg`), type: 'jpeg', quality: 70 });

  // Hang up, then typed chat with no call live.
  await page.evaluate(() => window.__cbApp.hangUp());
  await sleep(1500);
  await say('show me your house');
  await sleep(2000);
  const after = await page.evaluate(() => window.__cbApp.store.get().messages.filter((m) => m.kind === 'action').map((m) => m.text));
  log('actions after the call (typed, no call):', JSON.stringify(after));
  await page.screenshot({ path: path.join(OUT, `${phone ? 'phone' : 'desktop'}-03-chat-no-call.jpg`), type: 'jpeg', quality: 70 });
  log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
