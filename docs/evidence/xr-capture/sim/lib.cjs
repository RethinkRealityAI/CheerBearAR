// Shared Playwright helpers for the xr-capture simulator runs (copied from docs/evidence/xr-core/sim/lib.cjs: port 5186,
// shots go to docs/evidence/xr-capture/, downloads accepted).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:5186';
const OUT = process.env.OUT || path.join(__dirname, '..');
fs.mkdirSync(OUT, { recursive: true });

async function launch({ video, phone = true, motion = false, w, h } = {}) {
  const args = ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'];
  if (video) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({
    viewport: { width: w || (phone ? 390 : 1280), height: h || (phone ? 844 : 800) },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    permissions: video ? ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] : [],
    acceptDownloads: true,
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' : undefined,
  });
  if (video) {
    await ctx.addInitScript(() => {
      // 1) strip facingMode/deviceId (the fake camera has neither); 2) fake IMU so SLAM can run
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => {
        if (c && typeof c.video === 'object') { delete c.video.facingMode; delete c.video.deviceId; }
        return orig(c);
      };
      let t = 0;
      setInterval(() => {
        t += 0.016;
        const beta = 60 + Math.sin(t * 0.7) * 3, gamma = Math.sin(t * 0.5) * 2, alpha = 0 + Math.sin(t * 0.3) * 4;
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma, absolute: false }));
        const ev = new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 0, y: 0, z: 0 },
          accelerationIncludingGravity: { x: 0, y: 9.81 * Math.sin((beta * Math.PI) / 180), z: 9.81 * Math.cos((beta * Math.PI) / 180) },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
          interval: 16,
        });
        window.dispatchEvent(ev);
      }, 16);
    });
  }
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message} @ ${(e.stack || "").split("\n").slice(1, 4).join(" | ")} t=${Date.now() % 1e6}`));
  page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  return { browser, ctx, page, logs };
}

async function shot(page, name, quality = 70) {
  const p = path.join(OUT, name + '.jpg');
  await page.screenshot({ path: p, type: 'jpeg', quality, timeout: 120000 });
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, timeout = 60000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 250 });
}

function errorsOf(logs) {
  return logs.filter((l) => /^\[(error|pageerror|reqfail|http)/.test(l) && !/GPU stall|performance warning/i.test(l));
}

module.exports = { launch, shot, sleep, waitFor, errorsOf, BASE, OUT };
