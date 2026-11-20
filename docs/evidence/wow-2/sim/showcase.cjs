// wow-2 showcase run (390x844): heart toss (flicks), poke, hug, Care Bear Stare, Party balloons + pop, Rainbow stars,
// Cold snow landing, Magic; shader program count after every step; console errors.
//   BASE=http://localhost:5194 OUT=... node showcase.cjs [reduced]
const { launch, shot, sleep, waitFor, errorsOf, BASE, flick, press, project } = require('./lib.cjs');
const SEL = '.cbx-3d';
(async () => {
  const reduced = process.argv[2] === 'reduced';
  const tag = reduced ? 'rm-3d' : '3d';
  const { browser, page, logs } = await launch({ phone: true });
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 240000);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  const progs = () => page.evaluate(() => window.__cb.debug().showcasePrograms);
  const stats = () => page.evaluate(() => { const I = window.__cb.internals(); const t = I.showcase.toss; return { thrown: t.thrown, caught: t.caught, combo: t.combo, best: t.best, toys: I.stages.showcase.play.liveCount, progs: window.__cb.debug().showcasePrograms }; });
  const hint = () => page.evaluate(() => document.querySelector('.ml-hint, .cbx-hint')?.textContent || '');
  const idle = () => waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  const log = (...a) => console.log(tag, ...a);
  log('warm programs', await progs());
  await waitFor(page, () => /throw/i.test(document.querySelector('.ml-hint, .cbx-hint')?.textContent || ''), null, 60000).catch(() => null);
  log('hint:', await hint());
  await shot(page, `${tag}-01-hint`);
  await idle();
  // ---- heart toss: a good flick, then a few more
  for (let i = 0; i < 5; i++) {
    await flick(page, SEL, { len: 150 + (i % 3) * 25, dx: (i % 2 ? 1 : -1) * 12 });
    await sleep(i === 0 ? 350 : 250);
    if (i < 2) await shot(page, `${tag}-02-toss-${i}`);
    await sleep(900);
  }
  await sleep(600);
  await shot(page, `${tag}-03-after-catches`);
  log('after 5 flicks', JSON.stringify(await stats()));
  // a short one (miss): it bounces and rolls on the cloud
  // a weak throw (too short): it lands in front of her, bounces and rolls (the flick path is covered above)
  await page.evaluate(() => window.__cb.internals().showcase.throwHeart(0.12, 0.1));
  await sleep(700);
  await shot(page, `${tag}-04-miss-bounce`);
  await sleep(700);
  await shot(page, `${tag}-04b-miss-rest`);
  log('after miss', JSON.stringify(await stats()));
  // ---- poke + hug
  await idle();
  const bp = await page.evaluate(() => window.__cb.internals().stages.showcase.actor.position.toArray());
  const bear = await project(page, 'showcase', [bp[0], 0.55, bp[2]]);
  await press(page, SEL, bear.x, bear.y, 60);
  await sleep(150);
  await shot(page, `${tag}-05-poke`);
  await idle();
  await sleep(500);
  await press(page, SEL, bear.x, bear.y, 900);
  await sleep(200);
  await shot(page, `${tag}-06-hug`);
  log('poke/hug programs', await progs());
  // ---- Care Bear Stare
  await idle();
  log('Stare ->', await page.evaluate(() => window.__cb.trigger('care bear stare')));
  await sleep(1300); await shot(page, `${tag}-07-stare-fire`);
  await sleep(1300); await shot(page, `${tag}-07b-stare-beam`);
  await sleep(1900); await shot(page, `${tag}-07c-stare-stars`);
  log('stare programs', await progs());
  // ---- Party balloons + pop
  await idle();
  log('Party ->', await page.evaluate(() => window.__cb.trigger('Party')));
  await sleep(3500);
  await shot(page, `${tag}-08-party-balloons`);
  const b = await page.evaluate(() => { const bs = window.__cb.internals().stages.showcase.play.pool('balloon').filter((x) => x.alive); return bs.length ? [bs[0].p.x, bs[0].p.y, bs[0].p.z, bs.length] : null; });
  if (b) {
    const s = await project(page, 'showcase', b);
    await press(page, SEL, s.x, s.y, 60);
    await sleep(120);
    await shot(page, `${tag}-08b-party-pop`);
    const left = await page.evaluate(() => window.__cb.internals().stages.showcase.play.count('balloon'));
    log('balloons', b[3], '-> after pop', left);
  }
  await idle();
  // ---- Rainbow stars, Cold snow, Magic
  log('Rainbow ->', await page.evaluate(() => window.__cb.trigger('Rainbow')));
  await sleep(2400); await shot(page, `${tag}-09-rainbow-stars`);
  await idle();
  log('Cold ->', await page.evaluate(() => window.__cb.trigger('Cold')));
  await sleep(5200); await shot(page, `${tag}-10-cold-snow`);
  await idle();
  log('Magic ->', await page.evaluate(() => window.__cb.trigger('Magic')));
  await sleep(7300); await shot(page, `${tag}-11-magic-burst`);
  await idle();
  log('final', JSON.stringify(await stats()));
  log('actions', JSON.stringify(await page.evaluate(() => window.__cb.actions)));
  log('events', JSON.stringify((await page.evaluate(() => window.__cb.events)).filter((e) => e.event === 'action').map((e) => e.payload)));
  log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
