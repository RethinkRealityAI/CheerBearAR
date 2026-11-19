// polish-4: the Selfie Classic countdown. Classic plays the wink clip; at her end pose she holds the last frame while
// "Smile!" then 3, 2, 1 count you in (ticks), then the flash + shutter sound and the photo (she must be in it). Also:
// the shutter during the 3-2-1 shoots at once, the shutter replays the clip afterwards, the 3D bear's 5 s countdown
// still shows, and (with `noautoplay`) the "Tap to play" path still ends in the countdown + photo.
//   BASE=http://localhost:5213 OUT=<dir> node classic.cjs <face.webm> [noautoplay] [W H]
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, OUT } = require('../../capture-2/sim/lib.cjs');

const T = 240000;
const NOAUTO = process.argv.includes('noautoplay');
const nums = process.argv.slice(3).filter((a) => /^\d+$/.test(a)).map(Number);
const W = nums[0] || 390, H = nums[1] || 844;
const P = (NOAUTO ? 'classic-na' : 'classic') + (W !== 390 ? `-${W}` : '');
const BASE = process.env.BASE || 'http://localhost:5213';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), P, ...a);
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === text && x.offsetParent);
  if (!b) throw new Error('no button ' + text);
  b.click();
}, text);
const face = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('face');
  const v = document.querySelector('video[src*="wink"]');
  const c = document.querySelector('.cbc-count');
  return {
    state: m.state, look: m.look,
    diag: { clipPlays: m.diag.clipPlays, clipEnds: m.diag.clipEnds, clipCounts: m.diag.clipCounts, clipAutoShots: m.diag.clipAutoShots, shots: m.diag.shots, clipBlocked: m.diag.clipBlocked },
    video: v ? { paused: v.paused, muted: v.muted, t: +v.currentTime.toFixed(2), ended: v.ended } : null,
    count: c ? { hidden: c.hidden, phase: c.dataset.phase, shown: m.countdown?.shown?.join(',') } : null,
  };
});
async function savePhoto(page, name) {
  const b64 = await page.evaluate(async () => {
    const b = window.__cb.internals().modes.get('face').diag.lastPhoto;
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const p = path.join(OUT, name + '.jpg');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}
/** Cheer Bear pink and key-green shares in a region of the saved photo. */
const photoPixels = (page, rect) => page.evaluate(async (rect) => {
  const b = window.__cb.internals().modes.get('face').diag.lastPhoto;
  const src = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const x0 = Math.round(rect[0] * src.width), y0 = Math.round(rect[1] * src.height), w = Math.round(rect[2] * src.width), h = Math.round(rect[3] * src.height);
  const d = g.getImageData(x0, y0, w, h).data;
  let pink = 0, green = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; n++; if (r > 170 && r - gg > 60 && bb > 90) pink++; if (gg > 140 && gg - r > 70 && gg - bb > 40) green++; }
  return { pink: +(pink / n).toFixed(3), green: +(green / n).toFixed(4) };
}, rect);

/** Screenshot each countdown phase as it appears ("lead" = Smile!, then 3, 2, 1), then the flash. */
async function shootPhases(page, prefix) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const ph = await page.evaluate(() => { const c = document.querySelector('.cbc-count'); return c && !c.hidden ? c.dataset.phase : (document.querySelector('.cbc-flash') ? 'flash' : ''); });
    if (ph && !seen.has(ph)) {
      seen.add(ph);
      await shot(page, `${prefix}-${ph === 'lead' ? 'smile' : ph}`);
      log('phase', ph, JSON.stringify(await face(page)));
      if (ph === 'flash') break;
    }
    if (await page.evaluate(() => !!document.querySelector('.cbc-review img'))) break;
    await sleep(40);
  }
  return [...seen];
}

(async () => {
  const cam = process.argv[2];
  const { browser, page, logs } = await launch({ phone: true, w: W, h: H, cams: { user: cam, environment: cam }, strictAutoplay: NOAUTO });
  // listen for the shutter sound and ticks: count oscillators / noise sources started
  await page.addInitScript(() => {
    window.__snd = { osc: 0, noise: 0 };
    const o = OscillatorNode.prototype.start, b = AudioBufferSourceNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { window.__snd.osc++; return o.apply(this, a); };
    AudioBufferSourceNode.prototype.start = function (...a) { window.__snd.noise++; return b.apply(this, a); };
  });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await waitFor(page, () => window.__cb.internals().modes.get('face')?.constructor?.name === 'FaceMode', null, T);
  await sleep(1000);
  await page.click('.cbx-switch [data-mode=face]');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'face' && d.entered; }, null, T);
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(2000);
  const progs = () => page.evaluate(() => window.__cb.debug().enginePrograms);
  const p0 = await progs();
  log('selfie live; programs', p0);

  if (!NOAUTO) {
    // ---- the 3D bear's countdown still shows (and ticks)
    await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-shutter').click());
    await sleep(1200);
    log('3D countdown', JSON.stringify(await face(page)));
    await shot(page, `${P}-01-3d-countdown`);
    await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
    log('3D photo', await savePhoto(page, `${P}-01-3d-photo`), 'sounds', JSON.stringify(await page.evaluate(() => window.__snd)));
    await clickText(page, 'Retake');
    await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  }

  // ---- Classic: the clip, then Smile! 3 2 1, flash, photo
  if (NOAUTO) {
    await clickText(page, 'Classic'); // synthetic: no gesture -> Tap to play
    await waitFor(page, () => !!document.querySelector('.cbc-tapplay'), null, 15000);
    log('tap to play shown', JSON.stringify(await face(page)));
    await shot(page, `${P}-00-tap-to-play`);
    await page.click('.cbc-tapplay');
  } else await page.click('.cbc-seg [data-id=classic]');
  await waitFor(page, () => { const v = document.querySelector('video[src*="wink"]'); return v && v.currentTime > 1.5; }, null, 60000);
  log('clip playing', JSON.stringify(await face(page)));
  await shot(page, `${P}-02-clip-mid`);
  const snd0 = await page.evaluate(() => ({ ...window.__snd }));
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'countdown', null, 60000);
  const phases = await shootPhases(page, `${P}-03`);
  log('phases seen', phases.join(' '));
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(600);
  await shot(page, `${P}-04-review`);
  const snd1 = await page.evaluate(() => ({ ...window.__snd }));
  log('photo', await savePhoto(page, `${P}-05-photo`), JSON.stringify(await face(page)), 'sounds during countdown+shot (osc, noise)', snd1.osc - snd0.osc, snd1.noise - snd0.noise);
  log('photo bear region', JSON.stringify(await photoPixels(page, [0.0, 0.55, 0.72, 0.45])), 'top band', JSON.stringify(await photoPixels(page, [0, 0.25, 1, 0.25])));
  if (NOAUTO) { log('errors', errorsOf(logs).join('\n') || 'none'); await browser.close(); return; }

  // ---- the shutter replays the clip; tapping it during the 3-2-1 shoots at once
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  await sleep(600);
  await shot(page, `${P}-06-between-takes`);
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'clip', null, 10000);
  await waitFor(page, () => { const c = document.querySelector('.cbc-count'); return c && !c.hidden && c.dataset.phase === '3'; }, null, 60000);
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  log('shutter during 3-2-1 -> shot', JSON.stringify(await face(page)));
  await clickText(page, 'Retake');
  // the look picker (over her face) is tucked away and inert during Classic's count, and back when live again
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => { const c = document.querySelector('.cbc-count'); return c && !c.hidden && c.dataset.phase === '2'; }, null, 60000);
  const tuck = () => page.evaluate(() => { const e = document.querySelector('.cbc-seg'); return e ? { tucked: e.classList.contains('cbc-tuck'), inert: e.inert, opacity: getComputedStyle(e).opacity } : null; });
  log('picker during the count', JSON.stringify(await tuck()));
  await shot(page, `${P}-07-count-picker-tucked`);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  await sleep(600);
  log('picker when live again', JSON.stringify(await tuck()));
  // switching to the 3D bear mid-countdown (code path; the picker is inert to taps then) cancels it cleanly
  await page.click('.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => { const c = document.querySelector('.cbc-count'); return c && !c.hidden; }, null, 60000);
  await page.evaluate(() => { const e = document.querySelector('.cbc-seg'); e.inert = false; e.querySelector('[data-id="3d"]').click(); });
  await sleep(1500);
  log('3D mid-countdown', JSON.stringify(await face(page)), 'picker', JSON.stringify(await tuck()));
  log('programs', p0, '->', await progs());
  log('errors', errorsOf(logs).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
