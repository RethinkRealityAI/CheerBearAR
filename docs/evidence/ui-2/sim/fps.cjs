const path = require('path');
const lib = require('./mylib.cjs');
(async () => {
  const { browser, ctx, page, logs } = await lib.launch({ phone: true });
  if (process.env.RM) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice=fast`, { waitUntil: 'load' });
  await lib.start(page);
  await lib.sleep(3000);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.__cbApp.closeSheet(); });
  const measure = async () => { await lib.sleep(6000); const a = []; for (let i = 0; i < 5; i++) { a.push(await page.evaluate(() => window.__cbx.debug().fps)); await lib.sleep(1000); } return a; };
  console.log('fps with HUD + app layer', JSON.stringify(await measure()), 'programs', await page.evaluate(() => window.__cbx.debug().showcasePrograms));
  await page.evaluate(() => { document.querySelector('.cbx-hud').style.display = 'none'; document.querySelector('.cb-layer').style.display = 'none'; });
  console.log('fps with HUD + app layer hidden', JSON.stringify(await measure()));
  await page.evaluate(() => { document.querySelector('.cbx-hud').style.display = ''; document.querySelector('.cb-layer').style.display = ''; });
  if (process.env.RM) {
    const o = process.env.OUT;
    await page.evaluate(() => { window.__cbx.hud.hint('Tap Cheer Bear to play'); window.__cbApp.showToast('found', 'You found “Sparkle”!', 8000); window.__cbx.setSpeechText('Hi friend! Do you want to see my house?'); });
    await lib.sleep(1500);
    await page.screenshot({ path: path.join(o, '390x844-40-reduced-motion.jpg'), type: 'jpeg', quality: 70 });
    await page.evaluate(() => window.__cbx.setSpeechText(null));
    await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
    await lib.sleep(1500);
    await page.screenshot({ path: path.join(o, '390x844-41-reduced-motion-switch.jpg'), type: 'jpeg', quality: 70 });
  }
  console.log('errors', lib.errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
