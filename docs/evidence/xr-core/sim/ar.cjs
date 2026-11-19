// AR run (fake floor camera + fake IMU): showcase -> AR -> place -> walk -> house expand -> Move -> showcase ->
// AR again (placement kept) -> face placeholder -> AR (one session swap). Programs must not grow on moments.
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');

const T = 300000;
const dbg = (page) => page.evaluate(() => window.__cb.debug());
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function stick(page, x, y, ms) {
  await page.evaluate(({ x, y }) => {
    const s = document.querySelector('.cbx-stick');
    const r = s.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const o = { pointerId: 7, bubbles: true, isPrimary: true, pointerType: 'touch' };
    s.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: cx, clientY: cy }));
    s.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: cx + x * r.width / 2, clientY: cy + y * r.height / 2 }));
  }, { x, y });
  await sleep(ms);
  await page.evaluate(() => {
    const s = document.querySelector('.cbx-stick');
    s.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true, pointerType: 'touch' }));
  });
}
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);

(async () => {
  const video = path.join(__dirname, process.argv[2] === 'face' ? 'face.y4m' : 'floor.y4m');
  const { browser, page, logs } = await launch({ phone: true, video });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await modeIs(page, 'showcase');
  log('showcase live');
  await sleep(2000);

  if (process.argv[2] === 'face') {
    await click(page, '.cbx-switch [data-mode=face]');
    await modeIs(page, 'face');
    log('face live');
    const found = await waitFor(page, () => { const m = window.__cb.internals().modes.get('face'); return m.root && m.root.children[0].visible; }, null, 120000).then(() => true).catch(() => false);
    log('face found:', found, JSON.stringify((await dbg(page)).engine?.engine));
    await sleep(1500);
    await shot(page, 'face-01-placeholder');
    await click(page, '.cbx-switch [data-mode=showcase]');
    await modeIs(page, 'showcase');
    await sleep(2500);
    await shot(page, 'face-02-back-to-3d');
    const errs = errorsOf(logs);
    log('errors', errs.length ? errs.join('\n') : 'none');
    await browser.close();
    return;
  }

  // ---- AR
  await click(page, '.cbx-switch [data-mode=ar]');
  await sleep(1200);
  await shot(page, 'ar-00-cover');
  await modeIs(page, 'ar');
  log('ar live');
  await sleep(1000);
  await shot(page, 'ar-01-finding-floor');
  await waitFor(page, () => window.__cb.debug().settled, null, T);
  log('settled', JSON.stringify((await dbg(page)).engine?.health ?? {}));
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(2500);
  await shot(page, 'ar-02-placing');
  const p0 = (await dbg(page)).enginePrograms;
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(4000);
  await shot(page, 'ar-03-placed');
  log('placed; programs', p0, (await dbg(page)).enginePrograms);

  // walk towards the house (away from the camera = stick up)
  await stick(page, 0, -1, 9000);
  await sleep(800);
  await shot(page, 'ar-04-walked');
  let d = await dbg(page);
  log('after walk', JSON.stringify(d.ar));
  if (!d.ar.inside) {
    // tap the house
    const pt = await page.evaluate(() => {
      const st = window.__cb.internals().stages.ar;
      const xr = window.__cb.internals().engine.xr;
      const v = st.houseModel.getWorldPosition(new xr.camera.position.constructor()).clone();
      v.y += 0.5 * st.root.scale.x;
      v.project(xr.camera);
      return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
    });
    log('tap house at', JSON.stringify(pt));
    await page.evaluate((pt) => {
      const c = document.querySelector('canvas.cbx-xr');
      const o = { pointerId: 9, bubbles: true, isPrimary: true, pointerType: 'touch', clientX: pt.x, clientY: pt.y };
      c.dispatchEvent(new PointerEvent('pointerdown', o));
      c.dispatchEvent(new PointerEvent('pointerup', o));
    }, pt);
    await sleep(500);
    d = await dbg(page);
    if (!d.ar.inside) {
      log('tap missed; entering by hook');
      await page.evaluate(() => window.__cb.internals().modes.get('ar').enterHouse());
    }
  }
  await waitFor(page, () => window.__cb.debug().ar.inside, null, T);
  await sleep(6000);
  await shot(page, 'ar-05-inside-house');
  d = await dbg(page);
  log('inside', JSON.stringify(d.ar), 'theme', d.themeOn, 'programs', d.enginePrograms);
  // leave via the Leave button, then the Move flow
  await click(page, '.cbx-slot-left .cbx-tool:last-child');
  await sleep(5000);
  await shot(page, 'ar-06-left-house');
  log('left', JSON.stringify((await dbg(page)).ar));

  // a few moments in AR
  for (const a of ['Rainbow', 'Party', 'Sleep', 'Magic']) {
    await waitFor(page, () => !window.__cb.debug().moment.ar, null, T);
    await page.evaluate((a) => window.__cb.trigger(a), a);
    await sleep(a === 'Party' ? 6000 : 3500);
    await shot(page, 'ar-07-' + a.toLowerCase(), 60);
  }
  await waitFor(page, () => !window.__cb.debug().moment.ar, null, T);
  d = await dbg(page);
  log('after AR moments: programs', d.enginePrograms, 'asleep', JSON.stringify(d.asleep));

  // Move: back to placing, keeps state
  await click(page, '.cbx-slot-left .cbx-tool');
  await sleep(1500);
  await shot(page, 'ar-08-move');
  log('move', JSON.stringify((await dbg(page)).ar));
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(1500);

  // AR -> showcase -> AR (placement kept)
  await click(page, '.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(2500);
  await shot(page, 'ar-09-back-to-3d');
  await click(page, '.cbx-switch [data-mode=ar]');
  await modeIs(page, 'ar');
  await sleep(1000);
  await shot(page, 'ar-10-ar-again-waiting');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.ar.placed && !d.ar.restoring && d.ar.visible; }, null, T);
  await sleep(3000);
  await shot(page, 'ar-11-ar-again-restored');
  log('restored', JSON.stringify((await dbg(page)).ar));

  // AR -> face placeholder -> AR (one engine session)
  await click(page, '.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await sleep(2500);
  await shot(page, 'ar-12-face-placeholder');
  await click(page, '.cbx-switch [data-mode=ar]');
  await modeIs(page, 'ar');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.ar.placed && !d.ar.restoring && d.ar.visible; }, null, T);
  await sleep(2500);
  await shot(page, 'ar-13-ar-after-face');
  d = await dbg(page);
  log('engine diag', JSON.stringify(d.engine?.engine));
  log('final programs', d.enginePrograms);
  const events = await page.evaluate(() => window.__cb.events);
  log('events', JSON.stringify(events.filter((e) => e.event !== 'action').slice(0, 40)));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  log('warnings', logs.filter((l) => l.startsWith('[warning]')).slice(0, 15).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
