const path = require('path');
const lib = require('./mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT; const log = (...a) => console.log(...a);
(async () => {
  const { browser, page, logs } = await launch({ phone: true });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice=fast`, { waitUntil: 'load' });
  await lib.start(page);
  await sleep(2500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.evaluate(() => window.__cbApp.closeSheet());
  // states: idle, connecting, ringing, live, speaking, error
  const dock = page.locator('.cb-orb-dock');
  const grab = async (n) => { const b = await page.$('.cb-orb'); const r = await b.boundingBox(); await page.screenshot({ path: path.join(OUT, `orb-${n}.jpg`), type: 'jpeg', quality: 85, clip: { x: r.x - 230, y: r.y - 170, width: 320, height: 260 } }); };
  await grab('1-idle');
  await page.evaluate(() => { const c = window.__cbApp; c.requestCall(); if (c.store.get().micAsk) c.confirmMic(); });
  await sleep(250); await grab('2-calling');
  await waitFor(page, () => window.__cbApp.store.get().call === 'ringing', null, 20000).catch(() => {});
  await sleep(200); await grab('3-ringing');
  await waitFor(page, () => window.__cbApp.store.get().call === 'in-call', null, 30000);
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(600);
  await page.evaluate(() => window.__cbApp.sendText('Can you tell me about rainbows and your house please?'));
  let got = 0;
  for (let i = 0; i < 80 && got < 2; i++) {
    await sleep(150);
    const st = await page.evaluate(() => { const o = document.querySelector('.cb-orb'); const w = o?.querySelector('.cb-orb-wave.is-2'); return { cls: o?.className, wave: w?.style.transform, op: w?.style.opacity, call: window.__cbApp.store.get().call }; });
    if (i % 10 === 0) log(JSON.stringify(st));
    if (/has-level/.test(st.cls) && parseFloat((st.wave || '').replace(/[^0-9.]/g, '')) > 1.2) { log('speaking', JSON.stringify(st)); await grab('4-speaking-' + got); got++; await sleep(400); }
  }
  if (!got) log('never saw has-level with a big wave');
  await page.evaluate(() => window.__cbApp.hangUp());
  await sleep(1500);
  await page.evaluate(() => window.__cbApp.store.set({ call: 'error', callMessage: 'x' }));
  await sleep(500); await grab('5-error');
  await page.evaluate(() => window.__cbApp.store.set({ call: 'ringing' }));
  await sleep(700); await grab('6-ringing-forced');
  await page.evaluate(() => window.__cbApp.store.set({ call: 'idle' }));
  log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
