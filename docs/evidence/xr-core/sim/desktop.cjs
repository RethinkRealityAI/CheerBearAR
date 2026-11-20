// Desktop (and phone sheets): splash, showcase, AR on a computer -> QR sheet + `unavailable`, menu, licences, how.
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 240000;
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);

(async () => {
  const phone = process.argv[2] === 'phone';
  const tag = phone ? 'phone' : 'desktop';
  const { browser, page, logs } = await launch({ phone });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  if (!phone) {
    await sleep(800);
    await shot(page, `${tag}-01-splash-loading`);
  }
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await sleep(1500);
  if (!phone) await shot(page, `${tag}-02-splash-ready`);
  await click(page, '.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, T);
  await sleep(4000);
  if (!phone) {
    await shot(page, `${tag}-04-showcase`);
    // walk with the arrow keys
    await page.keyboard.down('ArrowLeft');
    await sleep(2500);
    await page.keyboard.up('ArrowLeft');
    await sleep(1500);
    await shot(page, `${tag}-05-walked-keys`);
    await page.evaluate(() => window.__cb.trigger('Rainbow'));
    await sleep(4500);
    await shot(page, `${tag}-06-rainbow`);
    await waitFor(page, () => !window.__cb.debug().moment.showcase, null, T);
    await page.evaluate(() => window.__cb.trigger('House'));
    await sleep(6000);
    await shot(page, `${tag}-07-house`);
  }
  // AR on a computer (no ?desktop): QR sheet, `unavailable`
  if (!phone) {
    await click(page, '.cbx-switch [data-mode=ar]');
    await sleep(1200);
    await shot(page, `${tag}-08-ar-open-on-phone`);
    await click(page, '.cbx-sheet .btn');
    await sleep(500);
  }
  await click(page, '.cbx-top .cbx-ib');
  await sleep(700);
  await shot(page, `${tag}-09-menu`);
  await click(page, '.cbx-sheet [data-a=lic]');
  await sleep(700);
  await shot(page, `${tag}-10-licences`);
  await click(page, '.cbx-sheet .btn');
  await sleep(400);
  await click(page, '.cbx-top .cbx-ib');
  await sleep(400);
  await click(page, '.cbx-sheet [data-a=how]');
  await sleep(700);
  await shot(page, `${tag}-11-how`);
  await click(page, '.cbx-sheet .btn');
  // speech bubble + reserved corner
  await page.evaluate(() => { window.__cb.exp.setSpeechText('Hi friend! Want to see my house? Say house!'); });
  await sleep(800);
  await shot(page, `${tag}-12-speech`);
  const events = await page.evaluate(() => window.__cb.events.filter((e) => e.event === 'unavailable'));
  console.log('unavailable events', JSON.stringify(events));
  console.log('mode', await page.evaluate(() => window.__cb.mode));
  const errs = errorsOf(logs);
  console.log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
