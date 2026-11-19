// Selfie run (round 2). Fake front camera = a still face photo with an "ABC" label (mirror check), `?desktop`.
//   1. 3D look: hello, face found, the bear is drawn in front of the face (proof: grow the head occluder over the
//      whole screen; she must stay), face cues through the test hook (smile, mouth, wink, brows, tilt), countdown photo.
//   2. Classic: a tap on Classic plays the keyed clip with sound; no numeric countdown; on the last frame the photo is
//      taken by itself with her in it; Retake; the shutter replays; second automatic photo.
//   3. Smile to snap (switch on, a held smile through the hook) -> 3 s countdown -> photo.
//   4. Selfie -> Photo -> Selfie -> 3D: nothing left playing.
// With `noautoplay`: an iPhone-like rule (sound needs a live gesture) and a synthetic (no-gesture) Classic choice:
// "Tap to play" must show; a real tap plays it with sound.
//   node docs/evidence/capture-2/sim/face.cjs <face.webm> [noautoplay]
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE, OUT } = require('./lib.cjs');

const T = 240000;
const NOAUTO = process.argv.includes('noautoplay');
const P = NOAUTO ? 'face-na' : 'face';
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
  const v = document.querySelector('video[src*="wink"]');
  return {
    state: m.state, look: m.look, found: m.faceFound, smileSnap: m.smileSnap,
    diag: { ...m.diag, lastPhoto: m.diag.lastPhoto ? m.diag.lastPhoto.size : 0, attachmentKeys: m.diag.attachmentKeys.length },
    video: v ? { paused: v.paused, muted: v.muted, t: +v.currentTime.toFixed(2), ended: v.ended } : null,
    signals: m.signals.diag,
  };
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

/** Pink (Cheer Bear) and leftover key-green pixel counts in a region of the current canvas or a photo. */
async function pixels(page, which, rect) {
  return page.evaluate(async ({ which, rect }) => {
    let src;
    if (which === 'photo') {
      const b = window.__cb.internals().modes.get('face').diag.lastPhoto;
      src = await createImageBitmap(b);
    } else {
      const m = window.__cb.internals().modes.get('face');
      src = await window.__cb.internals().engine.screenshot();
    }
    const W = src.width, H = src.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const x0 = Math.round(rect[0] * W), y0 = Math.round(rect[1] * H), w = Math.round(rect[2] * W), h = Math.round(rect[3] * H);
    const d = g.getImageData(x0, y0, w, h).data;
    let pink = 0, green = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      n++;
      if (r > 170 && r - gg > 60 && b > 90) pink++;
      if (gg > 140 && gg - r > 70 && gg - b > 40) green++; // the clip's key green (0,182,87) and near it
    }
    return { W, H, pink: +(pink / n).toFixed(3), green: +(green / n).toFixed(4) };
  }, { which, rect });
}

(async () => {
  const cam = process.argv[2] || path.join(__dirname, 'face.webm');
  const { browser, page, logs } = await launch({ phone: true, cams: { user: cam, environment: cam }, strictAutoplay: NOAUTO });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('face')?.constructor?.name === 'FaceMode', null, T);
  log('showcase live, real face mode loaded');
  await sleep(1200);

  // ---- 1. 3D look
  await page.click('.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(2500);
  log('3D look', JSON.stringify(await face(page)));
  await shot(page, `${P}-01-3d-live`);
  const p0 = await programs(page);
  log('programs after face found', p0);
  const bearRect = [0.0, 0.5, 0.5, 0.5];
  log('bear pixels (bottom-left, live)', JSON.stringify(await pixels(page, 'canvas', bearRect)));
  // the bear is an overlay: make the head occluder cover the whole view; she must still be drawn
  await page.evaluate(() => {
    const m = window.__cb.internals().modes.get('face');
    const occ = m.root.getObjectByName('head-occluder');
    window.__occScale = occ.scale.clone();
    occ.scale.multiplyScalar(30);
  });
  await sleep(1200);
  log('bear pixels with a screen-sized head occluder', JSON.stringify(await pixels(page, 'canvas', bearRect)));
  await shot(page, `${P}-02-3d-occluder-everywhere`);
  await page.evaluate(() => { const occ = window.__cb.internals().modes.get('face').root.getObjectByName('head-occluder'); occ.scale.copy(window.__occScale); });

  // face cues through the hook (a still photo cannot smile or wink); the real gates are logged in signals
  for (const [cue, wait] of [['smile', 1500], ['smileOff', 600], ['mouth', 900], ['mouthOff', 900], ['wink', 250], ['brows', 900]]) {
    await page.evaluate((c) => window.__cb.internals().modes.get('face').fire(c), cue);
    await sleep(wait);
    const f = await face(page);
    log('cue', cue, '-> expression', f.diag.expression, 'reactions', JSON.stringify(f.diag.reactions));
    if (cue === 'smile' || cue === 'mouth' || cue === 'wink') await shot(page, `${P}-03-cue-${cue}`);
  }
  await sleep(1500);
  await page.evaluate(() => window.__cb.internals().modes.get('face').fire('tilt', 0.32));
  await sleep(1500);
  await shot(page, `${P}-03-cue-tilt`);
  await page.evaluate(() => window.__cb.internals().modes.get('face').fire('tilt', 0));
  log('signals (still face)', JSON.stringify((await face(page)).signals));

  // countdown photo (3D look)
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await sleep(1500);
  await shot(page, `${P}-04-3d-countdown`);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(700);
  await shot(page, `${P}-05-3d-review`);
  log('3D photo', await savePhoto(page, `${P}-photo-1-3d`), JSON.stringify(await pixels(page, 'photo', bearRect)), 'programs', await programs(page));
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);

  // ---- 2. Classic: choosing it plays the clip with sound, the photo takes itself at the end
  if (NOAUTO) {
    // synthetic click = no user gesture: unmuted play is refused -> "Tap to play"
    await clickText(page, 'Classic');
    await waitFor(page, () => !!document.querySelector('.cbc-tapplay'), null, 15000).catch(() => log('NO tap-to-play button'));
    await sleep(500);
    await shot(page, `${P}-06-tap-to-play`);
    log('blocked', JSON.stringify(await face(page)), 'refused plays', await page.evaluate(() => window.__refusedPlays));
    await page.click('.cbc-tapplay'); // a real tap
  } else {
    await page.click('.cbc-seg [data-id=classic]');
  }
  await waitFor(page, () => { const v = document.querySelector('video[src*="wink"]'); return v && v.currentTime > 1.5; }, null, 60000);
  log('clip playing', JSON.stringify(await face(page)));
  await shot(page, `${P}-07-classic-clip-mid`);
  await waitFor(page, () => { const v = document.querySelector('video[src*="wink"]'); return v && v.currentTime > 4.6; }, null, 60000);
  await shot(page, `${P}-08-classic-clip-end`);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(700);
  await shot(page, `${P}-09-classic-review`);
  const f2 = await face(page);
  log('classic auto photo', await savePhoto(page, `${P}-photo-2-classic`), JSON.stringify(f2.diag), JSON.stringify(f2.video));
  // her last frame sits bottom left to centre in the 9:16 clip; on a 390x844 screen that is about x 0..0.75, y 0.5..1
  log('photo: bear region', JSON.stringify(await pixels(page, 'photo', [0.0, 0.55, 0.72, 0.45])), 'top band (key gone?)', JSON.stringify(await pixels(page, 'photo', [0, 0.25, 1, 0.25])));
  if (NOAUTO) { await clickText(page, 'Retake'); log('errors', errorsOf(logs).join('\n') || 'none'); await browser.close(); return; }

  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  await sleep(800);
  await shot(page, `${P}-10-classic-between-takes`);
  await page.click('.cbx-slot-centre .cbx-shutter'); // another take: the clip again
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'clip', null, 10000);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  const f3 = await face(page);
  log('second classic take', await savePhoto(page, `${P}-photo-3-classic-again`), 'plays', f3.diag.clipPlays, 'auto shots', f3.diag.clipAutoShots, 'programs', await programs(page));

  // reveal + behind the scenes still work from the review
  await clickText(page, 'Watch photo animation');
  await waitFor(page, () => window.__cb.internals().modes.get('face').reveal.diag.ended, null, 120000).catch(() => log('reveal slow'));
  await shot(page, `${P}-11-reveal-end`);
  await page.evaluate(() => document.querySelector('.cbc-pl-close').click());
  await clickText(page, 'Behind the scenes');
  await waitFor(page, () => document.querySelector('.cbc-player video')?.currentTime > 2.5, null, 30000).catch(() => log('bts slow'));
  await sleep(300);
  await shot(page, `${P}-12-bts`);
  // the photo tracked into the frame she holds: crops of the composite canvas through the clip
  for (const t of [3.2, 4.2, 4.9]) {
    await waitFor(page, (t) => { const v = document.querySelector('.cbc-player video'); return !v || v.ended || v.currentTime > t; }, t, 30000).catch(() => {});
    const b64 = await page.evaluate(() => document.querySelector('.cbc-player canvas')?.toDataURL('image/jpeg', 0.8).split(',')[1]);
    if (b64) require('fs').writeFileSync(require('path').join(OUT, `${P}-12-bts-t${t}.jpg`), Buffer.from(b64, 'base64'));
  }
  log('bts', JSON.stringify(await page.evaluate(() => window.__cb.internals().modes.get('face').bts.diag)));
  await page.evaluate(() => document.querySelector('.cbc-pl-close').click());
  await clickText(page, 'Retake');

  // ---- 3. smile to snap (3D look)
  await page.click('.cbc-seg [data-id="3d"]');
  await sleep(800);
  await page.click('.cbx-slot-left .cbc-toggle');
  await sleep(400);
  await shot(page, `${P}-13-smile-switch-on`);
  await page.evaluate(() => window.__cb.internals().modes.get('face').fire('smile'));
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'countdown', null, 10000);
  log('smile started the countdown', await page.evaluate(() => document.querySelector('.cbc-count span')?.textContent));
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  log('smile photo', await savePhoto(page, `${P}-photo-4-smile`), JSON.stringify((await face(page)).diag.smileShots));
  await page.evaluate(() => window.__cb.internals().modes.get('face').fire('smileOff'));
  await clickText(page, 'Retake');
  log('programs end of selfie', await programs(page), '(after face found:', p0 + ')');

  // ---- 4. Selfie -> Photo -> Selfie -> 3D
  await page.click('.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  await sleep(1500);
  log('in Photo; videos', JSON.stringify(await videos(page)));
  await page.click('.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000).catch(() => log('face not found again'));
  await sleep(1500);
  await shot(page, `${P}-14-back-in-selfie`);
  await page.click('.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(1200);
  log('back in 3D; videos', JSON.stringify(await videos(page)), 'left over', await page.evaluate(() => document.querySelectorAll('.cbc-overlay,.cbc-review,.cbc-player,.cbc-count,.cbc-tapplay,.cbc-guide').length));
  const bearOrders = await page.evaluate(() => { const o = []; window.__cb.internals().bear.object.traverse((m) => { if (m.isMesh) o.push(m.renderOrder); }); return o; });
  log('bear render orders back on the stage', JSON.stringify(bearOrders));
  log('engine', JSON.stringify((await page.evaluate(() => window.__cb.debug())).engine?.engine));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  log('warnings', logs.filter((l) => l.startsWith('[warning]')).slice(0, 12).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
