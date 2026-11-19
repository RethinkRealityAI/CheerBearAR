// Selfie at other sizes / settings: intro (or its reduced-motion still), live, review, reveal end.
//   node variants.cjs face.y4m se          375x667 phone
//   node variants.cjs face.y4m desktop     1280x800 (?desktop)
//   node variants.cjs face.y4m reduced     390x844 with prefers-reduced-motion
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');

const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === text && x.offsetParent);
  if (!b) throw new Error('no button ' + text);
  b.click();
}, text);
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);

(async () => {
  const video = process.argv[2];
  const kind = process.argv[3] || 'se';
  const size = kind === 'se' ? { w: 375, h: 667, phone: true } : kind === 'desktop' ? { w: 1280, h: 800, phone: false } : { w: 390, h: 844, phone: true };
  const { browser, page, logs } = await launch({ phone: size.phone, video, w: size.w, h: size.h });
  if (kind === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('face')?.constructor?.name === 'FaceMode', null, T);
  await click(page, '.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  log('intro on screen:', JSON.stringify(await page.evaluate(() => {
    const s = document.querySelector('.cbc-still');
    const m = window.__cb.internals().modes.get('face');
    return { state: m.state, still: !!s && s.complete && s.naturalWidth > 0, clip: m.introQuad.visible };
  })));
  await sleep(kind === 'reduced' ? 100 : 1800);
  await shot(page, `v-${kind}-01-intro`);
  const t0 = Date.now();
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 30000);
  log('intro ended by itself after', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.__cb.internals().modes.get('face').diag)));
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(2500);
  await shot(page, `v-${kind}-02-live`);
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await sleep(300);
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(900);
  await shot(page, `v-${kind}-03-review`);
  // where are the review's buttons vs. the reserved bottom-right corner?
  const overlap = await page.evaluate(() => {
    const box = document.querySelector('.cbx').getBoundingClientRect();
    const res = parseFloat(getComputedStyle(document.querySelector('.cbx')).getPropertyValue('--cbx-reserved')) || 88;
    const corner = { left: box.right - res, top: box.bottom - res };
    return [...document.querySelectorAll('.cbc-review button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.right > corner.left && r.bottom > corner.top;
    }).map((b) => b.textContent.trim());
  });
  log('review buttons inside the talk-button corner:', overlap.length ? overlap.join(', ') : 'none');
  await clickText(page, 'Watch photo animation');
  await waitFor(page, () => window.__cb.internals().modes.get('face').reveal.diag.ended, null, 120000);
  await sleep(500);
  await shot(page, `v-${kind}-04-reveal-end`);
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
