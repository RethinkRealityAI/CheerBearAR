// Edge cases on the mock: save failure rolls back (?mock&fail=save), expired sign-in keeps edits (?mock&expire=3).
const { chromium } = require('playwright');
const ev = '/home/user/cheerbearar/docs/evidence/admin-ui';
const B = 'http://localhost:5184/admin-dev.html';
const ok = (c, m) => console.log(c ? 'ok  ' : 'FAIL', m);
(async () => {
  const b = await chromium.launch();
  const login = async (p) => { await p.fill('input[autocomplete=username]', 'dapo'); await p.fill('input[type=password]', 'demo'); await p.click('button[type=submit]'); await p.waitForSelector('h2'); };
  // 1. save failure rolls back to unsaved
  let ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); let p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '?mock&fail=save'); await login(p);
  await p.evaluate(() => { location.hash = 'mode'; }); await p.waitForTimeout(300);
  await p.click('label:has-text("Chat")');
  await p.click('.adm-savebar button:has-text("Save")');
  await p.waitForSelector('.adm-toast.error');
  ok(/1 unsaved/.test(await p.textContent('.adm-savebar')), 'failed save keeps the edit as unsaved');
  ok(await p.locator('input[value=chat]').isChecked(), 'draft value still shown');
  await p.screenshot({ path: `${ev}/390-20-save-failed.jpg`, type: 'jpeg', quality: 60 });
  await ctx.close();
  // 2. expired token: signed out, edits kept
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '?mock&expire=3'); await login(p);
  await p.evaluate(() => { location.hash = 'privacy'; }); await p.waitForTimeout(300);
  await p.locator('button[role=switch]').nth(1).click();
  await p.waitForTimeout(3500);
  await p.click('.adm-savebar button:has-text("Save")');
  await p.waitForSelector('text=sign-in expired');
  await p.screenshot({ path: `${ev}/1440-20-session-expired.jpg`, type: 'jpeg', quality: 60 });
  ok(true, 'expired session shows sign-in with notice');
  await login(p); await p.waitForTimeout(400);
  ok(/1 unsaved/.test(await p.textContent('.adm-savebar').catch(() => '')), 'edits kept after signing in again');
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
})();
