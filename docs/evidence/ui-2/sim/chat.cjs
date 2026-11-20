// ui-2: the conversation sheet in detail (chat bubbles, typing, actions, games, settings) + keyboard on the switcher.
const path = require('path');
const lib = require('./mylib.cjs');
const { launch, sleep, waitFor, errorsOf } = lib;
const OUT = process.env.OUT;
const W = +process.env.W || 390, H = +process.env.H || 844;
const phone = process.env.PHONE !== '0';
const tag = process.env.TAG || `${W}x${H}`;
const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 72, timeout: 120000 });

(async () => {
  const { browser, page, logs } = await launch({ phone, w: W, h: H });
  await page.goto(`${lib.BASE}/?test&desktop&mockVoice=fast,silent`, { waitUntil: 'load' });
  await lib.start(page);
  await sleep(2500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.evaluate(() => {
    const c = window.__cbApp;
    c.store.set((s) => ({ ui: { ...s.ui, transcriptVisibility: 'chat_only' } }));
    c.setUiMode('chat');
    c.openSheet('talk');
    if (!c.store.get().isDesktop) c.setSnap('full');
  });
  await sleep(800);
  await page.evaluate(() => { const c = window.__cbApp; c.requestCall(); if (c.store.get().micAsk) c.confirmMic(); });
  await waitFor(page, () => window.__cbApp.store.get().call === 'in-call', null, 30000).catch(() => log('no in-call'));
  await sleep(1200);
  await shot(page, '20-chat-typing-start');
  await sleep(5000);
  await page.fill('#cb-input', 'Can you show me your house?');
  await page.press('#cb-input', 'Enter');
  await sleep(500);
  await shot(page, '21-chat-sent-typing');
  log('msgs', JSON.stringify(await page.evaluate(() => window.__cbApp.store.get().messages.map((m) => [m.kind, m.source, m.final, m.text.slice(0, 30)]))));
  await sleep(4500);
  await shot(page, '22-chat-later');
  // orb while speaking, sheet closed
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(600);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => { const o = document.querySelector('.cb-orb'); const w = o?.querySelector('.cb-orb-wave'); return { cls: o?.className, wave: w?.style.transform }; });
    log('orb', JSON.stringify(st));
  }
  await page.locator('.cb-orb-dock').screenshot({ path: path.join(OUT, `${tag}-23-orb-speaking.jpg`), type: 'jpeg', quality: 85 }).catch(() => {});
  await shot(page, '23b-orb-speaking-full');
  // tabs
  for (const t of ['actions', 'games', 'settings']) {
    await page.evaluate((t) => window.__cbApp.openSheet(t), t);
    await sleep(700);
    await shot(page, `24-tab-${t}`);
  }
  await page.evaluate(() => window.__cbApp.closeSheet());
  await sleep(500);
  // keyboard on the switcher: focus 3D tab, arrow right twice, check focus + roles
  await page.evaluate(() => document.querySelector('.cbx-switch [aria-selected=true]').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const kb = await page.evaluate(() => ({
    role: document.querySelector('.cbx-switch').getAttribute('role'),
    focused: document.activeElement?.dataset?.mode, tabindex: [...document.querySelectorAll('.cbx-switch [role=tab]')].map((b) => b.tabIndex),
  }));
  log('keyboard', JSON.stringify(kb));
  await page.locator('.cbx-top').screenshot({ path: path.join(OUT, `${tag}-25-switcher-kbfocus.jpg`), type: 'jpeg', quality: 85 });
  const errs = errorsOf(logs);
  log(tag, 'errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
