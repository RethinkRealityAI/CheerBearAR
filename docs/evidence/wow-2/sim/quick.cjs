// quick look: start the showcase, throw a few hearts with real flick gestures, screenshot
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('../../xr-core/sim/lib.cjs');
(async () => {
  const { browser, page, logs } = await launch({ phone: true });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 240000);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  await sleep(2500);
  console.log('progs', JSON.stringify(await page.evaluate(() => window.__cb.debug().showcasePrograms)));
  const flick = async (dx, len, ms) => {
    const x = 195, y = 640;
    await page.mouse.move(x, y); await page.mouse.down();
    const n = 5;
    for (let i = 1; i <= n; i++) { await page.mouse.move(x + dx * i / n, y - len * i / n); await sleep(ms / n); }
    await page.mouse.up();
  };
  for (let i = 0; i < 4; i++) {
    await flick((i - 1.5) * 20, 160 + i * 30, 60);
    await sleep(250);
    await shot(page, `quick-${i}`);
  }
  await sleep(1500);
  await shot(page, 'quick-after');
  console.log(JSON.stringify(await page.evaluate(() => { const t = window.__cb.internals().showcase.toss; return { thrown: t.thrown, caught: t.caught, combo: t.combo, live: window.__cb.internals().stages.showcase.play.liveCount, progs: window.__cb.debug().showcasePrograms }; })));
  console.log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
