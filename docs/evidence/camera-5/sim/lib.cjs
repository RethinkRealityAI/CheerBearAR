// Shared Playwright helpers for the capture-2 simulator runs (from docs/evidence/xr-capture/sim/lib.cjs; port 5191, shots
// go to docs/evidence/capture-2/, downloads accepted).
// Two cameras in one run (3D Photo: front camera for the selfie, back camera for the room): pass
// `cams: { user: 'face.webm', environment: 'floor.webm' }`. getUserMedia is replaced by a 960x720 canvas stream that
// plays the file for the requested facingMode (served through a route, not from the repo), so an engine camera swap
// really changes the picture. Make the webm files with `ffmpeg -i face.y4m -c:v libvpx -b:v 2M face.webm`.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:5222';
const OUT = process.env.OUT || path.join(__dirname, '..');
fs.mkdirSync(OUT, { recursive: true });

async function launch({ video, cams, phone = true, motion = false, w, h, autoplay = true, reduced = false, strictAutoplay = false } = {}) {
  const args = ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'];
  if (autoplay) args.push('--autoplay-policy=no-user-gesture-required');
  if (cams) args.push('--use-fake-ui-for-media-stream');
  if (video) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ args, ...(process.env.PROXY ? { proxy: { server: 'http://127.0.0.1:33443' } } : {}) });
  const ctx = await browser.newContext({
    viewport: { width: w || (phone ? 390 : 1280), height: h || (phone ? 844 : 800) },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    permissions: video || cams ? ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] : [],
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    acceptDownloads: true,
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' : undefined,
  });
  if (strictAutoplay) {
    // iPhone-like: sound needs a live user gesture (Chromium remembers any earlier tap on the page and allows it)
    // (Playwright's evaluate counts as a gesture, so "a gesture" here = a trusted tap in the last second)
    await ctx.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      window.__refusedPlays = 0;
      let tapAt = -1e9;
      for (const t of ['pointerdown', 'pointerup', 'click', 'touchend']) addEventListener(t, (e) => { if (e.isTrusted) tapAt = performance.now(); }, true);
      HTMLMediaElement.prototype.play = function () {
        if (!this.muted && performance.now() - tapAt > 1000) {
          window.__refusedPlays++;
          return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
        }
        return play.call(this);
      };
    });
  }
  if (cams) {
    await ctx.route('**/__simcam/*', (route) => {
      const which = route.request().url().split('/').pop();
      route.fulfill({ status: 200, contentType: 'video/webm', body: fs.readFileSync(cams[which]) });
    });
    await ctx.addInitScript(() => {
      // a fake camera per facing direction: a canvas stream that plays /__simcam/<user|environment>
      const md = navigator.mediaDevices;
      window.__simcam = { asks: [] };
      md.getUserMedia = async (c) => {
        const fm = c && typeof c.video === 'object' ? c.video.facingMode : null;
        // a desktop asks with no facing mode (one webcam): follow the camera the experience is switching to
        const byMode = () => {
          try {
            const d = window.__cb.debug();
            if (d.mode === 'face') return 'user';
            if (d.mode === 'photo') return window.__cb.internals().modes.get('photo').camera === 'face' ? 'user' : 'environment';
          } catch { /* not up yet */ }
          return 'environment';
        };
        const want = (typeof fm === 'string' ? fm : fm && (fm.exact || fm.ideal)) || byMode();
        const face = /user|front/i.test(String(want));
        window.__simcam.asks.push(face ? 'user' : 'environment');
        const v = document.createElement('video');
        v.src = '/__simcam/' + (face ? 'user' : 'environment');
        v.muted = true; v.loop = true; v.playsInline = true;
        await v.play();
        const cv = document.createElement('canvas'); cv.width = 960; cv.height = 720;
        const g = cv.getContext('2d');
        const draw = () => g.drawImage(v, 0, 0, 960, 720);
        draw();
        const id = setInterval(draw, 33);
        const s = cv.captureStream(30);
        const tr = s.getVideoTracks()[0];
        const stop = tr.stop.bind(tr);
        tr.stop = () => { clearInterval(id); v.pause(); v.removeAttribute('src'); stop(); };
        tr.getSettings = ((gs) => () => ({ ...gs(), width: 960, height: 720, facingMode: face ? 'user' : 'environment' }))(tr.getSettings.bind(tr));
        return s;
      };
    });
  }
  if (video || cams) {
    await ctx.addInitScript((onlyImu) => {
      // 1) strip facingMode/deviceId (the fake camera has neither); 2) fake IMU so SLAM can run
      const md = navigator.mediaDevices;
      if (!onlyImu) {
        const orig = md.getUserMedia.bind(md);
        md.getUserMedia = (c) => {
          if (c && typeof c.video === 'object') { delete c.video.facingMode; delete c.video.deviceId; }
          return orig(c);
        };
      }
      if (typeof DeviceOrientationEvent === 'undefined' || typeof DeviceMotionEvent === 'undefined') return; // not a page
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
    }, !!cams);
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
