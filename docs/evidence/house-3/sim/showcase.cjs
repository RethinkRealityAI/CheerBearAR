// House-3 showcase run: trigger the House moment and shoot the exterior, the glide through the door, the TV, the
// jukebox party and the way out. Shots are taken by polling the house's state (the software GL is ~1 fps).
// usage: node showcase.cjs [desktop]
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const T = 600000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const phone = process.argv[2] !== 'desktop';
  const tag = phone ? 'phone' : 'desktop';
  const { browser, page, logs } = await launch(phone ? { phone } : { phone: false, w: 1440, h: 900 });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, T);
  await sleep(4000);
  const d0 = await page.evaluate(() => window.__cb.debug());
  log('showcase programs', d0.showcasePrograms, 'after warm', d0.showcaseProgramsAfterWarm);
  const hs = () => page.evaluate(() => { const h = window.__cb.internals().stages.showcase.houseSet; return { open: +h.open.toFixed(2), tour: +h.tour.k.toFixed(2), z: +h.cam.z.toFixed(2), inside: h.inside, party: h.party > 0 }; });
  await page.evaluate(() => window.__cb.trigger('house'));
  const at = async (name, fn, arg) => {
    await waitFor(page, fn, arg, T);
    await shot(page, `sc-${tag}-${name}`, 72);
    log(name, JSON.stringify(await hs()), 'programs', (await page.evaluate(() => window.__cb.debug())).showcasePrograms);
  };
  const H = 'window.__cb.internals().stages.showcase.houseSet';
  await at('01-exterior', new Function(`const h=${H}; return h.open > 0.95 && h.tour.k === 0;`));
  await at('02-glide-door', new Function(`const h=${H}; return h.tour.k > 0.9 && h.cam.z < 1.3;`));
  await at('03-inside-tv', new Function(`const h=${H}; return h.tour.k > 0.9 && h.cam.z < -1.4;`));
  await at('04-jukebox-party', new Function(`const h=${H}; return h.party > 7;`));
  await at('05-way-out', new Function(`const h=${H}; return h.tour.k > 0.5 && h.cam.z > 1.5;`));
  await waitFor(page, () => !window.__cb.debug().moment.showcase, null, T);
  await sleep(1500);
  await shot(page, `sc-${tag}-06-after`, 72);
  const d1 = await page.evaluate(() => window.__cb.debug());
  log('after; programs', d1.showcasePrograms, JSON.stringify(await hs()));
  const errs = errorsOf(logs).filter((l) => !/too many errors/.test(l));
  log('errors', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
