// ar-4 frame-budget probe (AR, fake floor camera + fake IMU): what the engine draws, compiles and uploads, and how
// long frames take, for: placing, placed (default camera), outside in the garden, looking through the door, a
// continuous walk in through the door, inside, turning round inside, and the walk back out. Also the engine start
// order (when compiles / uploads happen relative to tracking settling) and the house's mesh / material inventory.
// usage: node probe.cjs <floor.y4m> [label]     (BASE=http://localhost:5211, OUT=dir for shots)
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 300000;
const label = process.argv[3] || 'run';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const pose = (page, p) => page.evaluate((p) => { window.__cb.internals().modes.get('ar').walk.testPose = p; }, p);
const tag = (page, t) => page.evaluate((t) => window.__m.tag(t), t);
const summary = (page, t) => page.evaluate((t) => window.__m.summary(t), t);
const framesIn = (page, t, n) => waitFor(page, ([t, n]) => window.__m.S.frames.filter((f) => f.tag === t).length >= n, [t, n], T);

(async () => {
  const video = process.argv[2];
  const { browser, page, logs } = await launch({ phone: true, video });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(4000);
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'instr.js'), 'utf8') });
  await tag(page, 'start');
  for (let i = 0; ; i++) {
    await click(page, '.cbx-switch [data-mode=ar]');
    const ok = await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered; }, null, 30000).then(() => true).catch(() => false);
    if (ok) break;
    if (i > 8) throw new Error('AR never entered');
  }
  await tag(page, 'placing');
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return !!b && !b.disabled; });
    if (s) break;
    if (i === 59) throw new Error('never settled');
    await sleep(5000);
  }
  await sleep(3000);
  const inv = await page.evaluate(() => {
    const st = window.__cb.internals().stages.ar, hs = st.houseSet;
    const count = (root) => {
      let meshes = 0, tris = 0; const mats = new Set(), progs = new Set();
      root.traverse((o) => {
        if (!o.isMesh && !o.isPoints) return;
        meshes++;
        const g = o.geometry; const n = g.index ? g.index.count : g.attributes.position.count;
        tris += (o.isInstancedMesh ? o.count : 1) * n / 3;
        for (const m of [].concat(o.material)) { mats.add(m); progs.add(m.type + ':' + (m.customProgramCacheKey?.() ?? '') + (m.map ? ':map' : '') + (m.vertexColors ? ':vc' : '') + (m.transparent ? ':t' : '')); }
      });
      return { meshes, tris: Math.round(tris), materials: mats.size, materialKinds: progs.size };
    };
    return { house: count(hs.root), room: count(hs.room.group), exterior: count(hs.exterior), stage: count(st.root) };
  });
  log('inventory', JSON.stringify(inv));
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  // the door opens a beat after Place (after ar-4: once tracking is calm, at most ~10 s of experience time)
  await waitFor(page, () => window.__cb.internals().stages.ar.houseSet.open > 0.95, null, T);
  await tag(page, 'placed');
  await framesIn(page, 'placed', 12);
  await shot(page, `${label}-placed`);
  const phases = [
    ['outside', { x: 0.35, y: 1.45, z: 4.2, yaw: 0.08, pitch: -0.08 }],
    ['door', { x: 0.1, y: 1.4, z: 1.5, yaw: 0, pitch: -0.12 }],
  ];
  for (const [t, p] of phases) {
    await pose(page, p);
    await tag(page, 'x');
    await sleep(800);
    await tag(page, t);
    await framesIn(page, t, 10);
    await shot(page, `${label}-${t}`);
  }
  // a continuous walk in through the door: 3.0 m outside -> 1.8 m inside, at about 0.5 m/s
  const walk = async (t, z0, z1, secs, yaw) => {
    await page.evaluate(([z0, z1, secs, yaw]) => {
      const t0 = performance.now();
      window.__m.walk((now) => {
        const u = Math.min(1, (now - t0) / (secs * 1000));
        return { x: 0.05 * Math.sin(u * 6), y: 1.42 + 0.02 * Math.sin(u * 20), z: z0 + (z1 - z0) * u, yaw: yaw + 0.05 * Math.sin(u * 5), pitch: -0.1 };
      });
    }, [z0, z1, secs, yaw]);
    await tag(page, t);
    await sleep(secs * 1000 + 500);
    await page.evaluate(() => window.__m.walk(null));
  };
  await walk('walk-in', 3.0, -1.8, 9, 0);
  log('after walk-in', JSON.stringify(await page.evaluate(() => ({ inside: window.__cb.debug().ar.inside, theme: window.__cb.debug().themeOn }))));
  await pose(page, { x: 0.2, y: 1.45, z: -1.6, yaw: 0, pitch: -0.08 });
  await tag(page, 'x');
  await sleep(600);
  await tag(page, 'inside');
  await framesIn(page, 'inside', 12);
  await shot(page, `${label}-inside`);
  // turn round inside (the whole room passes through the view)
  await page.evaluate(() => {
    const t0 = performance.now();
    window.__m.walk((now) => ({ x: 0, y: 1.45, z: -2.2, yaw: ((now - t0) / 8000) * Math.PI * 2, pitch: -0.1 }));
  });
  await tag(page, 'inside-turn');
  await sleep(8500);
  await page.evaluate(() => window.__m.walk(null));
  await walk('walk-out', -1.6, 3.0, 9, Math.PI);
  log('after walk-out', JSON.stringify(await page.evaluate(() => ({ inside: window.__cb.debug().ar.inside }))));
  await pose(page, null);
  const rows = [];
  for (const t of ['placing', 'placed', 'outside', 'door', 'walk-in', 'inside', 'inside-turn', 'walk-out']) rows.push(await summary(page, t));
  const ev = await page.evaluate(() => window.__m.events());
  const health = await page.evaluate(() => window.__cb.debug().engine);
  const out = { label, inventory: inv, rows, events: ev, stalls: health.stalls, track: health.trackLog, dpr: health.dprLog };
  fs.writeFileSync(path.join(process.env.OUT || path.join(__dirname, '..'), `probe-${label}.json`), JSON.stringify(out, null, 1));
  console.table(rows.map((r) => ({ ...r, uploads: JSON.stringify(r.uploads) })));
  log('compile/upload events', JSON.stringify(ev));
  const errs = errorsOf(logs).filter((l) => !/too many errors/.test(l));
  log('errors', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
