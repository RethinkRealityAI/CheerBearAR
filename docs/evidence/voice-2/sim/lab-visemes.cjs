// Feeds the demo voice's text-driven mouth shapes (src/voice/textVisemes.ts) to the lip sync lab's close-up bear
// (/lab/lipsync), holds each sampled frame until the bear's smoothing settles, and screenshots the face, so the
// text visemes can be compared with the lab's per-viseme reference. Writes a contact sheet.
//   BASE=http://localhost:5192 node lab-visemes.cjs
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5192';
const OUT = process.env.SHOTS || path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/lab/lipsync`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lab && window.__lab.bear(), null, { timeout: 300000, polling: 500 });
  await sleep(1500);
  await page.evaluate(() => window.__lab.camera('face'));
  const frames = await page.evaluate(async () => {
    const m = await import('/src/voice/textVisemes.ts');
    const text = 'Hi friend! Bob, look at my rainbow. Shh, see you soon!';
    const tl = m.buildVisemeTimeline(text, { rate: 1 });
    window.__tl = tl;
    window.__m = m;
    // one moment per sound: the middle of a few telling segments
    const pick = [];
    const want = ['aa', 'I', 'E', 'PP', 'O', 'U', 'FF', 'CH', 'SS', 'RR', 'nn', 'DD'];
    for (const v of want) {
      const s = tl.segs.find((x) => x.v === v);
      if (s) pick.push({ v, t: (s.t0 + s.t1) / 2 });
    }
    return pick;
  });
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const shots = [];
  const bear = () => page.evaluate(() => window.__lab.bear());
  void bear;
  for (const f of [{ v: 'rest', t: -1 }, ...frames]) {
    const info = await page.evaluate((t) => {
      const fr = t < 0 ? null : window.__m.sampleTimeline(window.__tl, t);
      window.__lab.bear().setVisemes(fr);
      return fr;
    }, f.t);
    await sleep(700);
    const file = path.join(OUT, `lab-${String(shots.length).padStart(2, '0')}-${f.v}.png`);
    const cw = Math.min(box.width, 420);
    await page.screenshot({ path: file, clip: { x: box.x + box.width / 2 - cw / 2, y: box.y + box.height * 0.18, width: cw, height: Math.min(box.height * 0.6, 420) } });
    shots.push({ file, v: f.v, weights: info && info.weights });
    console.log(f.v, info ? JSON.stringify(Object.fromEntries(Object.entries(info.weights).map(([k, x]) => [k, Math.round(x * 100) / 100]))) : 'null');
  }
  require('fs').writeFileSync(path.join(OUT, 'lab-shots.json'), JSON.stringify(shots));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
