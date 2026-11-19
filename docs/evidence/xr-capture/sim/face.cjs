// Selfie run (fake front camera = a face photo y4m, ?desktop). 3D -> Selfie (intro, skip by tap) -> face found ->
// countdown -> capture (photo saved next to the shots) -> review -> reveal -> share fallback -> behind the scenes ->
// retake -> Classic look + "shoot now" -> Selfie -> AR -> Selfie -> 3D. Programs must stay flat across captures; every
// video must be stopped after leaving.
//   node docs/evidence/xr-capture/sim/face.cjs /path/to/face.y4m
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE, OUT } = require('./lib.cjs');

const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === text && x.offsetParent);
  if (!b) throw new Error('no button ' + text);
  b.click();
}, text);
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);
const face = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('face');
  return { state: m.state, look: m.look, found: m.faceFound, introDone: m.introDone, diag: { ...m.diag, lastPhoto: m.diag.lastPhoto ? m.diag.lastPhoto.size : 0 } };
});
const programs = (page) => page.evaluate(() => window.__cb.debug().enginePrograms);
const videos = (page) => page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: (v.currentSrc || v.src || '').split('/').pop(), paused: v.paused, muted: v.muted, t: +v.currentTime.toFixed(2) })));

async function savePhoto(page, name) {
  const b64 = await page.evaluate(async () => {
    const b = window.__cb.internals().modes.get(window.__cb.mode).diag.lastPhoto;
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const p = path.join(OUT, name + '.jpg');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

(async () => {
  const video = process.argv[2] || path.join(__dirname, 'face.y4m');
  const { browser, page, logs } = await launch({ phone: true, video });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('face')?.constructor?.name === 'FaceMode', null, T);
  log('showcase live, real face mode loaded');
  await sleep(1500);

  // ---- 3D -> Selfie: the intro
  await click(page, '.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  log('face live', JSON.stringify(await face(page)));
  await waitFor(page, () => { const v = document.querySelector('video[src*="wink"]'); return v && v.currentTime > 1.2; }, null, T).catch(() => log('wink did not reach 1.2 s'));
  await shot(page, 'face-01-intro');
  log('intro videos', JSON.stringify(await videos(page)));
  // tap the camera canvas to skip
  await page.evaluate(() => {
    const c = document.querySelector('canvas.cbx-xr');
    const o = { pointerId: 3, bubbles: true, isPrimary: true, pointerType: 'touch', clientX: 200, clientY: 400 };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 20000);
  log('after skip', JSON.stringify(await face(page)), JSON.stringify(await videos(page)));

  // ---- face found, 3D look
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(2500);
  await shot(page, 'face-02-live-3d');
  const p0 = await programs(page);
  log('face found; programs', p0);

  // ---- countdown -> capture -> review
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await sleep(1600);
  await shot(page, 'face-03-countdown');
  log('countdown', await page.evaluate(() => document.querySelector('.cbc-count span')?.textContent));
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(800);
  await shot(page, 'face-04-review');
  const ph1 = await savePhoto(page, 'face-photo-1-3d');
  log('photo 1', ph1, JSON.stringify(await face(page)), 'programs', await programs(page));
  const evs = await page.evaluate(() => window.__cb.events.filter((e) => e.event === 'photo'));
  log('photo events', JSON.stringify(evs));

  // ---- share fallback (no Web Share in headless Chromium -> download)
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await clickText(page, 'Share');
  const d = await dl;
  log('share ->', d ? 'download ' + d.suggestedFilename() : 'no download', '|', await page.evaluate(() => document.querySelector('.cbc-review .cbc-status')?.textContent));
  const dl2 = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await clickText(page, 'Save');
  const d2 = await dl2;
  log('save ->', d2 ? 'download ' + d2.suggestedFilename() : 'no download');

  // ---- reveal
  await clickText(page, 'Watch photo animation');
  await waitFor(page, () => document.querySelector('.cbc-player video')?.currentTime > 4, null, 60000).catch(() => log('reveal slow'));
  await shot(page, 'face-05-reveal-mid');
  await waitFor(page, () => window.__cb.internals().modes.get('face').reveal.diag.ended, null, 90000);
  await sleep(600);
  await shot(page, 'face-06-reveal-end');
  log('reveal diag', JSON.stringify(await page.evaluate(() => window.__cb.internals().modes.get('face').reveal.diag)));
  await page.evaluate(() => {
    const c = document.querySelector('.cbc-player canvas');
    window.__revealStill = c.toDataURL('image/jpeg', 0.85);
  });
  const still = await page.evaluate(() => window.__revealStill);
  fs.writeFileSync(path.join(OUT, 'face-reveal-still.jpg'), Buffer.from(still.split(',')[1], 'base64'));
  await page.evaluate(() => document.querySelector('.cbc-pl-close').click());
  log('after reveal close: videos', JSON.stringify(await videos(page)), 'players', await page.evaluate(() => document.querySelectorAll('.cbc-player').length));

  // ---- behind the scenes
  await clickText(page, 'Behind the scenes');
  await waitFor(page, () => document.querySelector('.cbc-player video')?.currentTime > 1.5, null, 30000).catch(() => log('bts slow'));
  await shot(page, 'face-07-bts');
  log('bts videos', JSON.stringify(await videos(page)));
  await page.evaluate(() => document.querySelector('.cbc-pl-close').click());
  log('after bts close: videos', JSON.stringify(await videos(page)));

  // ---- retake, Classic look, shoot now (second tap)
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  await clickText(page, 'Classic');
  await sleep(1200);
  await shot(page, 'face-08-live-classic');
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await sleep(700);
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  const ph2 = await savePhoto(page, 'face-photo-2-classic');
  log('photo 2 (shoot now)', ph2, JSON.stringify(await face(page)), 'programs', await programs(page));
  await clickText(page, 'Retake');
  await clickText(page, '3D bear');
  // a trigger word while in selfie
  log('trigger Wave ->', await page.evaluate(() => window.__cb.trigger('Wave')));
  await sleep(1500);
  // third capture for the program count
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await sleep(300);
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  log('photo 3; programs', await programs(page), '(after face found:', p0 + ')');
  await clickText(page, 'Retake');

  // ---- Selfie -> AR -> Selfie (one engine session) -> 3D
  await click(page, '.cbx-switch [data-mode=ar]');
  await modeIs(page, 'ar');
  log('in AR; videos', JSON.stringify(await videos(page)), 'face state', (await face(page)).state);
  await sleep(2500);
  await click(page, '.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await sleep(500);
  log('AR -> face', JSON.stringify(await face(page)));
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000).catch(() => log('face not found again'));
  await sleep(2000);
  await shot(page, 'face-09-from-ar');
  await click(page, '.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(1500);
  log('back in 3D; videos', JSON.stringify(await videos(page)), 'overlays left', await page.evaluate(() => document.querySelectorAll('.cbc-overlay,.cbc-review,.cbc-player,.cbc-count').length));
  const dbg = await page.evaluate(() => window.__cb.debug());
  log('engine', JSON.stringify(dbg.engine?.engine));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  log('warnings', logs.filter((l) => l.startsWith('[warning]')).slice(0, 12).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
