// ar-4: the house pops away while a mini game runs (AR and 3D) and comes back when it ends.
// AR: place -> Step inside -> start Heart Run while inside (exits first) -> house away (root hidden, no bounds,
// mailbox hidden, no toy wall) -> pickups -> stop -> house back, her out of its walls -> Heart Hoops -> stop.
// 3D: House moment playing -> start Heart Run (moment cut, house away) -> stop.
// Programs must stay flat.  usage: node games.cjs <floor.y4m>   (BASE=http://localhost:5211, OUT=dir for shots)
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 300000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const H = (page, v = 'ar') => page.evaluate((v) => {
  const st = window.__cb.internals().stages[v], hs = st.houseSet;
  return {
    rootVis: hs.root.visible, away: hs.away, awayK: +hs.awayK.toFixed(2), present: hs.present, inside: hs.inside,
    mailbox: st.mailbox.visible, toyWall: st.play.houseBox.on, play: window.__cb.debug().play.state,
    programs: (v === 'ar' ? window.__cb.internals().engine.xr?.renderer : window.__cb.internals().showcase.renderer)?.info.programs.length,
  };
}, v);
// houseBounds() as the games read it (a duck-typed Box3 is enough: true = the house still claims its ground)
const bounds = (page) => page.evaluate(() => !!window.__cb.internals().stages.ar.houseSet.bounds({ makeEmpty() { return this; }, expandByPoint() { return this; }, min: {}, max: {} }));

(async () => {
  const { browser, page, logs } = await launch({ phone: true, video: process.argv[2] });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(5000);
  // ---- 3D: the House moment, then a game starts on top of it
  await page.evaluate(() => window.__cb.trigger('House'));
  await sleep(2500);
  log('3D house moment', JSON.stringify(await H(page, 'showcase')), 'visible', await page.evaluate(() => window.__cb.internals().stages.showcase.house.visible));
  await shot(page, 'games-3d-01-house-moment');
  await page.evaluate(() => window.__cb.exp.startPlay('heart-run'));
  await sleep(1500);
  log('3D game on', JSON.stringify(await H(page, 'showcase')), 'house group visible', await page.evaluate(() => window.__cb.internals().stages.showcase.house.visible));
  await shot(page, 'games-3d-02-run-no-house');
  await page.evaluate(() => window.__cb.exp.stopPlay());
  await sleep(1000);
  log('3D game off', JSON.stringify(await H(page, 'showcase')));

  // ---- AR
  for (let i = 0; ; i++) {
    await click(page, '.cbx-switch [data-mode=ar]');
    const ok = await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered; }, null, 30000).then(() => true).catch(() => false);
    if (ok) break;
    if (i > 8) throw new Error('AR never entered');
  }
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().stages.ar.houseSet.open > 0.6, null, T);
  const p0 = (await H(page)).programs;
  log('AR placed, door open', JSON.stringify(await H(page)), 'bounds', await bounds(page));
  await shot(page, 'games-ar-01-placed');
  await click(page, '[data-cmd=step-inside]');
  await waitFor(page, () => { const m = window.__cb.internals().modes.get('ar'); return m.inside && !m.walk.busy; }, null, T);
  log('AR inside', JSON.stringify(await H(page)));
  // a game starts while you're inside: out first, then the house pops away
  await page.evaluate(() => window.__cb.exp.startPlay('heart-run'));
  await sleep(300);
  log('AR run starting (0.3 s)', JSON.stringify(await H(page)));
  await sleep(1500);
  const away = await H(page);
  log('AR run on', JSON.stringify(away), 'bounds', await bounds(page));
  await shot(page, 'games-ar-02-run-house-away');
  await waitFor(page, () => window.__cb.debug().play.state === 'playing', null, T);
  await sleep(3000);
  const picks = await page.evaluate(() => {
    const g = window.__cb.internals().play.game;
    return g.slots.filter((s) => s.alive).map((s) => ({ x: +s.x.toFixed(2), z: +s.z.toFixed(2) }));
  });
  log('pickups', JSON.stringify(picks));
  await shot(page, 'games-ar-03-run-playing');
  await page.evaluate(() => window.__cb.exp.stopPlay());
  await sleep(200);
  log('AR run stopped (0.2 s)', JSON.stringify(await H(page)));
  await sleep(1500);
  const back = await H(page);
  log('AR house back', JSON.stringify(back), 'bounds', await bounds(page));
  await shot(page, 'games-ar-04-house-back');
  await page.evaluate(() => window.__cb.exp.startPlay('heart-hoops'));
  await sleep(1800);
  log('AR hoops on', JSON.stringify(await H(page)));
  await shot(page, 'games-ar-05-hoops-house-away');
  await page.evaluate(() => window.__cb.exp.stopPlay());
  await sleep(1800);
  const end = await H(page);
  log('AR hoops off', JSON.stringify(end));
  const ok = away.away && !away.rootVis && !away.mailbox && !away.toyWall && !away.inside && back.rootVis && back.present && back.mailbox && end.present && end.programs === p0;
  log('GAMES', ok ? 'PASS' : 'FAIL', 'programs', p0, '->', end.programs);
  const errs = errorsOf(logs).filter((l) => !/too many errors/.test(l));
  log('errors', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close();
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
