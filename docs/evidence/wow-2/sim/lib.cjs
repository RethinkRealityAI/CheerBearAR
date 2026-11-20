// wow-2 simulator helpers: the xr-core helpers plus video recording and synthetic gestures (flick, long press, tap)
// dispatched as PointerEvents (swiftshader runs at ~5 fps, so real mouse moves arrive too slowly to read as a flick).
const path = require('path');
const fs = require('fs');
const core = require('../../xr-core/sim/lib.cjs');
const { chromium } = require('playwright');

async function launchRec({ video, w = 390, h = 844, recordDir } = {}) {
  if (!recordDir) return core.launch({ phone: true, video, w, h });
  // same as core.launch (phone), plus recordVideo
  const args = ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'];
  const browser = await chromium.launch({ args });
  fs.mkdirSync(recordDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    recordVideo: { dir: recordDir, size: { width: w, height: h } },
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return { browser, ctx, page, logs };
}

/** A quick upward swipe on `sel` from (x, y): `len` px up, `dx` px sideways. */
function flick(page, sel, { x = 195, y = 640, len = 170, dx = 0 } = {}) {
  return page.evaluate(({ sel, x, y, len, dx }) => new Promise((res) => {
    const el = document.querySelector(sel);
    const o = { pointerId: 11, bubbles: true, isPrimary: true, pointerType: 'touch', button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
    for (let i = 1; i <= 4; i++) el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + (dx * i) / 4, clientY: y - (len * i) / 4 }));
    setTimeout(() => { el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y - len })); res(); }, 30);
  }), { sel, x, y, len, dx });
}

/** Hold still on `sel` at (x, y) for `ms`. */
function press(page, sel, x, y, ms) {
  return page.evaluate(({ sel, x, y, ms }) => new Promise((res) => {
    const el = document.querySelector(sel);
    const o = { pointerId: 12, bubbles: true, isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: y };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    // a tap goes in one task (a busy main thread would stretch a timer past the 450 ms tap limit)
    if (ms < 100) { el.dispatchEvent(new PointerEvent('pointerup', o)); res(); return; }
    setTimeout(() => { el.dispatchEvent(new PointerEvent('pointerup', o)); res(); }, ms);
  }), { sel, x, y, ms });
}

/** Screen position of a stage-local point (showcase: world = stage). */
function project(page, which, p) {
  return page.evaluate(({ which, p }) => {
    const I = window.__cb.internals();
    const THREE = window.THREE;
    let cam, root;
    if (which === 'showcase') { cam = I.showcase.cam; root = I.stages.showcase.root; }
    else { cam = I.engine.xr.camera; root = I.stages.ar.root; }
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    root.localToWorld(v);
    v.project(cam);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }, { which, p });
}

module.exports = { ...core, launchRec, flick, press, project };
