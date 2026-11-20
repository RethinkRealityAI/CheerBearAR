// polish-4: a look round the full app (route /, with the talk button and the app sheet) for unfinished edges:
// Heart Hoops with the app's bottom-right talk button (rack, coach), Heart Run, the Games tab, Selfie (3D bear and
// Classic), 3D Photo's front camera. Logs control rectangles and any overlaps between bottom controls.
//   BASE=http://localhost:5213 OUT=<dir> node tour.cjs <face.webm> [W H]
const { launch, shot, sleep, waitFor, errorsOf } = require('../../capture-2/sim/lib.cjs');
const { start } = require('../../ui-2/sim/mylib.cjs');
const BASE = process.env.BASE || 'http://localhost:5213';
const nums = process.argv.slice(3).filter((a) => /^\d+$/.test(a)).map(Number);
const W = nums[0] || 390, H = nums[1] || 844, P = `tour${W}`;
const log = (...a) => console.log(P, ...a);
const rects = (page, sels) => page.evaluate((sels) => {
  const out = {};
  for (const s of sels) {
    const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent || getComputedStyle(x).position === 'fixed');
    if (!e) continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.height) out[s] = [r.left, r.top, r.right, r.bottom].map(Math.round);
  }
  const keys = Object.keys(out), hits = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = out[keys[i]], b = out[keys[j]];
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) hits.push(`${keys[i]} x ${keys[j]}`);
  }
  return { out, hits };
}, sels);
const BOTTOM = ['.cbp-rack', '.cbp-coach-pill', '.cbx-slot-left > *', '.cbx-slot-centre > *', '.cb-talk, .cb-orb, [class*="talk-orb"], [class*="TalkOrb"]', '.cbx-above > *', '.cbx-hint, .ml-hint.on'];

(async () => {
  const cam = process.argv[2];
  const { browser, page, logs } = await launch({ phone: true, w: W, h: H, cams: { user: cam, environment: cam } });
  await page.goto(`${BASE}/?desktop&test`, { waitUntil: 'load' });
  await start(page);
  await sleep(2500);
  await page.evaluate(() => window.__cbApp.closeOverlay?.());
  await sleep(600);
  await shot(page, `${P}-01-3d`);
  // Heart Hoops in the full app
  await page.evaluate(() => window.__cbx.startPlay('heart-hoops'));
  await waitFor(page, () => window.__cbx.debug().play.state === 'playing', null, 120000);
  await waitFor(page, () => !!document.querySelector('.cbp-coach.on'), null, 30000);
  await sleep(900);
  log('hoops', JSON.stringify(await rects(page, BOTTOM)));
  await shot(page, `${P}-02-hoops`);
  await page.evaluate(() => window.__cbx.stopPlay());
  await sleep(500);
  await page.evaluate(() => window.__cbx.startPlay('heart-run'));
  await waitFor(page, () => window.__cbx.debug().play.state === 'playing', null, 120000);
  await waitFor(page, () => !!document.querySelector('.cbp-nudge-pill.on'), null, 30000).catch(() => log('no nudge'));
  await sleep(500);
  log('run', JSON.stringify(await rects(page, [...BOTTOM, '.cbp-nudge-pill', '.cbx-stick'])));
  await shot(page, `${P}-03-run-nudge`);
  await page.evaluate(() => window.__cbx.stopPlay());
  await sleep(500);
  await page.evaluate(() => window.__cbApp.openSheet('games'));
  await sleep(1500);
  await shot(page, `${P}-04-games-tab`);
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(800);
  // Selfie
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=face]').click());
  await waitFor(page, () => { const d = window.__cbx.debug(); return d.mode === 'face' && d.entered; }, null, 120000);
  await sleep(4000);
  log('selfie', JSON.stringify(await rects(page, [...BOTTOM, '.cbc-seg'])));
  await shot(page, `${P}-05-selfie-3d`);
  await page.evaluate(() => document.querySelector('.cbc-seg [data-id=classic]').click());
  await sleep(2500);
  await shot(page, `${P}-06-selfie-classic-clip`);
  await waitFor(page, () => { const c = document.querySelector('.cbc-count'); return c && !c.hidden && c.dataset.phase === '2'; }, null, 60000);
  await shot(page, `${P}-07-selfie-classic-2`);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(800);
  await shot(page, `${P}-08-selfie-review`);
  await page.evaluate(() => [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === 'Retake')?.click());
  await sleep(800);
  // 3D Photo (front camera first)
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=photo]').click());
  await waitFor(page, () => { const d = window.__cbx.debug(); return d.mode === 'photo' && d.entered; }, null, 120000);
  await sleep(4000);
  log('photo', JSON.stringify(await rects(page, [...BOTTOM, '.cbc-seg'])));
  await shot(page, `${P}-09-photo-front`);
  log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
