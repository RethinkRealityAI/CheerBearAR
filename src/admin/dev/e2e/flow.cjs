// Playwright walk-through of the admin panel. Run with the dev server up (PORT=5184 npm run dev):
//   node src/admin/dev/e2e/flow.cjs                          (mock, 1440x900)
//   W=390 H=844 TAG=mock-390 node src/admin/dev/e2e/flow.cjs (mock, phone)
//   Q= U=admin P=admin TAG=real-1440 node src/admin/dev/e2e/flow.cjs (real local functions, dev admin/admin)
// Screenshots go to docs/evidence/admin-ui/.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5184/admin-dev.html';
const Q = process.env.Q ?? '?mock';
const USER = process.env.U || 'dapo', PASS = process.env.P || 'demo';
const W = +(process.env.W || 1440), H = +(process.env.H || 900);
const tag = process.env.TAG || `${W}`;
const ev = '/home/user/cheerbearar/docs/evidence/admin-ui';
fs.mkdirSync(ev, { recursive: true });
const errors = [];
let n = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const shot = async (name, full = false) => p.screenshot({ path: `${ev}/${tag}-${String(++n).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 60, fullPage: full });
  const go = async (id) => { await p.evaluate((id) => { location.hash = id; }, id); await p.waitForTimeout(300); };
  const save = async () => { await p.click('.adm-savebar button:has-text("Save")'); await p.waitForSelector('.adm-savebar', { state: 'detached' }); await p.waitForTimeout(200); };

  await p.goto(BASE + Q);
  await p.waitForSelector('button[type=submit]');
  // wrong password
  await p.fill('input[autocomplete=username]', USER); await p.fill('input[type=password]', 'nope');
  await p.click('button[type=submit]'); await p.waitForSelector('[role=alert]');
  ok(/not right|wrong/i.test(await p.textContent('[role=alert]')), 'wrong password message');
  await shot('login-error');
  await p.fill('input[type=password]', PASS); await p.click('button[type=submit]');
  await p.waitForSelector('h2:has-text("Overview")'); await p.waitForTimeout(600);
  await shot('overview');

  // Trigger policy: cooldown + toggle
  await go('triggers');
  const cd = p.locator('[data-path="triggerPolicy.triggerCooldownMs"] input[type=number]');
  await cd.fill('99999');
  ok(await p.locator('[data-path="triggerPolicy.triggerCooldownMs"] .adm-error').isVisible(), 'range error shown inline');
  ok(await p.locator('.adm-savebar button:has-text("Save")').isDisabled(), 'save disabled with a problem');
  await shot('trigger-error');
  await cd.fill('4500');
  await p.click('button[role=switch]:near(:text("Typed messages can trigger"))');
  // Privacy
  await go('privacy');
  await p.locator('button[role=switch]').first().click();
  // Keyword add + synonyms
  await go('intent');
  await p.fill('#kw-new', 'Party'); await p.click('.adm-kw-add button');
  ok(await p.locator('#kw-new-err').isVisible(), 'duplicate keyword rejected');
  await p.fill('#kw-new', 'Pizza'); await p.click('.adm-kw-add button');
  const syn = p.locator('.adm-kw-editor input.adm-input').first();
  await syn.fill('pizzas, slice'); await syn.press('Enter');
  await p.fill('#phrase', 'Shall we share a slice by my house?');
  await p.waitForSelector('#phrase-result .adm-chip');
  const chips = await p.locator('#phrase-result .adm-chip').allTextContents();
  ok(chips.includes('Pizza') && chips.includes('House'), `test phrase uses draft: ${chips}`);
  await shot('intent-test', true);
  ok(/(\d+) unsaved/.test(await p.textContent('.adm-savebar')), 'save bar counts changes: ' + (await p.textContent('.adm-savebar-text')).trim());
  await shot('savebar');
  // Game mode
  await go('games');
  await p.click('button:has-text("New game mode")');
  const name = p.locator('[data-path$=".name"] input').last();
  await name.fill('Pizza Party');
  await p.click('.adm-game-editor button[role=switch]');
  await p.click('.adm-pick-chip:has-text("Pizza")');
  await p.locator('.adm-game-editor .adm-tags.sentence input').first().fill('What is your favourite food?');
  await p.locator('.adm-game-editor .adm-tags.sentence input').first().press('Enter');
  await shot('game-new', true);
  // UI colour
  await go('ui');
  await p.locator('[data-path="ui.customization.primaryColor"] input.adm-color-hex').fill('#d81b7c');
  await save();
  ok(!(await p.locator('.adm-savebar').count()), 'saved, bar gone');
  await shot('saved-toast');

  // Reload: values persisted
  await p.reload(); await p.waitForSelector('h2'); await p.waitForTimeout(500);
  if (await p.locator('button[type=submit]:has-text("Sign in")').count()) { await p.fill('input[autocomplete=username]', USER); await p.fill('input[type=password]', PASS); await p.click('button[type=submit]'); await p.waitForSelector('h2'); }
  await go('triggers');
  ok(await cd.inputValue() === '4500', 'cooldown persisted after reload');
  await go('intent');
  ok(await p.locator('.adm-kw-item:has-text("Pizza")').count() === 1, 'keyword persisted');
  await go('games');
  ok(await p.locator('.adm-game-card:has-text("Pizza Party")').count() === 1, 'game mode persisted');

  // Export / import round trip
  await go('backup');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Download settings")')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(exported.triggerPolicy.triggerCooldownMs === 4500, 'export contains saved values');
  exported.triggerPolicy.triggerCooldownMs = 1200;
  exported.ui.customization.headerTitle = 'Imported title';
  await p.fill('#import-paste', '{not json'); await p.click('button:has-text("Import pasted text")');
  ok(await p.locator('#import-err').isVisible(), 'bad JSON rejected inline');
  await p.fill('#import-paste', JSON.stringify(exported)); await p.click('button:has-text("Import pasted text")');
  await p.waitForSelector('h2:has-text("Overview")');
  await shot('import-draft');
  ok(/2 unsaved/.test(await p.textContent('.adm-savebar')), 'import loaded 2 changes into draft');
  await save();

  // History restore
  await go('history');
  await p.waitForSelector('.adm-history-item');
  await shot('history');
  await p.locator('.adm-history-item button:has-text("Restore")').nth(1).click();
  await p.click('dialog button:has-text("Restore")');
  await p.waitForTimeout(800);
  await go('triggers');
  ok(await cd.inputValue() === '4500', 'restored previous version (cooldown 4500)');

  // Discard with confirm
  await cd.fill('100');
  await p.click('.adm-savebar button:has-text("Discard")');
  await shot('discard-confirm');
  await p.click('dialog button:has-text("Discard")'); await p.waitForTimeout(300); console.log('after discard', await cd.inputValue(), await p.locator('.adm-savebar').count());
  ok(await cd.inputValue() === '4500', 'discard restores saved value');

  // Reset with confirm
  await go('backup');
  await p.click('button:has-text("Reset all settings")');
  await shot('reset-confirm');
  await p.click('dialog button:has-text("Reset all settings")');
  await p.waitForTimeout(600);
  await go('triggers');
  ok(await cd.inputValue() === '3000', 'reset to defaults');

  // Section picker on phones
  if (W < 900) { await p.selectOption('#adm-picker', 'ui'); await p.waitForTimeout(300); ok((await p.textContent('h2')).includes('Look'), 'phone picker navigates'); }

  console.log('console errors:', errors.length ? errors : 'none');
  await b.close();
})().catch((e) => { console.log('CRASH', e.message); console.log('console errors:', errors); process.exit(1); });
