// camera-5 AR: reticle above the controls, steady gate, lost hint, Move back into view, door opens as she walks up,
// Step inside after Leave. Fake floor camera (cams) + fake IMU.  node ar.cjs [w h tag]
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const S = __dirname, OUT = process.env.OUT || path.join(S, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const W = +process.argv[2] || 390, H = +process.argv[3] || 844, TAG = process.argv[4] || 'p';
const T = 400000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `ar-${TAG}-${n}.jpg`), type: 'jpeg', quality: 62 });
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const pose = (page, p) => page.evaluate((p) => { window.__cb.internals().modes.get('ar').walk.testPose = p; }, p);
const st = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('ar'), hs = m.stage.houseSet, eng = window.__cb.internals().engine, cam = eng.xr.camera;
  const hint = [...document.querySelectorAll('.cbx [class*=hint]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ');
  // the bear on screen (CSS px), or null when behind
  const p = m.stage.actor.holder.getWorldPosition(new cam.position.constructor()); p.y += 0.3 * m.scale;
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  p.project(cam);
  const box = document.querySelector('canvas.cbx-xr').getBoundingClientRect();
  const bear = v.z < 0 ? [Math.round((p.x + 1) / 2 * box.width), Math.round((1 - p.y) / 2 * box.height)] : null;
  return { state: m.state, placed: m.placed, ...m.placeDiag, inside: hs.inside, open: +hs.open.toFixed(2), openT: hs.openTarget, autoOpens: m.walk.doorAutoOpens, bearIn: m.walk.bearIn, busy: m.walk.busy, step: !!document.querySelector('[data-cmd=step-inside]') && !!document.querySelector('[data-cmd=step-inside]').offsetParent, hint, bear, programs: eng.xr.renderer.info.programs.length };
});
/** Where the reticle sits on screen vs the top of the Place pill and other bottom controls. */
const reticleVsControls = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('ar'), cam = window.__cb.internals().engine.xr.camera;
  const r = m.reticle; const p = r.getWorldPosition(new cam.position.constructor());
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  p.project(cam);
  const box = document.querySelector('canvas.cbx-xr').getBoundingClientRect();
  const pill = document.querySelector('.cbx-slot-centre .cbx-pill');
  let top = 1e9;
  for (const b of document.querySelectorAll('.cbx-bottom button, .cbx-above button')) { const q = b.getBoundingClientRect(); if (q.height && b.offsetParent && q.left < box.width * 0.7 && q.right > box.width * 0.3) top = Math.min(top, q.top); }
  return { visible: r.visible, reticleY: Math.round((1 - p.y) / 2 * box.height), reticleX: Math.round((p.x + 1) / 2 * box.width), pillTop: pill ? Math.round(pill.getBoundingClientRect().top) : null, controlsTop: Math.round(top), floorY: m.placeDiag.floorY };
});
async function waitPlace(page) {
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => { const d = window.__cb.debug(); const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return { settled: d.settled, pill: !!b && !b.disabled && /Place/.test(b.textContent), text: b && b.textContent }; });
    if (s.settled && s.pill) return;
    if (i % 6 === 5) log('waiting for Place', JSON.stringify(s), JSON.stringify(await st(page)));
    await sleep(5000);
  }
  throw new Error('never ready to place');
}
/** Drive her (the real joystick vector) towards a door-local point until near it or `ms` passes. */
async function driveTo(page, lx, lz, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await page.evaluate(([lx, lz]) => {
      const m = window.__cb.internals().modes.get('ar'), hs = m.stage.houseSet, a = m.stage.actor, cam = window.__cb.internals().engine.xr.camera;
      const V = cam.position.constructor;
      const at = hs.fromStage(a.position.clone());
      const goal = hs.toStage(new V(lx, 0, lz));
      const dirStage = goal.clone().sub(a.position).setY(0);
      const dist = Math.hypot(at.x - lx, at.z - lz);
      const vec = window.__cb.internals().hud?.stickVector ?? m.stick?.vector;
      if (dist < 0.15) { vec.set(0, 0); return { dist, at: [at.x, at.z] }; }
      // stage-local -> world, then into the stick's camera-relative axes
      const w = dirStage.normalize().applyAxisAngle(new V(0, 1, 0), m.anchor.rotation.y);
      const f = new V(); cam.getWorldDirection(f); f.setY(0).normalize();
      const right = new V(-f.z, 0, f.x);
      vec.set(w.dot(right) * 0.8, -w.dot(f) * 0.8);
      return { dist: +dist.toFixed(2), at: [+at.x.toFixed(2), +at.z.toFixed(2)] };
    }, [lx, lz]);
    if (d.dist < 0.15) return d;
    await sleep(120);
  }
  await page.evaluate(() => { const m = window.__cb.internals().modes.get('ar'); (window.__cb.internals().hud?.stickVector ?? m.stick?.vector).set(0, 0); });
  return null;
}
(async () => {
  const { browser, page, logs } = await launch({ phone: W < 900, w: W, h: H, cams: { user: S + '/../capture2/face.webm', environment: S + '/../capture2/floor.webm' } });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(4000);
  for (let i = 0; ; i++) {
    await click(page, '.cbx-switch [data-mode=ar]');
    const ok = await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered; }, null, 30000).then(() => true).catch(() => false);
    if (ok) break;
    if (i > 8) throw new Error('AR never entered');
  }
  await sleep(1500);
  log('placing', JSON.stringify(await st(page)), JSON.stringify(await reticleVsControls(page)));
  await shot(page, '01-placing-early');
  await waitPlace(page);
  await sleep(800);
  log('ready', JSON.stringify(await st(page)), 'reticle', JSON.stringify(await reticleVsControls(page)));
  await shot(page, '02-reticle');
  // tilt hint: look up at the horizon (test camera), the reticle must stay above the controls
  await pose(page, { x: 0, y: 1.4, z: 4.5, yaw: 0, pitch: 0.15 });
  await sleep(1200);
  log('looking up', JSON.stringify(await st(page)), 'reticle', JSON.stringify(await reticleVsControls(page)));
  await shot(page, '03-tilt-hint');
  await pose(page, null);
  await sleep(1500);
  await waitPlace(page);
  const p0 = (await st(page)).programs;
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(4000);
  await shot(page, '04-placed');
  log('placed', JSON.stringify(await st(page)));
  // lost: look away (test camera facing away from her)
  await pose(page, { x: 0, y: 1.4, z: 4.5, yaw: Math.PI, pitch: -0.1 });
  await sleep(11000);
  log('looking away', JSON.stringify(await st(page)));
  await shot(page, '05-lost-hint');
  await pose(page, null);
  await sleep(500);
  // walk her off to the side, then Move: she must come home into view
  await driveTo(page, 2.2, 2.6, 8000);
  await sleep(500);
  log('walked off', JSON.stringify(await st(page)));
  await click(page, '.cbx-slot-left .cbx-tool:first-child'); // Move
  await sleep(2500);
  await shot(page, '06-move');
  log('after Move', JSON.stringify(await st(page)), 'reticle', JSON.stringify(await reticleVsControls(page)));
  await waitPlace(page);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(4000);
  log('re-placed', JSON.stringify(await st(page)));
  // door: shut it, walk her away, then up to it: it must open by itself
  await driveTo(page, 0.9, 2.2, 8000);
  await page.evaluate(() => window.__cb.internals().modes.get('ar').stage.houseSet.setOpen(false, true));
  await sleep(800);
  const a0 = (await st(page)).autoOpens;
  log('door shut, she is away', JSON.stringify(await st(page)));
  await shot(page, '07-door-shut');
  await driveTo(page, 0, 0.6, 12000);
  await sleep(600);
  await shot(page, '08-door-opening');
  await sleep(1500);
  const s8 = await st(page);
  log('walked up', JSON.stringify(s8), 'auto-opens', a0, '->', s8.autoOpens);
  await shot(page, '09-door-open');
  // Step inside, Leave, then Step inside must be back with the hint
  await page.evaluate(() => window.__cb.internals().modes.get('ar').enterHouse());
  await waitFor(page, () => window.__cb.debug().ar.inside, null, T);
  await waitFor(page, () => !window.__cb.internals().modes.get('ar').walk.busy, null, T);
  await sleep(1500);
  await shot(page, '10-inside');
  log('inside', JSON.stringify(await st(page)));
  await click(page, '.cbx-slot-left .cbx-tool:last-child'); // Leave
  await waitFor(page, () => !window.__cb.debug().ar.inside && !window.__cb.internals().modes.get('ar').walk.busy, null, 180000);
  await sleep(1200);
  await shot(page, '11-left');
  log('left', JSON.stringify(await st(page)));
  await sleep(4000);
  log('left +4s', JSON.stringify(await st(page)));
  const has = (await st(page)).step;
  if (has) await click(page, '[data-cmd=step-inside]');
  await waitFor(page, () => window.__cb.debug().ar.inside, null, 60000).catch(() => log('Step inside did not go in'));
  log('stepped in again', JSON.stringify(await st(page)));
  await waitFor(page, () => !window.__cb.internals().modes.get('ar').walk.busy, null, T);
  await click(page, '.cbx-slot-left .cbx-tool:last-child');
  await waitFor(page, () => !window.__cb.debug().ar.inside && !window.__cb.internals().modes.get('ar').walk.busy, null, 180000);
  await sleep(2000);
  log('out again', JSON.stringify(await st(page)), 'programs at place', p0);
  await click(page, '.cbx-switch [data-mode=showcase]');
  await sleep(3000);
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
