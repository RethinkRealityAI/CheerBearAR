// wow-2 desktop check (1440x900, no touch): the Space-key hint, Space throws hearts, a mouse flick throws too.
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
(async () => {
  const { browser, page, logs } = await launch({ phone: false, w: 1440, h: 900 });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 240000);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  await waitFor(page, () => /throw/i.test(document.querySelector('.ml-hint, .cbx-hint')?.textContent || ''), null, 90000).catch(() => null);
  console.log('desktop hint:', await page.evaluate(() => document.querySelector('.ml-hint, .cbx-hint')?.textContent));
  await shot(page, 'desk-01-hint');
  await waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await sleep(1500); }
  await shot(page, 'desk-02-space-throws');
  const t = await page.evaluate(() => { const x = window.__cb.internals().showcase.toss; return { thrown: x.thrown, caught: x.caught, combo: x.combo, progs: window.__cb.debug().showcasePrograms }; });
  console.log('desktop after 4 x Space', JSON.stringify(t));
  console.log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
