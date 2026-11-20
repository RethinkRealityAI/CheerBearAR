// chrome-5 extras at one size: her speech bubble beside the Actions + Games pair, the Hoops game (pair hidden),
// the cover mid-switch (test-only slower iris), and the same with reduced motion (RM=1: crossfade).
//   BASE=… OUT=… VIDEO=floor.y4m [W=390 H=844] [RM=1] node extra.cjs
const path = require('path');
const lib = require('../../ui-2/sim/mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT;
const W = +process.env.W || 390, H = +process.env.H || 844;
const tag = (process.env.TAG ? process.env.TAG + '-' : '') + `${W}x${H}` + (process.env.RM ? '-rm' : '');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 70, timeout: 120000 });
(async () => {
  const { browser, page, logs } = await launch({ phone: true, w: W, h: H, video: process.env.VIDEO });
  if (process.env.RM) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 300000);
  await sleep(1200);
  await shot(page, 'x01-splash');
  await lib.start(page);
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const c = window.__cbApp; c.closeOverlay?.(); c.closeSheet(); c.updatePrefs({ voiceNudgeDone: true }); c.store.set({ voiceBubble: null }); });
  await sleep(1500);
  const p0 = await page.evaluate(() => window.__cbx.debug().showcasePrograms);
  await page.evaluate(() => window.__cbx.setSpeechText('Hi friend! Do you want to see my house? Say house and I will show you something magic!'));
  await sleep(2500);
  await shot(page, 'x02-speech-with-dock');
  const ov = await page.evaluate(() => {
    const b = document.querySelector('.cbx-bubble').getBoundingClientRect();
    return [...document.querySelectorAll('.cbx-dock .cbx-tool, .cb-orb, .cbx-stick')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && getComputedStyle(n).visibility !== 'hidden' && r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom; }).map((n) => n.getAttribute('aria-label'));
  });
  log('speech bubble overlaps', ov.length ? ov.join('; ') : 'none');
  await page.evaluate(() => window.__cbx.setSpeechText(null));
  await page.evaluate(() => window.__cbx.startPlay('heart-run'));
  await sleep(4500);
  await shot(page, 'x03-heart-run');
  log('dock hidden in game', await page.evaluate(() => document.querySelector('.cbx-dock').hidden));
  await page.evaluate(() => window.__cbx.internals.play.stop());
  await sleep(1500);
  await page.addStyleTag({ content: '.cbx-cover.on .cbx-cover-disc{transition-duration:1.2s!important}' }); // test only
  for (const m of ['ar', 'face', 'photo', 'showcase']) {
    await page.evaluate((m) => document.querySelector(`.cbx-switch [data-mode=${m}]`).click(), m);
    await sleep(120);
    await shot(page, `x04-cover-${m}-a`);
    await sleep(300);
    await shot(page, `x04-cover-${m}-b`);
    await waitFor(page, (m) => window.__cbx.mode === m && !document.querySelector('.cbx-switch.busy'), m, 240000).catch(() => log('stuck', m));
    await sleep(2500);
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.querySelectorAll('.cbx-sheet-wrap .row .btn').forEach((b) => b.click()); });
    await sleep(600);
    await shot(page, `x05-mode-${m}`);
  }
  const p1 = await page.evaluate(() => window.__cbx.debug().showcasePrograms);
  log('showcase programs', p0, '->', p1);
  const errs = errorsOf(logs);
  log(tag, 'errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
