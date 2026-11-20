// chrome-5: the app route in AR with the fake floor camera: place her (test-only settle), then the bottom row
// (Move bottom left, joystick centre, Actions + Games over the talk mic), program counts, reduced motion optional.
//   BASE=… OUT=… VIDEO=floor.y4m [W=390 H=844] [RM=1] node ar.cjs
const path = require('path');
const lib = require('../../ui-2/sim/mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT;
const W = +process.env.W || 390, H = +process.env.H || 844;
const tag = (process.env.TAG ? process.env.TAG + '-' : '') + `${W}x${H}`;
const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 70, timeout: 120000 });
(async () => {
  const { browser, page, logs } = await launch({ phone: true, w: W, h: H, video: process.env.VIDEO });
  if (process.env.RM) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice`, { waitUntil: 'load' });
  await lib.start(page);
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.__cbApp.closeOverlay?.(); window.__cbApp.closeSheet(); });
  const p3d = await page.evaluate(() => window.__cbx.debug().showcasePrograms);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
  await waitFor(page, () => window.__cbx.debug().tracking === 'NORMAL', null, T);
  await sleep(3000);
  await page.evaluate(() => { window.__cbx.internals.engine.wh.settled = () => true; }); // test only
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(1500);
  await shot(page, 'ar-01-placing');
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cbx.debug().ar.placed, null, T);
  await sleep(5000);
  await page.evaluate(() => window.__cbApp.store.set({ voiceBubble: null }));
  await sleep(600);
  await shot(page, 'ar-02-placed');
  const boxes = await page.evaluate(() => {
    const out = [];
    for (const s of ['.cbx-stick', '.cbx-slot-left .cbx-tool', '.cbx-dock .cbx-tool', '.cb-orb', '.cbx-act1']) document.querySelectorAll(s).forEach((n) => { const r = n.getBoundingClientRect(); if (r.width && getComputedStyle(n).visibility !== 'hidden') out.push([s, (n.getAttribute('aria-label') || '').slice(0, 14), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]); });
    const ov = [];
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) { const a = out[i], b = out[j]; if (a[2] < b[4] && b[2] < a[4] && a[3] < b[5] && b[3] < a[5]) ov.push(a[1] + ' x ' + b[1]); }
    return { out, ov };
  });
  log('bottom row', JSON.stringify(boxes.out), 'overlaps', boxes.ov.length ? boxes.ov.join('; ') : 'none');
  const pAr = await page.evaluate(() => window.__cbx.debug().enginePrograms);
  // dock -> sheet
  await page.evaluate(() => document.querySelector('.cbx-dock .is-games').click());
  await sleep(1200);
  log('sheet after Games', await page.evaluate(() => { const s = window.__cbApp.store.get(); return s.sheetOpen + ' ' + s.tab; }));
  await shot(page, 'ar-03-games-sheet');
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(800);
  // a call: the pair steps aside for the hang-up button
  await page.evaluate(() => { const c = window.__cbApp; c.requestCall(); if (c.store.get().micAsk) c.confirmMic(); });
  await waitFor(page, () => window.__cbApp.store.get().call === 'in-call', null, 30000).catch(() => log('no in-call'));
  await sleep(2000);
  await shot(page, 'ar-04-in-call');
  log('dock visibility in call', await page.evaluate(() => getComputedStyle(document.querySelector('.cbx-dock')).visibility));
  await page.evaluate(() => window.__cbApp.hangUp());
  await sleep(1500);
  const pAr2 = await page.evaluate(() => window.__cbx.debug().enginePrograms);
  log('programs: 3D', p3d, 'AR', pAr, '->', pAr2);
  const errs = errorsOf(logs);
  log(tag, 'errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
