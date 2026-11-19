// wow-2 AR run (fake floor camera + fake IMU, 390x844): place, heart toss on the real floor plane, poke, hug, Care
// Bear Stare along the floor, Party balloons + pop, Rainbow stars, Cold snow, Move (state kept). Lists any shader
// program that appears after placing (must be none).
//   BASE=http://localhost:5194 OUT=... FLOOR=/path/floor.y4m node ar.cjs
const path = require('path');
const os = require('os');
const { launch, shot, sleep, waitFor, errorsOf, BASE, flick, press, project } = require('./lib.cjs');
const T = 300000;
const SEL = 'canvas.cbx-xr';
(async () => {
  const video = process.env.FLOOR || path.join(__dirname, 'floor.y4m');
  const { browser, page, logs } = await launch({ phone: true, video });
  const log = (...a) => console.log('ar', ...a);
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
  if (process.env.FORCE_SETTLE) {
    // Test-only: on a loaded machine (other simulators running) swiftshader drops to 1-2 fps, every frame counts as a
    // stall (> 250 ms) and world-health never reports settled. Once tracking is NORMAL, mark it settled so the run can
    // go on; the engine then compiles every root (its normal warm path) and Place enables as usual.
    await waitFor(page, () => window.__cb.debug().tracking === 'NORMAL', null, T);
    await sleep(3000);
    await page.evaluate(() => { window.__cb.internals().engine.wh.settled = () => true; });
    log('FORCE_SETTLE: world-health settle forced after tracking NORMAL (machine load)', os.loadavg().map((x) => x.toFixed(1)).join(' '));
  }
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(4000);
  const progs = () => page.evaluate(() => window.__cb.internals().engine.xr.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.length + '|' + p.cacheKey.slice(0, 60)));
  let base = await progs();
  log('placed; programs', base.length);
  const diff = async (label) => { const now = await progs(); const add = now.filter((x) => !base.includes(x)); log(label.padEnd(10), 'programs', now.length, add.length ? '\n   + ' + add.join('\n   + ') : ''); base = now; };
  const stats = () => page.evaluate(() => { const I = window.__cb.internals(); const t = I.modes.get('ar').toss; return { thrown: t.thrown, caught: t.caught, combo: t.combo, toys: I.stages.ar.play.liveCount, fps: window.__cb.debug().engineFps }; });
  const idle = () => waitFor(page, () => !window.__cb.debug().moment.ar, null, T);
  // On a loaded machine SLAM drifts (1-2 fps) and the stage can wander out of view. If she is off screen, do what a
  // user would: Move, then Place again in front of the camera (Move keeps everything).
  let recentres = 0;
  const inView = async () => {
    const bp = await page.evaluate(() => window.__cb.internals().stages.ar.actor.position.toArray());
    const s = await project(page, 'ar', [bp[0], 0.5, bp[2]]);
    return s.x > 40 && s.x < 350 && s.y > 120 && s.y < 700;
  };
  const ensureInView = async () => {
    if (await inView()) return;
    recentres++;
    await idle();
    await page.evaluate(() => document.querySelector('.cbx-slot-left .cbx-tool').click());
    await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
    await sleep(1500);
    await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
    await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
    await sleep(1500);
    log('re-placed in view (drift)', recentres);
  };
  await waitFor(page, () => /throw/i.test(document.querySelector('.ml-hint, .cbx-hint')?.textContent || ''), null, 60000).catch(() => null);
  log('hint:', await page.evaluate(() => document.querySelector('.ml-hint, .cbx-hint')?.textContent));
  await shot(page, 'ar-01-placed-hint');
  await idle();
  await ensureInView();
  for (let i = 0; i < 5; i++) {
    await flick(page, SEL, { len: 150 + (i % 3) * 30, dx: (i % 2 ? 1 : -1) * 14 });
    await sleep(300);
    if (i < 2) await shot(page, `ar-02-toss-${i}`);
    await sleep(1400);
  }
  await shot(page, 'ar-03-after-catches');
  log('after 5 flicks', JSON.stringify(await stats()));
  await ensureInView();
  // a weak throw (too short): it lands in front of her, bounces and rolls (the flick path is covered above)
  await page.evaluate(() => window.__cb.internals().modes.get('ar').throwHeart(0.12, 0.1));
  await sleep(900);
  await shot(page, 'ar-04-miss-bounce');
  await sleep(1200);
  await shot(page, 'ar-04b-miss-rest');
  log('after miss', JSON.stringify(await stats()));
  await diff('toss');
  await idle();
  await ensureInView();
  const bp = await page.evaluate(() => window.__cb.internals().stages.ar.actor.position.toArray());
  const bear = await project(page, 'ar', [bp[0], 0.55, bp[2]]);
  await press(page, SEL, bear.x, bear.y, 60);
  await sleep(200);
  await shot(page, 'ar-05-poke');
  await idle();
  await sleep(400);
  await press(page, SEL, bear.x, bear.y, 900);
  await sleep(250);
  await shot(page, 'ar-06-hug');
  await diff('poke/hug');
  await idle();
  await ensureInView();
  log('Stare ->', await page.evaluate(() => window.__cb.trigger('Care Bear Stare')));
  await sleep(1400); await shot(page, 'ar-07-stare-fire');
  await sleep(1400); await shot(page, 'ar-07b-stare-beam');
  await sleep(1800); await shot(page, 'ar-07c-stare-stars');
  await idle();
  await diff('Stare');
  await ensureInView();
  log('Party ->', await page.evaluate(() => window.__cb.trigger('Party')));
  await sleep(4000);
  await shot(page, 'ar-08-party-balloons');
  const b = await page.evaluate(() => { const bs = window.__cb.internals().stages.ar.play.pool('balloon').filter((x) => x.alive); return bs.length ? [bs[0].p.x, bs[0].p.y, bs[0].p.z, bs.length] : null; });
  if (b) {
    const s = await project(page, 'ar', b);
    await press(page, SEL, s.x, s.y, 60);
    await sleep(150);
    await shot(page, 'ar-08b-party-pop');
    log('balloons', b[3], '-> after pop', await page.evaluate(() => window.__cb.internals().stages.ar.play.count('balloon')));
  }
  await idle();
  await diff('Party');
  await ensureInView();
  log('Rainbow ->', await page.evaluate(() => window.__cb.trigger('Rainbow')));
  await sleep(2500); await shot(page, 'ar-09-rainbow-stars');
  await idle();
  await ensureInView();
  log('Cold ->', await page.evaluate(() => window.__cb.trigger('Cold')));
  await sleep(5200); await shot(page, 'ar-10-cold-snow');
  await idle();
  await diff('Rainbow/Cold');
  // Move keeps state: throw, then Move and Place again
  await flick(page, SEL, { len: 170 });
  await sleep(300);
  const before = await stats();
  await page.evaluate(() => document.querySelector('.cbx-slot-left .cbx-tool').click());
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(1500);
  log('move kept', JSON.stringify(before), '->', JSON.stringify(await stats()));
  await shot(page, 'ar-11-after-move');
  await diff('move');
  log('re-placements for drift', recentres);
  log('events', JSON.stringify((await page.evaluate(() => window.__cb.events)).filter((e) => e.event === 'action').map((e) => e.payload)));
  log('engine', JSON.stringify((await page.evaluate(() => window.__cb.debug())).engine?.engine));
  log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
