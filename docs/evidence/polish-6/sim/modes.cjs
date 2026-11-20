// polish-6: the real app (route /) in all four modes: top bar, no talk button / Actions in Selfie and Photo (back in
// 3D / AR), Selfie frame / filter toggle, her bubble above the Selfie stack, AR capture tile idle / recording / after
// Move.  BASE=… OUT=… VIDEO=floor.y4m W=390 H=844 PHONE=1 TAG=x node modes.cjs
const path = require('path');
const lib = require('../../ui-2/sim/mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT, W = +process.env.W || 390, H = +process.env.H || 844, phone = process.env.PHONE !== '0';
const tag = (process.env.TAG || 'p6') + `-${W}x${H}`;
const T = 300000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `${tag}-${n}.jpg`), type: 'jpeg', quality: 70, timeout: 120000 });
const closeDialogs = (page) => page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const c = window.__cbApp; if (c && c.store.get().overlay) c.closeOverlay?.(); });
const ui = (page) => page.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return !!r.width && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
  const r = (s) => { const e = document.querySelector(s); if (!e || !vis(s)) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
  return { mode: window.__cbx.mode, orb: vis('.cb-orb'), act1: !!document.querySelector('.cbx-act1'), dock: vis('.cbx-dock'), lockup: r('.cbx-lockup'), menu: r('.cbx-top .cbx-menu'), tabs: r('.cbx-top .cbx-switch'), hint: r('.ml-hint.on'), bubble: r('.cbx-bubble.on'), look: r('.cbc-look'), toggle: r('.cbc-styletog'), shot: r('.cbx-dock .is-shot'), stick: r('.cbx-stick'), move: r('[data-cmd=move]') };
});
const go = async (page, m) => {
  await page.evaluate((m) => document.querySelector(`.cbx-switch [data-mode=${m}]`).click(), m);
  await waitFor(page, (m) => window.__cbx.mode === m && !document.querySelector('.cbx-switch.busy'), m, T);
  await sleep(2500);
  await closeDialogs(page);
};
(async () => {
  const { browser, page, logs } = await launch({ phone, w: W, h: H, video: process.env.VIDEO });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice`, { waitUntil: 'load' });
  await lib.start(page);
  await sleep(3000);
  await closeDialogs(page);
  await page.evaluate(() => window.__cbApp.closeSheet?.());
  await sleep(1500);
  log('3D', JSON.stringify(await ui(page)));
  await go(page, 'face');
  await shot(page, '01-selfie');
  log('Selfie', JSON.stringify(await ui(page)));
  await page.evaluate(() => document.querySelector('.cbc-styletog [data-group=frame]').click());
  await sleep(700);
  await shot(page, '02-selfie-frames');
  await page.evaluate(() => window.__cbx.internals.modes.get('face').ctx.hud.speech('Say cheese! I love your smile, friend!'));
  await sleep(1300);
  await shot(page, '03-selfie-bubble');
  log('Selfie frames open + bubble', JSON.stringify(await ui(page)));
  await page.evaluate(() => window.__cbx.internals.modes.get('face').ctx.hud.speech(null));
  await go(page, 'photo');
  await page.evaluate(() => document.querySelector('.cbx-sheet .btn')?.click()); // Let's go
  await sleep(1500);
  await shot(page, '04-photo');
  log('Photo', JSON.stringify(await ui(page)));
  await go(page, 'showcase');
  await sleep(1000);
  await shot(page, '05-3d-back');
  log('3D again', JSON.stringify(await ui(page)));
  if (process.env.NOAR) { console.log('ERRORS:\n' + errorsOf(logs).join('\n')); await browser.close(); return; }
  await go(page, 'ar');
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled && /Place/.test(b.textContent); })) break; await sleep(4000); }
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cbx.internals.modes.get('ar').state === 'placed', null, T);
  await sleep(5000);
  await closeDialogs(page);
  await shot(page, '06-ar-placed');
  log('AR placed', JSON.stringify(await ui(page)));
  const b = await (await page.$('.cbx-dock .is-shot')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await sleep(3200);
  await shot(page, '07-ar-recording');
  log('AR recording', JSON.stringify(await page.evaluate(() => { const s = document.querySelector('.cbx-dock .is-shot'); return { cls: s.className, time: s.querySelector('.cbx-rec-time').textContent, p: s.style.getPropertyValue('--rec-p'), bg: getComputedStyle(s).backgroundColor }; })));
  await page.mouse.up();
  await waitFor(page, () => !!document.querySelector('.cbc-review video'), null, 30000);
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('.cbc-review button')].find((b) => b.textContent.trim() === 'Retake').click());
  await sleep(1000);
  await page.evaluate(() => document.querySelector('[data-cmd=move]').click());
  await sleep(2500);
  await shot(page, '08-ar-after-move');
  log('AR after Move', JSON.stringify(await ui(page)), 'scale', await page.evaluate(() => window.__cbx.internals.modes.get('ar').pinchScale));
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
