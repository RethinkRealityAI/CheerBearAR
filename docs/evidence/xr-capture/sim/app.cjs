// The real app at / (React shell + talk orb) with the real experience: Selfie -> photo -> review. Checks what is on top
// at the talk orb's centre while the review sheet is open, and that no review control sits under the orb.
//   node app.cjs face.y4m
const { launch, shot, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');

const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const { browser, page, logs } = await launch({ phone: true, video: process.argv[2] });
  await page.goto(`${BASE}/?test&desktop&mockVoice=fast,silent`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.evaluate(() => document.querySelector('.cbx-start').click());
  await waitFor(page, () => window.__cbx && window.__cbx.started, null, T);
  await sleep(2500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await waitFor(page, () => window.__cbx.internals.modes.get('face')?.constructor?.name === 'FaceMode', null, T);
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=face]').click());
  await waitFor(page, () => window.__cbx.mode === 'face' && window.__cbx.internals.modes.get('face').state !== 'off', null, T);
  await sleep(1500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await shot(page, 'app-01-selfie-intro');
  await page.evaluate(() => window.__cbx.internals.modes.get('face').skipIntro());
  await waitFor(page, () => window.__cbx.internals.modes.get('face').faceFound, null, 120000);
  await sleep(2000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await shot(page, 'app-02-selfie-live');
  const live = await page.evaluate(() => {
    const s = document.querySelector('.cbx-slot-centre .cbx-shutter').getBoundingClientRect();
    const o = document.querySelector('.cb-orb')?.getBoundingClientRect();
    return { shutter: [Math.round(s.left), Math.round(s.top), Math.round(s.right), Math.round(s.bottom)], orb: o && [Math.round(o.left), Math.round(o.top), Math.round(o.right), Math.round(o.bottom)] };
  });
  log('live: shutter vs orb', JSON.stringify(live));
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-shutter').click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-shutter').click());
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(900);
  await shot(page, 'app-03-selfie-review');
  const r = await page.evaluate(() => {
    const o = document.querySelector('.cb-orb');
    const ob = o?.getBoundingClientRect();
    const top = ob ? document.elementFromPoint(ob.left + ob.width / 2, ob.top + ob.height / 2) : null;
    const under = ob ? [...document.querySelectorAll('.cbc-review button')].filter((b) => {
      const q = b.getBoundingClientRect();
      return q.right > ob.left && q.left < ob.right && q.bottom > ob.top && q.top < ob.bottom;
    }).map((b) => b.textContent.trim()) : [];
    return { orb: ob && [Math.round(ob.left), Math.round(ob.top)], onTopAtOrb: top ? (top.className || top.tagName) : null, reviewButtonsUnderOrb: under };
  });
  log('review vs orb', JSON.stringify(r));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
