// ui-2 tour of the real app: splash, welcome, main, switcher crop, hint + toast, sheet, call speaking, modes.
//   BASE=http://localhost:5193 OUT=dir W=390 H=844 PHONE=1 VIDEO=floor.y4m MODES=1 node tour.cjs
const path = require('path');
const lib = require('./mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT;
const W = +process.env.W || 390, H = +process.env.H || 844;
const phone = process.env.PHONE !== '0';
const tag = process.env.TAG || `${W}x${H}`;
const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name, opt = {}) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 72, timeout: 120000, ...opt });

(async () => {
  const { browser, page, logs } = await launch({ phone, w: W, h: H, video: process.env.VIDEO });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice=fast,silent`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 300000);
  await sleep(800);
  await shot(page, '01-splash');
  await lib.start(page);
  await sleep(3500);
  await shot(page, '02-welcome');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.evaluate(() => window.__cbApp.closeSheet?.());
  await sleep(1200);
  await shot(page, '03-main');
  const top = await page.$('.cbx-top');
  if (top) await top.screenshot({ path: path.join(OUT, `${tag}-04-switcher.jpg`), type: 'jpeg', quality: 85 });
  // hint + toast together
  await page.evaluate(() => { window.__cbx.hud.hint('Tap Cheer Bear to play'); window.__cbApp.showToast('found', 'You found “Sparkle”!', 8000); });
  await sleep(700);
  await shot(page, '05-hint-toast');
  await page.evaluate(() => { window.__cbApp.showToast('info', 'Connected! Say hi to Cheer Bear.', 8000); });
  await sleep(700);
  await shot(page, '05b-hint-toast-info');
  await page.evaluate(() => window.__cbx.hud.hint(''));
  // speech bubble
  await page.evaluate(() => window.__cbx.setSpeechText('Hi friend! Do you want to see my house? Say house and I will show you!'));
  await sleep(2500);
  await shot(page, '06-speech');
  await page.evaluate(() => window.__cbx.setSpeechText(null));
  // sheet + call
  await page.evaluate(() => window.__cbApp.openSheet('talk'));
  await sleep(900);
  await shot(page, '07-sheet');
  await page.evaluate(() => { window.__cbApp.setUiMode?.('chat'); });
  await page.evaluate(() => { const c = window.__cbApp; c.requestCall(); if (c.store.get().micAsk) c.confirmMic(); });
  await waitFor(page, () => window.__cbApp.store.get().call === 'in-call', null, 30000).catch(() => log('no in-call'));
  await sleep(4000);
  await shot(page, '08-sheet-call');
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(1500);
  await shot(page, '09-call-orb');
  // focus ring on the switcher via keyboard
  await page.evaluate(() => document.querySelector('.cbx-switch button, .cbx-switch [role=tab]')?.focus());
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await sleep(300);
  if (top) await top.screenshot({ path: path.join(OUT, `${tag}-10-switcher-focus.jpg`), type: 'jpeg', quality: 85 });
  if (process.env.MODES) {
    for (const m of ['ar', 'face', 'photo', 'showcase', 'ar', 'showcase']) {
      await page.evaluate((m) => document.querySelector(`.cbx-switch [data-mode=${m}]`).click(), m);
      await sleep(250);
      await shot(page, `11-switching-${m}`);
      await waitFor(page, (m) => window.__cbx.mode === m && !document.querySelector('.cbx-switch.busy'), m, T).catch(() => log('stuck', m));
      await sleep(1500);
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
      await shot(page, `12-mode-${m}`);
    }
  }
  const errs = errorsOf(logs);
  log(tag, 'errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
