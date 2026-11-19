const path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 300000;
(async () => {
  const { browser, page, logs } = await launch({ phone: true, video: path.join(__dirname, 'floor.y4m') });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(3000);
  const progs = () => page.evaluate(() => window.__cb.internals().engine.xr.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.length + '|' + p.cacheKey.slice(0, 60)));
  let base = await progs();
  console.log('placing', base.length);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await sleep(4000);
  const diff = async (label) => { const now = await progs(); const add = now.filter((x) => !base.includes(x)); console.log(label, now.length, add.length ? '\n   + ' + add.join('\n   + ') : ''); base = now; };
  await diff('placed');
  await page.evaluate(() => window.__cb.internals().modes.get('ar').enterHouse());
  await waitFor(page, () => window.__cb.debug().ar.inside, null, T);
  await sleep(5000);
  await diff('inside');
  await page.evaluate(() => window.__cb.internals().modes.get('ar').leaveHouse());
  await sleep(4000);
  for (const a of ['House', 'Sparkle', 'Running', 'Sleep', 'WakeUp', 'Dance', 'Wave', 'Magic', 'Cold', 'Party', 'Rainbow']) {
    await waitFor(page, () => !window.__cb.debug().moment.ar, null, T);
    await page.evaluate((a) => window.__cb.trigger(a), a);
    await sleep(2500);
    await waitFor(page, () => !window.__cb.debug().moment.ar, null, T);
    await diff(a);
  }
  console.log(JSON.stringify(await page.evaluate(() => window.__cb.debug().engine.engine)));
  console.log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
