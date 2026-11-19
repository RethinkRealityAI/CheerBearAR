// Layout check at other sizes: Selfie (3D look, Classic clip) and 3D Photo (selfie guide, placed with Move + Flip),
// one run per size. `reduced` runs with prefers-reduced-motion.
//   node docs/evidence/capture-2/sim/variants.cjs <face.webm> <floor.webm> <se|desktop|reduced>
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');

const T = 300000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SIZES = {
  se: { phone: true, w: 375, h: 667 },
  desktop: { phone: false, w: 1440, h: 900 },
  reduced: { phone: true, w: 390, h: 844, reduced: true },
};
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);
const st = (page, m) => page.evaluate((m) => window.__cb.internals().modes.get(m).state, m);

/** Rects of the controls that must not overlap: shutter, Move/Flip, picker, hint. */
const layout = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => ({ sel, label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 18), r: r(e) }));
  const all = [...vis('.cbx-shutter'), ...vis('.cbx-slot-left button'), ...vis('.cbx-slot-centre .cbx-pill'), ...vis('.cbc-seg'), ...vis('.ml-hint.on'), ...vis('.cbc-thumb'), ...vis('.cbx-above .cbx-pill')];
  const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const overlaps = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (hit(all[i].r, all[j].r)) overlaps.push(`${all[i].label} x ${all[j].label}`);
  return { vw: innerWidth, vh: innerHeight, controls: all.map((c) => `${c.label}@${c.r.join(',')}`), overlaps };
});

let PAGE = null, TAG = '';
(async () => {
  const [face, floor, which = 'se'] = process.argv.slice(2);
  const size = SIZES[which];
  const tag = `v-${which}`;
  const { browser, page, logs } = await launch({ ...size, cams: { user: face, environment: floor } });
  PAGE = page; TAG = tag;
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await shot(page, `${tag}-00-splash`);
  await page.click('.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('photo')?.constructor?.name === 'PhotoMode', null, T);
  await sleep(1000);

  // Selfie, 3D look
  await page.click('.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(3000);
  await shot(page, `${tag}-01-selfie-3d`);
  log('selfie 3d', JSON.stringify(await layout(page)));
  // Classic: the clip with the shutter
  await page.click('.cbc-seg [data-id="classic"]');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'clip', null, 20000);
  await sleep(2000);
  await shot(page, `${tag}-02-classic-clip`);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(700);
  await shot(page, `${tag}-03-review`);
  await page.evaluate(() => [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === 'Retake' && x.offsetParent).click());
  await page.click('.cbc-seg [data-id="3d"]');

  // 3D Photo
  await page.click('.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').faceFound, null, 120000);
  await sleep(1500);
  await shot(page, `${tag}-04-photo-guide`);
  log('photo guide', JSON.stringify(await layout(page)));
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').diag.selfies === 1, null, 60000);
  await page.click('text=Meet Cheer Bear');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placing', null, T);
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T).catch(async (e) => {
    await shot(page, `${tag}-05-NOT-SETTLED`);
    log('not settled', JSON.stringify(await page.evaluate(() => { const d = window.__cb.debug(); return { settled: d.settled, mode: d.mode, engine: d.engine, hint: document.querySelector('.ml-hint')?.textContent }; })));
    throw e;
  });
  await sleep(1500);
  await page.click('.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2000);
  await shot(page, `${tag}-05-photo-placed`);
  log('photo placed', await st(page, 'photo'), JSON.stringify(await layout(page)));
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(700);
  await shot(page, `${tag}-06-photo-review`);
  await page.evaluate(() => [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === 'Retake' && x.offsetParent).click());
  await page.click('.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  if (PAGE) {
    await shot(PAGE, `${TAG}-ERR`).catch(() => {});
    console.error('state', JSON.stringify(await PAGE.evaluate(() => {
      const d = window.__cb.debug();
      return { mode: d.mode, entered: d.entered, settled: d.settled, engine: d.engine, hint: document.querySelector('.ml-hint')?.textContent, sheet: document.querySelector('[role=dialog]')?.textContent?.slice(0, 200) };
    }).catch((x) => String(x))));
  }
  process.exit(1);
});
