// iris sequence + rapid switching (last tap wins) + keyboard activation
const path = require('path');
const lib = require('./mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT; const tag = process.env.TAG || '390x844';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const { browser, page, logs } = await launch({ phone: true, video: process.env.VIDEO });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice=fast`, { waitUntil: 'load' });
  await lib.start(page);
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.__cbApp.closeSheet(); });
  await sleep(800);
  // iris sequence: 3D -> AR (tap via a real pointer at the tab's centre)
  const box = await (await page.$('.cbx-switch [data-mode=ar]')).boundingBox();
  const t0 = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(OUT, `${tag}-30-iris-${i}.jpg`), type: 'jpeg', quality: 70 });
    log('iris shot', i, Date.now() - t0, 'ms', await page.evaluate(() => [document.querySelector('.cbx-cover').className, document.querySelector('.cbx-switch').className]));
  }
  await waitFor(page, () => window.__cbx.mode === 'ar' && !document.querySelector('.cbx-switch.busy'), null, 120000);
  await sleep(1500);
  // rapid: Selfie, then (while busy) Photo, then 3D -> last tap (3D) should win
  const t1 = Date.now();
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=face]').click());
  await sleep(60);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=photo]').click());
  await sleep(60);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=showcase]').click());
  await page.screenshot({ path: path.join(OUT, `${tag}-31-rapid-queued.jpg`), type: 'jpeg', quality: 70 });
  log('queued', await page.evaluate(() => [...document.querySelectorAll('.cbx-switch .queued')].map((b) => b.dataset.mode)));
  await waitFor(page, () => window.__cbx.mode === 'showcase' && !document.querySelector('.cbx-switch.busy') && !document.querySelector('.cbx-cover.on'), null, 180000);
  log('rapid done in', Date.now() - t1, 'ms; mode', await page.evaluate(() => window.__cbx.mode));
  await sleep(1200);
  // back and forth quickly x3
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
    await sleep(150);
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=showcase]').click());
    await waitFor(page, () => window.__cbx.mode === 'showcase' && !document.querySelector('.cbx-switch.busy') && !document.querySelector('.cbx-cover.on'), null, 180000);
  }
  log('back-and-forth ok; mode', await page.evaluate(() => window.__cbx.mode));
  // keyboard: focus selected tab, ArrowRight to AR, Enter
  await page.evaluate(() => document.querySelector('.cbx-switch [aria-selected=true]').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitFor(page, () => window.__cbx.mode === 'ar' && !document.querySelector('.cbx-switch.busy'), null, 120000);
  log('keyboard Enter -> mode', await page.evaluate(() => [window.__cbx.mode, document.activeElement?.dataset?.mode]));
  await sleep(800);
  await page.locator('.cbx-top').screenshot({ path: path.join(OUT, `${tag}-32-kb-ar.jpg`), type: 'jpeg', quality: 85 });
  await shot2();
  async function shot2() { await page.screenshot({ path: path.join(OUT, `${tag}-33-ar-after-kb.jpg`), type: 'jpeg', quality: 70 }); }
  log(tag, 'errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
