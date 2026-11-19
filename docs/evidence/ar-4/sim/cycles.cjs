// ar-4: Move / Place / pinch cycles in AR (fake floor camera + fake IMU). Each cycle: wait for Place (fresh settled
// gate), pinch with two real touch points (CDP touch events on the camera canvas), Place, open door, go inside
// (walking through the door with the test pose, or Step inside), then Move. After every Move it asserts: outside,
// no glide, not posed, door shut, pinch scale == the default, house life size, placing, Place disabled until tracking
// settles again, SLAM recentred. Programs must stay flat.
// usage: node cycles.cjs <floor.y4m> [cycles=10]     (BASE=http://localhost:5211, OUT=dir for shots)
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE, OUT } = require('./lib.cjs');
const T = 300000;
const N = +(process.argv[3] || 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const pose = (page, p) => page.evaluate((p) => { window.__cb.internals().modes.get('ar').walk.testPose = p; }, p);
const placeReady = (page) => page.evaluate(() => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return !!b && !b.disabled && /Place/.test(b.textContent); });
const S = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('ar'), hs = m.stage.houseSet, eng = window.__cb.internals().engine;
  return {
    state: m.placed ? 'placed' : 'placing', scale: +m.pinchScale.toFixed(4), def: m.constructor.DEFAULT_SCALE, sizeMul: +hs.sizeMul.toFixed(4),
    lifeK: +(hs.k * m.pinchScale).toFixed(4), inside: hs.inside, busy: m.walk.busy, posed: hs.posed, bearIn: m.walk.bearIn, open: +hs.open.toFixed(2),
    plain: hs.plain, latch: eng.settledLatch, regates: eng.wh.snapshot().regates, moves: m.moves, programs: eng.xr.renderer.info.programs.length,
    theme: window.__cb.debug().themeOn, leaf: +hs.leaf.rotation.y.toFixed(2), bearZ: +hs.fromStage(m.stage.actor.position.clone()).z.toFixed(2), cam: eng.xr.camera.position.toArray().map((v) => +v.toFixed(2)), target: (() => { const e = document.elementFromPoint(195, 430); return e ? e.tagName + '.' + e.className : null; })(),
  };
});

async function pinch(page, cdp, factor) {
  // two fingers around the screen centre, spread (factor > 1) or squeezed (< 1) in 8 steps
  const cx = 195, cy = 430, d0 = 70, d1 = 70 * factor;
  const pts = (d) => [{ x: cx - d, y: cy, id: 1, radiusX: 4, radiusY: 4, force: 1 }, { x: cx + d, y: cy, id: 2, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * (i / 8)) }); await sleep(60); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}

(async () => {
  const video = process.argv[2];
  const { browser, page, logs } = await launch({ phone: true, video });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(3000);
  for (let i = 0; ; i++) {
    await click(page, '.cbx-switch [data-mode=ar]');
    const ok = await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered; }, null, 30000).then(() => true).catch(() => false);
    if (ok) break;
    if (i > 8) throw new Error('AR never entered');
  }
  const results = [];
  let programs0 = null;
  const factors = [1.5, 0.7, 1.35, 1.8, 0.6, 1.25, 1.6, 0.8, 1.4, 1.2];
  for (let c = 0; c < N; c++) {
    const t0 = Date.now();
    await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
    const waitS = (Date.now() - t0) / 1000;
    const pre = await S(page);
    if (programs0 === null) programs0 = pre.programs;
    const f = factors[c % factors.length];
    await pinch(page, cdp, f);
    const pinched = await S(page);
    const expect = Math.min(1.3, Math.max(0.25, pre.scale * f));
    const pinchOk = Math.abs(pinched.scale - expect) / expect < 0.12 && pinched.scale !== pre.scale;
    if (c === 0) await shot(page, 'cycle-01-pinched');
    await click(page, '.cbx-slot-centre .cbx-pill');
    await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
    // door opens a beat after Place once tracking is calm
    const doorT = Date.now();
    await waitFor(page, () => window.__cb.internals().stages.ar.houseSet.open > 0.6, null, T);
    const doorS = (Date.now() - doorT) / 1000;
    // go inside: walk through the door (even cycles) or Step inside (odd cycles)
    if (c % 2 === 0) {
      for (const z of [1.6, 1.0, 0.5, 0.1, -0.3, -0.8, -1.3]) { await pose(page, { x: 0, y: 1.4, z, yaw: 0, pitch: -0.1 }); await sleep(700); }
    } else {
      await click(page, '[data-cmd=step-inside]').catch(() => page.evaluate(() => window.__cb.internals().modes.get('ar').enterHouse()));
      await waitFor(page, () => { const m = window.__cb.internals().modes.get('ar'); return m.inside && !m.walk.busy; }, null, T).catch(() => {});
    }
    const inside = await S(page);
    if (c === 0) await shot(page, 'cycle-01-inside');
    await pose(page, null);
    // Move while inside
    await click(page, '.cbx-slot-left [data-cmd=move]');
    const camBefore = (await S(page)).cam;
    await sleep(150);
    const after = await S(page);
    const ready = await placeReady(page);
    await sleep(1500);
    const camAfter = (await S(page)).cam;
    const ok = after.state === 'placing' && !after.inside && !after.busy && !after.posed && !after.bearIn && after.open === 0 && !after.plain
      && after.scale === after.def && after.sizeMul === 1 && after.lifeK === 1 && !after.latch && after.regates === c + 1 && !ready && !after.theme
      && after.programs === programs0 && after.leaf === 0 && after.bearZ > 0.3;
    const row = { cycle: c + 1, waitPlaceS: +waitS.toFixed(1), pinch: `${pre.scale}->${pinched.scale} (x${f})`, pinchOk, houseAtPinch: pinched.sizeMul, doorS: +doorS.toFixed(1), insideBeforeMove: inside.inside, plainInside: inside.plain, afterMove: `scale ${after.scale} life ${after.lifeK} open ${after.open} leaf ${after.leaf} bearZ ${after.bearZ} inside ${after.inside} latch ${after.latch} placeEnabled ${ready}`, programs: after.programs, cam: `${camBefore.join(',')} -> ${camAfter.join(',')}`, ok: ok && pinchOk && inside.inside, target: pre.target };
    results.push(row);
    log(JSON.stringify(row));
    if (c === 0) { await sleep(1200); await shot(page, 'cycle-01-after-move'); }
  }
  console.table(results.map(({ target, ...r }) => r));
  const pass = results.every((r) => r.ok);
  log('ALL CYCLES', pass ? 'PASS' : 'FAIL', 'pinch target', results[0]?.target);
  fs.writeFileSync(path.join(OUT, 'cycles.json'), JSON.stringify(results, null, 1));
  const errs = errorsOf(logs).filter((l) => !/too many errors/.test(l));
  log('errors', errs.length ? '\n' + errs.join('\n') : 'none');
  log('notes', JSON.stringify((await page.evaluate(() => window.__cb.debug().engine.notes)).slice(-30)));
  await browser.close();
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
