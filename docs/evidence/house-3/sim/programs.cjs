// house-3: which shader programs her house uses in AR and in 3D, and which programs only the house uses
// (so the cost of the new house is measured, not guessed). usage: node programs.cjs <floor.y4m>
const { launch, sleep, waitFor, BASE } = require('./lib.cjs');
const T = 600000;
const tally = (which) => {
  const I = window.__cb.internals();
  const R = which === 'ar' ? I.engine.xr.renderer : I.modes.get('showcase').renderer;
  const st = I.stages[which === 'ar' ? 'ar' : 'showcase'];
  const progOf = (m) => R.properties.get(m).currentProgram;
  const house = new Set(), other = new Set(), inHouse = new Set();
  st.houseSet.root.traverse((o) => inHouse.add(o));
  const scene = st.root.parent || st.root;
  scene.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) (inHouse.has(o) ? house : other).add(m); });
  const out = [];
  for (const p of R.info.programs) {
    let h = 0, x = 0;
    house.forEach((m) => { if (progOf(m) === p) h++; });
    other.forEach((m) => { if (progOf(m) === p) x++; });
    out.push({ name: p.name, key: (p.cacheKey || '').includes('cb-house') ? (p.cacheKey.includes('cut') ? 'cut' : 'clip') : '', house: h, other: x });
  }
  return { total: out.length, houseOnly: out.filter((r) => r.house && !r.other).length, shared: out.filter((r) => r.house && r.other).length, unused: out.filter((r) => !r.house && !r.other).length, out };
};
(async () => {
  const { browser, page } = await launch({ phone: true, video: process.argv[2] });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cb.debug().entered, null, T);
  await sleep(8000);
  const sc = await page.evaluate(tally, 'showcase');
  console.log('showcase', JSON.stringify({ total: sc.total, houseOnly: sc.houseOnly, shared: sc.shared, unused: sc.unused }));
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
    if (await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'ar' && d.entered && d.settled; }, null, 30000).then(() => true).catch(() => false)) break;
  }
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cb.debug().ar.placed, null, T);
  await sleep(5000);
  const ar = await page.evaluate(tally, 'ar');
  console.log('ar', JSON.stringify({ total: ar.total, houseOnly: ar.houseOnly, shared: ar.shared, unused: ar.unused }));
  console.log(JSON.stringify(ar.out.filter((r) => r.house), null, 0));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
