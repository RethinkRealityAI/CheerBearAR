// Frame-time + shader-program log for the showcase: idle, then each interaction (wow-2). Usage:
//   BASE=http://localhost:5194 node perf.cjs [label]
// Prints mean/95th-percentile frame time (ms, from rAF in the page) and renderer.info.programs.length per phase.
const { launch, sleep, waitFor, errorsOf, BASE } = require('../../xr-core/sim/lib.cjs');
(async () => {
  const label = process.argv[2] || 'run';
  const { browser, page, logs } = await launch({ phone: true });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 240000);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  await sleep(3000);
  await page.evaluate(() => {
    window.__ft = []; let last = performance.now();
    const f = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
  });
  const phase = async (name, fn, ms) => {
    await page.evaluate(() => { window.__ft.length = 0; });
    if (fn) await fn();
    await sleep(ms);
    const r = await page.evaluate(() => {
      const a = window.__ft.slice(1).sort((x, y) => x - y);
      const mean = a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      return { n: a.length, mean: +mean.toFixed(1), p95: +(a[Math.floor(a.length * 0.95)] || 0).toFixed(1), progs: window.__cb.debug().showcasePrograms };
    });
    console.log(label, name.padEnd(12), JSON.stringify(r));
  };
  const trig = (n) => () => page.evaluate((n) => window.__cb.trigger(n), n);
  const idle = () => waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  await phase('idle', null, 6000);
  for (const a of ['Party', 'Rainbow', 'Cold', 'Stare']) { await idle(); await phase(a, trig(a), 6000); }
  // load average while measuring (swiftshader frame times depend on what else runs on the machine)
  console.log(label, 'loadavg', require('os').loadavg().map((x) => x.toFixed(1)).join(' '));
  const extra = await page.evaluate(() => typeof window.__cb.internals().stages.showcase.play !== 'undefined');
  if (extra) {
    await idle();
    await phase('toss x8', async () => {
      for (let i = 0; i < 8; i++) { await page.evaluate((p) => window.__cb.internals().showcase.throwHeart(p, 0), 0.5 + (i % 3) * 0.12); await sleep(350); }
    }, 5000);
  }
  // CPU cost of the toys per frame with every pool full (14 hearts, 36 stars, 9 balloons), timed in the page
  const bench = await page.evaluate(() => {
    const I = window.__cb.internals(); const st = I.stages.showcase; const play = st.play;
    if (!play) return null;
    const THREE = window.THREE; const o = new THREE.Vector3(0, 1.2, 3), v = new THREE.Vector3(0, 2.5, -3.5);
    for (let i = 0; i < 14; i++) play.throwHeart(o.set((i % 5) * 0.2 - 0.4, 1.2, 3), v);
    play.starBurst(new THREE.Vector3(0, 0.3, 1), 36, 1.6);
    play.balloonsAround(new THREE.Vector3(0, 0, 0), 9, 1.4);
    const n = 300, t0 = performance.now();
    for (let i = 0; i < n; i++) play.update(1 / 60);
    const ms = (performance.now() - t0) / n;
    play.clear();
    return { msPerFrame: +ms.toFixed(3), bodies: 59 };
  });
  console.log(label, 'toys-cpu', JSON.stringify(bench), 'progs', await page.evaluate(() => window.__cb.debug().showcasePrograms));
  console.log(label, 'errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
