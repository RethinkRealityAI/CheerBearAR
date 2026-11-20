// games-3, 3D showcase: Games button + chooser, a full Heart Run round driven by the autopilot, results, Play again,
// then a full Heart Hoops round with synthetic flicks. Logs fps and shader programs before / during / after.
//   BASE=http://localhost:5202 OUT=<dir> [W=390 H=844 | W=1440 H=900 DESKTOP=1] [RM=1] node run3d.cjs
const { launch, shot, sleep, waitFor, errorsOf, BASE, flick, startDriver, stopDriver, play } = require('./lib.cjs');
const T = 400000;
const W = +(process.env.W || 390), H = +(process.env.H || 844), DESK = !!process.env.DESKTOP, P = process.env.PREFIX || (DESK ? 'desk' : 'phone');
(async () => {
  const { browser, ctx, page, logs } = await launch({ phone: !DESK, w: W, h: H });
  if (process.env.RM) await page.emulateMedia({ reducedMotion: 'reduce' });
  const log = (...a) => console.log(P, ...a);
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await sleep(3000);
  const dbg = () => page.evaluate(() => { const d = window.__cb.debug(); return { fps: d.fps, programs: d.showcasePrograms, warm: d.showcaseProgramsAfterWarm }; });
  const progList = () => page.evaluate(() => window.__cb.internals().showcase.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.length));
  log('before', JSON.stringify(await dbg()), 'playGames', await page.evaluate(() => JSON.stringify(window.__cb.exp.playGames.map((g) => g.id))));
  const base = await progList();
  await shot(page, `${P}-01-3d-games-button`);
  // the Games button (bottom left) opens the chooser
  await page.evaluate(() => document.querySelector('.cbx-slot-left [data-cmd=games]').click());
  await sleep(800);
  await shot(page, `${P}-02-chooser`);
  await page.evaluate(() => document.querySelector('.cbx-sheet [data-game=heart-run]').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  await sleep(700);
  await shot(page, `${P}-03-run-countdown`);
  if (DESK) {
    // keyboard: arrows drive her during the round
    await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
    const p0 = await page.evaluate(() => window.__cb.internals().stages.showcase.actor.position.toArray());
    await page.keyboard.down('ArrowLeft'); await sleep(2500); await page.keyboard.up('ArrowLeft');
    const p1 = await page.evaluate(() => window.__cb.internals().stages.showcase.actor.position.toArray());
    log('keyboard ArrowLeft moved her', p0.map((v) => v.toFixed(2)).join(','), '->', p1.map((v) => v.toFixed(2)).join(','));
  }
  await startDriver(page, 'showcase');
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(6000);
  log('mid', JSON.stringify(await play(page)), JSON.stringify(await dbg()));
  await shot(page, `${P}-04-run-mid`);
  // the raincloud comes after 18 s of round time
  await waitFor(page, () => window.__cb.internals().play.game?.elapsed > 21, null, T);
  log('cloud', JSON.stringify(await play(page)));
  await shot(page, `${P}-05-run-cloud`);
  // pause (the app's sheet / the pause button) and resume
  await page.evaluate(() => document.querySelector('.cbp-pause').click());
  await sleep(600);
  log('paused', JSON.stringify(await play(page)));
  await shot(page, `${P}-06-run-paused`);
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=go]').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await waitFor(page, () => ['won', 'over'].includes(window.__cb.debug().play.state), null, T);
  await stopDriver(page);
  log('end', JSON.stringify(await play(page)), JSON.stringify(await dbg()));
  await waitFor(page, () => !!document.querySelector('.cbp-wrap .cbp-stars'), null, T);
  await sleep(1200);
  await shot(page, `${P}-07-run-results`);
  // Play again -> countdown, then Done
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=again]').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  log('again ->', JSON.stringify(await play(page)));
  await page.evaluate(() => window.__cb.exp.stopPlay());
  await sleep(500);
  log('stopped', JSON.stringify(await play(page)), 'leftover DOM', await page.evaluate(() => document.querySelectorAll('.cbp-board,.cbp-wrap,.cbp-pop,.cbp-count').length), 'kit visible', await page.evaluate(() => { const k = window.__cb.internals().showcase.kit; return [k.hearts.count, k.beacons.count, k.hoop.visible, k.cloud.visible].join(','); }));

  // ---- Heart Hoops
  await page.evaluate(() => window.__cb.exp.startPlay('heart-hoops'));
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  await sleep(900);
  await shot(page, `${P}-08-hoops-countdown`);
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(1500);
  // ten throws: mostly well-judged swipes, a couple too short / too long
  const lens = [100, 95, 110, 40, 100, 105, 260, 100, 98, 102];
  for (let i = 0; i < 10; i++) {
    await waitFor(page, () => { const g = window.__cb.internals().play.game; return g && g.moveT >= 1 && g.state === 'playing'; }, null, T);
    if (DESK) {
      // Space: hold to wind up, let go to throw (0.55 s ~ spot on)
      await page.keyboard.down('Space'); await sleep(i === 3 ? 150 : i === 6 ? 1300 : 560); await page.keyboard.up('Space');
    } else await flick(page, 'canvas.cbx-3d', { x: W / 2, y: H - 230, len: lens[i] * (H / 844), dx: i % 2 ? 4 : -4 });
    await sleep(500);
    if (i === 1) await shot(page, `${P}-09-hoops-throw`);
    await sleep(2200);
    if (i === 2) { log('hoops mid', JSON.stringify(await play(page)), JSON.stringify(await dbg())); await shot(page, `${P}-10-hoops-mid`); }
  }
  await waitFor(page, () => ['won', 'over'].includes(window.__cb.debug().play.state), null, T);
  log('hoops end', JSON.stringify(await play(page)), JSON.stringify(await dbg()));
  await waitFor(page, () => !!document.querySelector('.cbp-wrap .cbp-stars'), null, T);
  await sleep(1200);
  await shot(page, `${P}-11-hoops-results`);
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=done]').click());
  await sleep(800);
  await shot(page, `${P}-12-after-done`);
  const now = await progList();
  log('after', JSON.stringify(await dbg()), 'new programs since start:', JSON.stringify(now.filter((x) => !base.includes(x))));
  log('free toss after games: throw ok =', await page.evaluate(() => window.__cb.internals().showcase.throwHeart(0.5, 0)));
  const errs = errorsOf(logs);
  log('errors', errs.length, errs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
