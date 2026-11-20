// chrome-5 tour of the real app (route /): splash, main 3D (bottom row), sheet tabs, settings, menu, then AR / Selfie /
// Photo chrome with the fake floor camera.
//   BASE=http://localhost:5221 OUT=dir W=390 H=844 PHONE=1 VIDEO=floor.y4m MODES=1 TAG=after node tour.cjs
const path = require('path');
const lib = require('../../ui-2/sim/mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT;
const W = +process.env.W || 390, H = +process.env.H || 844;
const phone = process.env.PHONE !== '0';
const tag = (process.env.TAG ? process.env.TAG + '-' : '') + `${W}x${H}`;
const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name, opt = {}) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 70, timeout: 120000, ...opt });
const closeDialogs = (page) => page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const c = window.__cbApp; if (c && c.store.get().overlay) c.closeOverlay?.(); });

(async () => {
  const { browser, page, logs } = await launch({ phone, w: W, h: H, video: process.env.VIDEO });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice${process.env.Q || ''}`, { waitUntil: 'load' });
  await sleep(500);
  await shot(page, '00-splash-early');
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 300000);
  await sleep(1500);
  await shot(page, '01-splash');
  await lib.start(page);
  await sleep(3500);
  await shot(page, '02-welcome');
  await closeDialogs(page);
  await page.evaluate(() => window.__cbApp.closeSheet?.());
  await sleep(1500);
  await shot(page, '03-main');
  // overlap check of the bottom row
  const boxes = await page.evaluate(() => {
    const sel = ['.cbx-stick', '.cbx-shutter', '.cb-orb', '.cb-more', '.cb-hangup', '.cbx-bottom [data-cmd]', '.cbx-bottom .cbx-tool', '.cbx-bottom .cbx-pill', '.cbx-top', '.cbx-switch', '.cbx-menu', '.cb-chip', '.cb-vbubble'];
    const out = [];
    for (const s of sel) document.querySelectorAll(s).forEach((n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); if (r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05) out.push({ s, t: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 24), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }); });
    return out;
  });
  log('boxes', JSON.stringify(boxes));
  // the bottom-right pair opens the sheet on its tab (falls back to the old route if the dock is missing)
  const viaDock = await page.evaluate(() => { const b = document.querySelector('.cbx-dock .is-actions'); if (b && !b.closest('[hidden]')) { b.click(); return true; } window.__cbApp.openSheet('actions'); return false; });
  log('actions via dock', viaDock, await page.evaluate(() => window.__cbApp.store.get().tab));
  await sleep(1200);
  await shot(page, '04-sheet-actions');
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(600);
  await page.evaluate(() => { const b = document.querySelector('.cbx-dock .is-games'); if (b && !b.closest('[hidden]')) b.click(); else window.__cbApp.openSheet('games'); });
  await sleep(1200);
  await shot(page, '05-sheet-games');
  for (const t of ['talk', 'settings']) {
    await page.evaluate((t) => window.__cbApp.setTab(t), t);
    await sleep(900);
    await shot(page, `05-sheet-${t}`);
  }
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(900);
  await page.evaluate(() => document.querySelector('.cbx-top button[aria-label=Menu]')?.click());
  await sleep(900);
  await shot(page, '06-menu');
  await page.evaluate(() => document.querySelectorAll('.cbx-sheet-wrap').forEach((w) => w.querySelector('.row .btn:last-child, .btn')?.click()));
  await sleep(700);
  if (process.env.IRIS) {
    // test-only: slow the iris and the hop so mid-cover frames can be captured (screenshots take ~0.3 s here)
    await page.addStyleTag({ content: '.cbx-cover.on .cbx-cover-disc{transition-duration:1.2s!important}.cbx-cover.on .cbx-cover-in{transition-delay:0s!important}' });
  }
  if (process.env.MODES) {
    for (const m of ['ar', 'face', 'photo', 'showcase']) {
      await page.evaluate((m) => document.querySelector(`.cbx-switch [data-mode=${m}]`).click(), m);
      await sleep(process.env.IRIS ? 150 : 350);
      await shot(page, `07-switching-${m}`);
      if (process.env.IRIS) { await sleep(450); await shot(page, `07b-switching-${m}`); }
      await waitFor(page, (m) => window.__cbx.mode === m && !document.querySelector('.cbx-switch.busy'), m, T).catch(() => log('stuck', m));
      await sleep(2500);
      await closeDialogs(page);
      await shot(page, `08-mode-${m}`);
    }
  }
  const errs = errorsOf(logs);
  log(tag, 'errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
