const lib = require('/home/user/cheerbearar/docs/evidence/xr-capture/sim/lib.cjs');
// polling with page.evaluate (waitForFunction stalled now and then under heavy load)
async function waitFor(page, fn, arg, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await page.evaluate(fn, arg)) return true; } catch { /* navigating */ }
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + fn.toString().slice(0, 80));
    await lib.sleep(300);
  }
}
module.exports = { ...lib, waitFor };
// click Start until the experience has started (a click before it has fully loaded is ignored)
module.exports.start = async function start(page, timeout = 300000) {
  const t0 = Date.now();
  await module.exports.waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, timeout);
  // StrictMode boots twice in dev: __cbx can be the disposed instance; use the one the app kept
  await module.exports.waitFor(page, () => !!(window.__cbApp && window.__cbApp.experience), null, timeout);
  await page.evaluate(() => { window.__cbx = window.__cbApp.experience; });
  for (;;) {
    await page.evaluate(() => { const b = document.querySelector('.cbx-start'); if (b && !b.disabled) b.click(); });
    for (let i = 0; i < 10; i++) { await lib.sleep(500); if (await page.evaluate(() => !!(window.__cbx && window.__cbx.started))) return; }
    if (Date.now() - t0 > timeout) throw new Error('never started');
  }
};
