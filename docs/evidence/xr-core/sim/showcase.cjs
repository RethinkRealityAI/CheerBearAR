// Showcase run: splash, Start (no permission prompt), all eleven actions, program count stable, console clean.
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');

(async () => {
  const phone = process.argv[2] !== 'desktop';
  const tag = phone ? 'phone' : 'desktop';
  const { browser, page, logs } = await launch({ phone });
  let prompts = 0;
  page.on('dialog', () => prompts++);
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await sleep(1500);
  await shot(page, `${tag}-01-splash-loading`);
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 120000);
  await sleep(1500);
  await shot(page, `${tag}-02-splash-ready`);
  await page.click('.cbx-start');
  await sleep(300);
  await shot(page, `${tag}-03-starting`);
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  await sleep(3500);
  await shot(page, `${tag}-04-showcase`);
  const d0 = await page.evaluate(() => window.__cb.debug());
  console.log('after start', JSON.stringify({ mode: d0.mode, progs: d0.showcasePrograms, warm: d0.showcaseProgramsAfterWarm }));
  const acts = ['House', 'Sparkle', 'Running', 'WakeUp', 'Sleep', 'Dance', 'Wave', 'Magic', 'Cold', 'Party', 'Rainbow'];
  const results = {};
  const midShot = { House: 2.5, Sparkle: 1.0, Running: 1.5, WakeUp: 1.2, Sleep: 2.5, Dance: 2, Wave: 1, Magic: 2.6, Cold: 2.5, Party: 3.5, Rainbow: 2.5 };
  for (const a of acts) {
    // wait for the runner to be idle
    await waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
    const ok = await page.evaluate((n) => window.__cb.trigger(n.toLowerCase()), a);
    await sleep(midShot[a] * 1000);
    await shot(page, `${tag}-act-${a}`, 60);
    const d = await page.evaluate(() => window.__cb.debug());
    results[a] = { ok, moment: d.moment.showcase, progs: d.showcasePrograms };
  }
  await waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  await sleep(800);
  await shot(page, `${tag}-05-after-actions`);
  const d1 = await page.evaluate(() => window.__cb.debug());
  console.log(JSON.stringify(results));
  console.log('programs warm/final', d1.showcaseProgramsAfterWarm, d1.showcasePrograms, 'asleep', JSON.stringify(d1.asleep));
  // unknown action returns false; walking with keys
  console.log('unknown ->', await page.evaluate(() => window.__cb.trigger('banana')));
  const events = await page.evaluate(() => window.__cb.events);
  console.log('events', JSON.stringify(events.slice(0, 30)));
  console.log('dialogs', prompts);
  const errs = errorsOf(logs);
  console.log('errors', errs.length ? errs.join('\n') : 'none');
  console.log('warns', logs.filter((l) => l.startsWith('[warning]')).slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
