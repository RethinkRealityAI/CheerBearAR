// House-3 AR run (fake floor camera + fake IMU): place -> door opens -> walk the camera through the door with the
// test pose hook -> TV, look back, jukebox party, photo wall -> leave -> Step inside / Leave -> Move.
// usage: node ar.cjs <floor.y4m>   (BASE=http://localhost:5203)
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 300000;
const dbg = (page) => page.evaluate(() => window.__cb.debug());
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);
const pose = (page, p) => page.evaluate((p) => { window.__cb.internals().modes.get('ar').walk.testPose = p; }, p);
const fps = (page, ms = 3000) => page.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else r(+(n * 1000 / (performance.now() - t0)).toFixed(1)); }; requestAnimationFrame(f); }), ms);
const progs = async (page) => (await dbg(page)).enginePrograms;
const state = (page) => page.evaluate(() => { const hs = window.__cb.internals().stages.ar.houseSet; const m = window.__cb.internals().modes.get('ar'); return { inside: hs.inside, open: +hs.open.toFixed(2), roomVis: hs.room.group.visible, bodyVis: hs.body.visible, k: +hs.k.toFixed(3), theme: window.__cb.debug().themeOn, busy: m.walk.busy }; });
const only = process.argv[3] || 'all';

(async () => {
  const video = process.argv[2];
  const { browser, page, logs } = await launch({ phone: true, video });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await modeIs(page, 'showcase');
  log('showcase live; programs', await progs(page));
  await sleep(8000);
  for (let i = 0; ; i++) {
    await click(page, '.cbx-switch [data-mode=ar]');
    const ok = await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered; }, null, 30000).then(() => true).catch(() => false);
    if (ok) break;
    log('not in AR yet', JSON.stringify(await page.evaluate(() => { const d = window.__cb.debug(); return { mode: d.mode, entered: d.entered, moment: d.moment }; })));
    if (i > 8) throw new Error('AR never entered');
  }
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => { const d = window.__cb.debug(); const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return { settled: d.settled, pill: !!b && !b.disabled, mode: d.mode, health: d.engine?.health }; });
    if (s.settled && s.pill) break;
    if (i % 4 === 3) log('waiting for floor', JSON.stringify(s));
    if (i === 39) throw new Error('never settled');
    await sleep(15000);
  }
  await sleep(2000);
  const p0 = await progs(page);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(1500);
  const p1 = await progs(page);
  await sleep(3500);
  await shot(page, 'ar-01-placed-default-camera');
  log('placed; programs before place', p0, 'after place', p1, 'door open', await progs(page), JSON.stringify(await state(page)));
  log('fps outside (default camera)', await fps(page));

  // outside, standing in the garden facing her door
  await pose(page, { x: 0.35, y: 1.45, z: 4.2, yaw: 0.08, pitch: -0.08 });
  await sleep(1500);
  await shot(page, 'ar-02-outside');
  log('outside', JSON.stringify(await state(page)), 'programs', await progs(page));
  if (only === 'outside') { await browser.close(); return; }
  // the view through the door
  await pose(page, { x: 0.1, y: 1.4, z: 1.5, yaw: 0, pitch: -0.12 });
  await sleep(1500);
  await shot(page, 'ar-03-through-door');
  log('through door', JSON.stringify(await state(page)), 'programs', await progs(page), 'fps', await fps(page));
  // step through
  for (const z of [1.0, 0.5, 0.1, -0.3, -0.8]) { await pose(page, { x: 0, y: 1.4, z, yaw: 0, pitch: -0.1 }); await sleep(1300); }
  await sleep(1500);
  log('crossed', JSON.stringify(await state(page)), 'programs', await progs(page));
  await pose(page, { x: 0.2, y: 1.45, z: -1.4, yaw: 0, pitch: -0.08 });
  await sleep(2500);
  await shot(page, 'ar-04-inside-tv');
  log('inside at TV', JSON.stringify(await state(page)), 'fps', await fps(page));
  // look back at the door
  await pose(page, { x: -0.3, y: 1.45, z: -3.6, yaw: Math.PI, pitch: -0.1 });
  await sleep(1500);
  await shot(page, 'ar-05-inside-door');
  // left side: window, sofa, tub
  await pose(page, { x: 1.2, y: 1.45, z: -2.2, yaw: Math.PI / 2 - 0.2, pitch: -0.15 });
  await sleep(1200);
  await shot(page, 'ar-06-inside-left');
  // right side: bed, photo wall, chest
  await pose(page, { x: -1.0, y: 1.45, z: -2.4, yaw: -Math.PI / 2 + 0.15, pitch: -0.12 });
  await sleep(1200);
  await shot(page, 'ar-07-inside-right');
  // photo wall with a capture through the real capture callback
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
    g.fillStyle = '#8fd3ff'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#7ccf6a'; g.fillRect(0, 330, 640, 150);
    g.fillStyle = '#ff8fc0'; g.beginPath(); g.arc(320, 240, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText('Hi!', 320, 262);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    window.__cb.internals().modes.get('ar').sh.ctx.capture(b);
  });
  await pose(page, { x: 0.4, y: 1.55, z: -2.75, yaw: -Math.PI / 2, pitch: 0 });
  await sleep(2000);
  await shot(page, 'ar-08-photo-wall');
  // jukebox party
  await pose(page, { x: 0.3, y: 1.4, z: -2.3, yaw: 0.32, pitch: -0.12 });
  await page.evaluate(() => window.__cb.internals().stages.ar.houseSet.interact('jukebox'));
  await sleep(2500);
  await shot(page, 'ar-09-jukebox-party');
  log('party', JSON.stringify(await state(page)), 'programs', await progs(page), 'fps', await fps(page));
  for (const it of ['tv', 'tub', 'chest', 'mirror', 'lamp', 'tv']) { await page.evaluate((it) => window.__cb.internals().stages.ar.houseSet.interact(it), it); await sleep(1300); }
  log('taps done; programs', await progs(page));
  // walk out
  for (const z of [-1.5, -0.8, -0.3, 0.2, 0.8, 1.6, 2.6]) { await pose(page, { x: 0, y: 1.4, z, yaw: Math.PI, pitch: -0.1 }); await sleep(1300); }
  await sleep(1200);
  await shot(page, 'ar-10-walked-out');
  log('walked out', JSON.stringify(await state(page)), 'programs', await progs(page));
  // release the test camera, then Step inside / Leave
  await pose(page, null);
  await sleep(1500);
  await shot(page, 'ar-11-step-inside-pill');
  const hasStep = await page.evaluate(() => !!document.querySelector('[data-cmd=step-inside]'));
  log('step inside pill', hasStep);
  if (hasStep) await click(page, '[data-cmd=step-inside]'); else await page.evaluate(() => window.__cb.internals().modes.get('ar').enterHouse());
  await waitFor(page, () => window.__cb.debug().ar.inside, null, T);
  await sleep(4000);
  await shot(page, 'ar-12-stepped-inside');
  log('stepped inside', JSON.stringify(await state(page)), 'programs', await progs(page));
  await click(page, '.cbx-slot-left .cbx-tool:last-child');
  await sleep(5000);
  await shot(page, 'ar-13-left');
  log('left', JSON.stringify(await state(page)), JSON.stringify((await dbg(page)).ar), 'programs', await progs(page));
  // Move keeps state
  await click(page, '.cbx-slot-left .cbx-tool:first-child');
  await sleep(2500);
  await shot(page, 'ar-14-move');
  log('move', JSON.stringify((await dbg(page)).ar));
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T).catch(() => {});
  await click(page, '.cbx-slot-centre .cbx-pill').catch(() => {});
  await sleep(3000);
  log('re-placed', JSON.stringify((await dbg(page)).ar), JSON.stringify(await state(page)), 'programs', await progs(page));
  // leave the mode
  await click(page, '.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(1500);
  log('back to 3D; programs', await progs(page));
  const errs = errorsOf(logs).filter((l) => !/too many errors/.test(l));
  log('errors', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
