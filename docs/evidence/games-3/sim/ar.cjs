// games-3, AR with the fake floor camera + fake IMU (390x844): place, Games button above Move, Heart Run on the floor
// (autopilot on the joystick), Move during the round (pauses, keeps state), Place (3-2-1, carries on), results;
// then Heart Hoops with synthetic flicks. Lists shader programs that appear after placing (must be none).
//   BASE=http://localhost:5202 OUT=<dir> FLOOR=<floor.y4m> [FORCE_SETTLE=1] node ar.cjs
const os = require('os');
const { launch, shot, sleep, waitFor, errorsOf, BASE, flick, startDriver, stopDriver, play } = require('./lib.cjs');
const T = 400000;
const SEL = 'canvas.cbx-xr';
(async () => {
  const { browser, page, logs } = await launch({ phone: true, video: process.env.FLOOR });
  const log = (...a) => console.log('ar', ...a);
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
  if (process.env.FORCE_SETTLE) {
    await waitFor(page, () => window.__cb.debug().tracking === 'NORMAL', null, T);
    await sleep(3000);
    await page.evaluate(() => { window.__cb.internals().engine.wh.settled = () => true; });
    log('FORCE_SETTLE (test only) load', os.loadavg().map((x) => x.toFixed(1)).join(' '));
  }
  const pill = () => waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await pill();
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(4000);
  const progs = () => page.evaluate(() => window.__cb.internals().engine.xr.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.length));
  const base = await progs();
  const fps = () => page.evaluate(() => window.__cb.debug().engineFps);
  log('placed; programs', base.length, 'fps', await fps());
  await shot(page, 'ar-01-placed-games-button');
  // Heart Run from the Games button (above Move)
  await page.evaluate(() => document.querySelector('.cbx-slot-left [data-cmd=games]').click());
  await sleep(600);
  await page.evaluate(() => document.querySelector('.cbx-sheet [data-game=heart-run]').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  await sleep(500);
  await shot(page, 'ar-02-run-countdown');
  await startDriver(page, 'ar');
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(7000);
  log('mid', JSON.stringify(await play(page)), 'fps', await fps());
  await shot(page, 'ar-03-run-mid');
  // Move during the round: paused, Move -> Place keeps the score and the clock
  await page.evaluate(() => document.querySelector('.cbx-slot-left [data-cmd=move]').click());
  await sleep(1200);
  const before = await play(page);
  log('after Move', JSON.stringify(before), 'left slot', await page.evaluate(() => [...document.querySelectorAll('.cbx-slot-left > *')].map((b) => b.dataset.cmd).join(',')));
  await shot(page, 'ar-04-run-move');
  await pill();
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  const resumed = await play(page);
  log('placed again ->', JSON.stringify(resumed), 'kept score + clock', resumed.score === before.score && resumed.timeLeft === before.timeLeft);
  await shot(page, 'ar-05-run-resume-countdown');
  // Test-only shortcut: AR runs at 2-3 fps in this sandbox and dt is clamped, so the 60 s round would take ~10 min.
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(4000);
  await page.evaluate(() => { const g = window.__cb.internals().play.game; if (g.timeLeft > 8) g.timeLeft = 8; });
  log('test shortcut: timeLeft set to 8 s');
  await waitFor(page, () => ['won', 'over'].includes(window.__cb.debug().play.state), null, T);
  await stopDriver(page);
  log('end', JSON.stringify(await play(page)), 'fps', await fps());
  await waitFor(page, () => !!document.querySelector('.cbp-wrap .cbp-stars'), null, T);
  await sleep(1000);
  await shot(page, 'ar-06-run-results');
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=done]').click());
  await sleep(800);
  // Heart Hoops
  await page.evaluate(() => window.__cb.exp.startPlay('heart-hoops'));
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(1500);
  await shot(page, 'ar-07-hoops-start');
  const lens = [100, 100, 108, 45, 96, 102, 250, 100, 98, 104];
  for (let i = 0; i < 10; i++) {
    await waitFor(page, () => { const g = window.__cb.internals().play.game; return g && g.moveT >= 1 && g.state === 'playing'; }, null, T);
    await flick(page, SEL, { x: 195, y: 640, len: lens[i], dx: i % 2 ? 4 : -4 });
    await sleep(600);
    if (i === 1) await shot(page, 'ar-08-hoops-throw');
    await sleep(2600);
  }
  await waitFor(page, () => ['won', 'over'].includes(window.__cb.debug().play.state), null, T);
  log('hoops end', JSON.stringify(await play(page)), 'fps', await fps());
  await waitFor(page, () => !!document.querySelector('.cbp-wrap .cbp-stars'), null, T);
  await sleep(1000);
  await shot(page, 'ar-09-hoops-results');
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=done]').click());
  await sleep(800);
  const now = await progs();
  log('programs after', now.length, 'new:', JSON.stringify(now.filter((x) => !base.includes(x))));
  await shot(page, 'ar-10-after');
  const errs = errorsOf(logs);
  log('errors', errs.length, errs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
