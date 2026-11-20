// Close-up of Cheer Bear's mouth while the demo voice speaks (no call: typed chat answer). Captures the viewport when
// the jaw is wide open, when the lips are closed for a P/B/M, and at rest. Same fake speechSynthesis as demo.cjs.
//   BASE=http://localhost:5192 node mouth.cjs
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5192';
const OUT = process.env.SHOTS || path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE = `
  class U { constructor(t) { this.text = t; } }
  const synth = { speaking: false, cur: null, getVoices() { return [{ name: 'Samantha', lang: 'en-US', localService: true }]; },
    speak(u) { if (!u.text.trim()) return; this.cur = u; this.speaking = true; const w = [...u.text.matchAll(/[A-Za-z']+/g)]; let i = 0;
      setTimeout(() => { u.onstart && u.onstart({}); const n = () => { if (this.cur !== u) return; if (i < w.length) { u.onboundary({ name: 'word', charIndex: w[i].index }); i++; setTimeout(n, 260); } else { this.speaking = false; u.onend && u.onend({}); } }; n(); }, 40); },
    cancel() { this.cur = null; this.speaking = false; }, resume() {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
`;
(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript({ content: FAKE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?test&desktop`, { waitUntil: 'load' });
  for (let i = 0; i < 150; i += 1) {
    const st = await page.evaluate(() => ({ ok: !!(window.__cbx && window.__cbx.started && window.__cbApp), can: !!document.querySelector('.cbx-start:not([disabled])') }));
    if (st.ok) break;
    if (st.can) await page.click('.cbx-start').catch(() => undefined);
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.__cbApp.closeOverlay(); window.__cbApp.closeSheet(); });
  await sleep(1500);
  await page.evaluate(() => {
    const meshes = [];
    window.__cbx.internals.bear.object.traverse((o) => { if (o.morphTargetDictionary) meshes.push(o); });
    window.__read = () => {
      let jaw = 0; const vis = {};
      for (const m of meshes) for (const [n, i] of Object.entries(m.morphTargetDictionary)) {
        if (n === 'jawOpen') jaw = Math.max(jaw, m.morphTargetInfluences[i]);
        if (n.startsWith('viseme_')) vis[n] = Math.max(vis[n] || 0, m.morphTargetInfluences[i]);
      }
      return { jaw, vis };
    };
  });
  await page.screenshot({ path: path.join(OUT, 'mouth-0-rest.jpg'), type: 'jpeg', quality: 75 });
  await page.evaluate(() => window.__cbApp.voice.sendText('Wow! Bob, papa and mama are happy, ha ha ha!'));
  let gotOpen = false; let gotClosed = false;
  for (let i = 0; i < 400 && !(gotOpen && gotClosed); i += 1) {
    const r = await page.evaluate(() => window.__read());
    if (!gotOpen && r.jaw > 0.42) { await page.screenshot({ path: path.join(OUT, 'mouth-1-open-aa.jpg'), type: 'jpeg', quality: 75 }); gotOpen = true; console.log('open', JSON.stringify(r)); }
    else if (!gotClosed && (r.vis.viseme_PP || 0) > 0.55) { await page.screenshot({ path: path.join(OUT, 'mouth-2-closed-PP.jpg'), type: 'jpeg', quality: 75 }); gotClosed = true; console.log('closed', JSON.stringify(r)); }
    await sleep(15);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
