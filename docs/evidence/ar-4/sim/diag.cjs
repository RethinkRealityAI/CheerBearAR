// ar-4: the ?diag overlay in AR (tracking, fps, dpr, camera, stalls, draw calls / programs, the AR state line and
// the last breadcrumbs).  usage: node diag.cjs <floor.y4m>   (BASE=http://localhost:5211, OUT=dir for shots)
const { launch, shot, sleep, waitFor, BASE } = require('./lib.cjs');
const T = 300000;
const click = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
(async () => {
  const { browser, page } = await launch({ phone: true, video: process.argv[2] });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop&diag`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(3000);
  await click(page, '.cbx-switch [data-mode=ar]');
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().stages.ar.houseSet.open > 0.9, null, T);
  await click(page, '.cbx-slot-left [data-cmd=move]');
  await sleep(2500);
  await shot(page, 'diag-overlay');
  console.log(await page.evaluate(() => document.querySelector('pre[aria-hidden]')?.textContent));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
