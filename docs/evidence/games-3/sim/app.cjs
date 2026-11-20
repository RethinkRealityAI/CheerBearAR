// games-3, the full app (route /, 390x844 by default): the sheet's Games tab with the Play cards, a tap on Heart Run
// (the sheet closes, the round starts), the sheet opening mid-round (the round waits) and closing (3-2-1, carries on),
// Selfie -> Heart Hoops card (switches to 3D first).
//   BASE=http://localhost:5202 OUT=<dir> [W= H=] [FACE=<face.y4m>] node app.cjs
const { launch, shot, sleep, errorsOf, BASE } = require('./lib.cjs');
const { waitFor, start } = require('../../ui-2/sim/mylib.cjs');
const W = +(process.env.W || 390), H = +(process.env.H || 844), P = `app${W}`;
(async () => {
  const { browser, page, logs } = await launch({ phone: W < 900, w: W, h: H, video: process.env.FACE });
  const log = (...a) => console.log(P, ...a);
  await page.goto(`${BASE}/?desktop&test`, { waitUntil: 'load' });
  await start(page);
  await sleep(2500);
  // close the welcome dialog if it is up
  await page.evaluate(() => window.__cbApp.closeOverlay());
  await sleep(500);
  await page.evaluate(() => window.__cbApp.openSheet('games'));
  await sleep(1500);
  await shot(page, `${P}-01-games-tab`);
  await page.evaluate(() => document.querySelector('.cb-play-card.is-heart-run').click());
  await waitFor(page, () => window.__cbx.debug().play.state === 'countdown', null, 60000);
  log('card -> sheetOpen', await page.evaluate(() => window.__cbApp.store.get().sheetOpen), JSON.stringify(await page.evaluate(() => window.__cbx.debug().play)));
  await waitFor(page, () => window.__cbx.debug().play.state === 'playing', null, 60000);
  await sleep(2500);
  await shot(page, `${P}-02-run-playing`);
  // a toast under the top bar at the same time: the scoreboard and the hint slide below it
  await page.evaluate(() => window.__cbApp.showToast('info', 'Connected! Say hi to Cheer Bear.', 6000));
  await page.evaluate(() => window.__cbx.internals.play.game.host.hint('A star! Grab it!'));
  await sleep(900);
  await shot(page, `${P}-03-run-toast-hint`);
  await page.evaluate(() => window.__cbApp.openSheet('talk'));
  await sleep(1200);
  log('sheet open ->', JSON.stringify(await page.evaluate(() => window.__cbx.debug().play)));
  await shot(page, `${P}-04-run-sheet-paused`);
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(700);
  log('sheet closed ->', JSON.stringify(await page.evaluate(() => window.__cbx.debug().play)));
  await shot(page, `${P}-05-run-resume`);
  await page.evaluate(() => window.__cbx.stopPlay());
  await sleep(500);
  if (process.env.FACE) {
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=face]').click());
    await waitFor(page, () => window.__cbx.mode === 'face' && window.__cbx.debug().entered, null, 120000);
    await sleep(1500);
    log('in selfie; startPlay directly ->', await page.evaluate(() => window.__cbx.startPlay('heart-hoops')));
    await page.evaluate(() => window.__cbApp.openSheet('games'));
    await sleep(1000);
    await page.evaluate(() => document.querySelector('.cb-play-card.is-heart-hoops').click());
    await waitFor(page, () => window.__cbx.debug().play.state === 'countdown', null, 120000);
    log('selfie -> card ->', await page.evaluate(() => window.__cbx.mode), JSON.stringify(await page.evaluate(() => window.__cbx.debug().play)));
    await sleep(1000);
    await shot(page, `${P}-06-selfie-to-hoops`);
  }
  const errs = errorsOf(logs);
  log('errors', errs.length, errs.slice(0, 8).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
