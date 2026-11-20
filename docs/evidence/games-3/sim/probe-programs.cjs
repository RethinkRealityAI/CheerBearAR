// games-3: which shader programs the play kit's materials use (BASE=http://localhost:5202 node probe-programs.cjs)
// Which shader programs do the play kit's materials use, and are any of them used by nothing else?
const { launch, sleep, waitFor, BASE } = require('./lib.cjs');
(async () => {
  const { browser, page } = await launch({ phone: true });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 400000);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, 400000);
  await sleep(3000);
  const r = await page.evaluate(() => {
    const I = window.__cb.internals();
    const mode = I.modes.get('showcase');
    const R = mode.renderer, stage = I.stages.showcase;
    const progOf = (m) => R.properties.get(m).currentProgram;
    const kitMats = new Set(), otherMats = new Set();
    const kitRoot = mode.kit.root || null;
    const inKit = new Set();
    // the kit's objects: everything reachable from the kit's own fields
    for (const v of Object.values(mode.kit)) {
      for (const x of Array.isArray(v) ? v : [v]) if (x && x.isObject3D) x.traverse((o) => inKit.add(o));
    }
    stage.root.traverse((o) => {
      if (!o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) (inKit.has(o) ? kitMats : otherMats).add(m);
    });
    const progs = R.info.programs;
    const out = [];
    for (const p of progs) {
      let kit = 0, other = 0;
      kitMats.forEach((m) => { if (progOf(m) === p) kit++; });
      otherMats.forEach((m) => { if (progOf(m) === p) other++; });
      out.push({ name: p.name, id: p.id, kit, other });
    }
    return { total: progs.length, kitMats: [...kitMats].map((m) => m.type + ':' + (m.name || '')), out };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
