// polish-4: Heart Hoops clarity (heart in hand, rack, swipe coach, aim arc, slow swipe, score pop, ring flash, last
// heart call-out, near miss, results) in 3D (phone or desktop) or AR (fake floor camera + IMU), plus the Heart Run
// joystick nudge (3D). Logs shader programs before / after (must not grow) and console errors.
//   BASE=http://localhost:5213 OUT=<dir> [W=390 H=844 | W=1440 H=900 DESKTOP=1] [AR=1 FLOOR=<floor.y4m> FORCE_SETTLE=1] node hoops.cjs
const path = require('path');
const G = path.join(__dirname, '../../games-3/sim/lib.cjs');
const { launch, shot, sleep, waitFor, errorsOf, flick } = require(G);
const BASE = process.env.BASE || 'http://localhost:5213';
const T = 400000;
const W = +(process.env.W || 390), H = +(process.env.H || 844), DESK = !!process.env.DESKTOP, AR = !!process.env.AR;
const P = process.env.PREFIX || (AR ? 'ar' : DESK ? 'desk' : 'phone');
const SEL = AR ? 'canvas.cbx-xr' : 'canvas.cbx-3d';
const log = (...a) => console.log(P, ...a);

/** A slow drag up (below the flick speed): pointerdown, moves every `ms`, optional release. */
function slowDrag(page, { x = 195, y = 640, len = 200, dx = 0, steps = 14, ms = 70, release = true } = {}) {
  return page.evaluate(({ sel, x, y, len, dx, steps, ms, release }) => new Promise((res) => {
    const el = document.querySelector(sel);
    const o = { pointerId: 21, bubbles: true, isPrimary: true, pointerType: 'touch', button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
    let i = 0;
    const step = () => {
      i++;
      el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + (dx * i) / steps, clientY: y - (len * i) / steps }));
      if (i < steps) setTimeout(step, ms);
      else if (release) setTimeout(() => { el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y - len })); res(); }, ms);
      else res();
    };
    setTimeout(step, ms);
  }), { sel: SEL, x, y, len, dx, steps, ms, release });
}
const up = (page, x, y) => page.evaluate(({ sel, x, y }) => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, bubbles: true, isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: y })), { sel: SEL, x, y });
const game = (page) => page.evaluate(() => {
  const g = window.__cb.internals().play.game;
  if (!g) return null;
  return { state: g.state, score: g.score, thrown: g.thrown, made: g.made, swishes: g.swishes, hand: g.hand ? { ...g.hand.diag, ready: g.hand.ready, money: g.hand.money, guide: g.hand.guide } : null };
});
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }, sel);

(async () => {
  const { browser, page, logs } = await launch({ phone: !DESK, w: W, h: H, video: AR ? process.env.FLOOR : undefined });
  if (process.env.RM) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await sleep(2500);
  let progs;
  if (AR) {
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
    if (process.env.FORCE_SETTLE) {
      await waitFor(page, () => window.__cb.debug().tracking === 'NORMAL', null, T);
      await sleep(3000);
      await page.evaluate(() => { window.__cb.internals().engine.wh.settled = () => true; });
      log('FORCE_SETTLE (test only)');
    }
    await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
    await sleep(2500);
    await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
    await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
    await sleep(5000);
    progs = () => page.evaluate(() => window.__cb.internals().engine.xr.renderer.info.programs.length);
  } else progs = () => page.evaluate(() => window.__cb.internals().showcase.renderer.info.programs.length);
  const p0 = await progs();
  log('programs before', p0);

  // ---- Heart Hoops
  await page.evaluate(() => window.__cb.exp.startPlay('heart-hoops'));
  await waitFor(page, () => window.__cb.debug().play.state === 'countdown', null, T);
  await sleep(AR ? 1500 : 900);
  await shot(page, `${P}-01-hoops-countdown-heart-in-hand`);
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await waitFor(page, () => document.querySelector('.cbp-coach.on'), null, T);
  await sleep(AR ? 2500 : 900);
  log('ready', JSON.stringify(await game(page)), 'rack', JSON.stringify(await rect(page, '.cbp-rack')), 'coach pill', JSON.stringify(await rect(page, '.cbp-coach-pill')), 'board', JSON.stringify(await rect(page, '.cbp-board')));
  await shot(page, `${P}-02-hoops-ready-hand-rack-coach`);
  await sleep(700);
  await shot(page, `${P}-03-hoops-coach-later-frame`);

  // aiming: a slow drag held (the aim arc), then let go (a slow swipe throws too); a computer winds up with Space
  if (DESK) {
    await page.keyboard.down('Space');
    await sleep(AR ? 1500 : 650);
    log('space held', JSON.stringify(await game(page)));
    await shot(page, `${P}-04-hoops-aiming`);
    await page.keyboard.up('Space');
  } else {
    await slowDrag(page, { len: 190, dx: 6, release: false });
    await sleep(AR ? 1500 : 300);
    log('dragging', JSON.stringify(await game(page)));
    await shot(page, `${P}-04-hoops-aiming`);
    await up(page, 201, 640 - 190);
  }
  await sleep(AR ? 500 : 180);
  await shot(page, `${P}-05-hoops-mid-throw`);
  log('after the slow throw', JSON.stringify(await game(page)));

  // the rest: flicks (mostly well judged, one short, one long); shoot the first score pop and the last-heart call-out
  const lens = [100, 98, 104, 40, 102, 100, 260, 100, 99];
  let popShot = false;
  for (let i = 0; i < lens.length; i++) {
    await waitFor(page, () => { const g = window.__cb.internals().play.game; return g && g.moveT >= 1 && g.state === 'playing' && g.hand.ready; }, null, T);
    const before = await game(page);
    if (before.thrown >= 10) break;
    if (before.thrown === 9) { await sleep(AR ? 2500 : 500); await shot(page, `${P}-07-hoops-last-heart-x2`); }
    if (DESK) { await page.keyboard.down('Space'); await sleep(i === 3 ? 150 : i === 6 ? 1300 : 560); await page.keyboard.up('Space'); }
    else await flick(page, SEL, { x: 195, y: 640, len: lens[i], dx: i % 2 ? 4 : -4 });
    if (!popShot) {
      const t0 = Date.now();
      // wait for this heart to score (or come down)
      while (Date.now() - t0 < (AR ? 40000 : 6000)) {
        const g = await game(page);
        if (g.made > before.made) { await shot(page, `${P}-06-hoops-score-pop`); popShot = true; log('score pop', JSON.stringify(g)); break; }
        if (await page.evaluate(() => { const g = window.__cb.internals().play.game; return g.resolved >= g.thrown; })) break;
        await sleep(60);
      }
    }
    await sleep(AR ? 3000 : 1400);
  }
  await waitFor(page, () => ['won', 'over'].includes(window.__cb.debug().play.state), null, T);
  log('hoops end', JSON.stringify(await game(page)));
  await waitFor(page, () => !!document.querySelector('.cbp-wrap .cbp-stars'), null, T);
  await sleep(1000);
  await shot(page, `${P}-08-hoops-results`);
  // play again, pause: the aim guide switch on the pause card
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-a=again]').click());
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await page.evaluate(() => document.querySelector('.cbp-pause').click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-aim=full]').click());
  await sleep(300);
  log('aim guide after tapping Full', JSON.stringify((await game(page)).hand.guide), await page.evaluate(() => localStorage.getItem('cbx.play.aim')));
  await shot(page, `${P}-09-hoops-paused-aim-guide`);
  await page.evaluate(() => document.querySelector('.cbp-wrap [data-aim=short]').click());
  await page.evaluate(() => window.__cb.exp.stopPlay());
  await sleep(600);
  log('stopped: leftover DOM', await page.evaluate(() => document.querySelectorAll('.cbp-rack,.cbp-coach,.cbp-aim,.cbp-board').length));

  // ---- Heart Run: the joystick nudge (nobody touches the stick)
  if (!AR) {
    await page.evaluate(() => window.__cb.exp.startPlay('heart-run'));
    await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
    await waitFor(page, () => !!document.querySelector('.cbp-nudge-pill.on'), null, 30000).catch(() => log('NO nudge'));
    await sleep(600);
    log('run nudge', await page.evaluate(() => window.__cb.internals().play.game.nudges), 'stick ring', await page.evaluate(() => !!document.querySelector('.cbx-stick.cbp-nudge')));
    await shot(page, `${P}-10-run-joystick-nudge`);
    // she moves: it goes
    await page.evaluate(() => { const v = window.__cb.internals().showcase.keys.vector; v.x = -1; setTimeout(() => { v.x = 0; }, 1500); });
    await sleep(2400);
    log('after moving: nudge pill', await page.evaluate(() => document.querySelectorAll('.cbp-nudge-pill').length), 'ring', await page.evaluate(() => !!document.querySelector('.cbx-stick.cbp-nudge')));
    await page.evaluate(() => window.__cb.exp.stopPlay());
  }
  await sleep(500);
  log('programs after', await progs(), '(before', p0 + ')');
  const errs = errorsOf(logs);
  log('errors', errs.length, errs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
