// camera-5 follow-up: the capture shutter at the top of the Actions + Games stack, in 3D and AR, in the REAL app (/):
// layout boxes (no overlaps, clear of the top bar and her speech bubble), tap photo -> review chips, hold video ->
// review, programs flat; AR: hidden while placing, there once placed.   node scene.cjs [w h tag]
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const S = __dirname, OUT = process.env.OUT || path.join(S, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const W = +process.argv[2] || 390, H = +process.argv[3] || 844, TAG = process.argv[4] || 'p';
const T = 400000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `scene-${TAG}-${n}.jpg`), type: 'jpeg', quality: 62 });
const closeDialogs = (page) => page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const c = window.__cbApp; if (c && c.store.get().overlay) c.closeOverlay?.(); c?.closeSheet?.(); });
const boxes = (page) => page.evaluate(() => {
  const out = {};
  const vis = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && !n.closest('[hidden]') ? r : null; };
  const put = (k, n) => { const r = n && vis(n); if (r) out[k] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  put('shutter', document.querySelector('.cbx-dock .is-shot'));
  put('actions', document.querySelector('.cbx-dock .is-actions'));
  put('games', document.querySelector('.cbx-dock .is-games'));
  put('orb', document.querySelector('.cb-orb'));
  put('top', document.querySelector('.cbx-top'));
  put('switch', document.querySelector('.cbx-switch'));
  put('bubble', document.querySelector('.cbx-bubble'));
  put('stick', document.querySelector('.cbx-stick'));
  put('place', document.querySelector('.cbx-slot-centre .cbx-pill'));
  put('step', document.querySelector('[data-cmd=step-inside]'));
  put('move', document.querySelector('.cbx-slot-left .cbx-tool'));
  // overlaps between any two
  const ks = Object.keys(out), hits = [];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = out[ks[i]], b = out[ks[j]];
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) hits.push(ks[i] + '/' + ks[j]);
  }
  out.overlaps = hits;
  return out;
});
const sc = (page, m) => page.evaluate((m) => { const s = window.__cbx.internals.modes.get(m).shot; return s && { ...s.diag, lastPhoto: s.diag.lastPhoto?.size || 0, lastClip: s.diag.lastClip?.size || 0, lastClipType: s.diag.lastClip?.type, open: s.open }; }, m);
const programs = (page, m) => page.evaluate((m) => m === 'ar' ? window.__cbx.internals.engine.xr.renderer.info.programs.length : window.__cbx.internals.modes.get('showcase').renderer.info.programs.length, m);
async function tapPhoto(page) {
  const b = await (await page.$('.cbx-dock .is-shot')).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(1200);
  return b;
}
async function holdVideo(page, tag, ms = 4500) {
  const b = await (await page.$('.cbx-dock .is-shot')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await sleep(2400);
  await shot(page, tag + '-recording');
  log('recording boxes', JSON.stringify(await boxes(page)), 'timer', await page.evaluate(() => { const t = document.querySelector('.cbx-dock .cbx-rec-time'); const r = t.getBoundingClientRect(); return [t.textContent, Math.round(r.left), Math.round(r.top), Math.round(r.right)]; }));
  await sleep(ms - 2400);
  await page.mouse.up();
  await waitFor(page, () => !!document.querySelector('.cbc-review video'), null, 30000);
  await sleep(2500);
  await shot(page, tag + '-review-video');
  log('video el', JSON.stringify(await page.evaluate(() => { const v = document.querySelector('.cbc-review video'); return { t: +v.currentTime.toFixed(2), paused: v.paused, dur: +v.duration.toFixed(2), w: v.videoWidth, h: v.videoHeight }; })));
}
const retake = (page) => page.evaluate(() => [...document.querySelectorAll('.cbc-review button')].find((b) => b.textContent.trim() === 'Retake').click());
async function save(page, m, key, name) {
  const r = await page.evaluate(async ([m, key]) => {
    const b = window.__cbx.internals.modes.get(m).shot.diag[key]; if (!b) return null;
    const buf = new Uint8Array(await b.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type: b.type };
  }, [m, key]);
  if (r) fs.writeFileSync(path.join(OUT, name + (r.type.includes('mp4') ? '.mp4' : r.type.includes('webm') ? '.webm' : '.jpg')), Buffer.from(r.b64, 'base64'));
}

(async () => {
  const cam = S + '/../capture2/';
  const { browser, page, logs } = await launch({ phone: W < 900, w: W, h: H, cams: { user: cam + 'face.webm', environment: cam + 'floor.webm' } });
  await page.addInitScript(() => { Object.defineProperty(window, '__cb', { get() { const x = window.__cbApp?.experience; return x && { debug: () => ({ mode: x.mode }), internals: () => x.internals }; } }); });
  await page.goto(`${BASE}/?test&desktop&mockVoice`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await waitFor(page, () => !!(window.__cbApp && window.__cbApp.experience), null, T);
  await page.evaluate(() => { window.__cbx = window.__cbApp.experience; });
  for (let i = 0; i < 20; i++) { await page.evaluate(() => document.querySelector('.cbx-start:not([disabled])')?.click()); await sleep(800); if (await page.evaluate(() => !!window.__cbx.started)) break; }
  await sleep(3000);
  await closeDialogs(page);
  await shot(page, '00-3d-nudge');
  log('3D with the first-time nudge (dock steps aside)', JSON.stringify(await boxes(page)));
  // the first-time "Hold to talk" nudge expires after 12 s (TalkOrb NUDGE_MS); the dock comes back then
  await waitFor(page, () => { const b = document.querySelector('.cbx-dock .is-shot'); return b && getComputedStyle(b.parentElement).visibility !== 'hidden' && !b.closest('[hidden]'); }, null, 40000);
  await sleep(1500);
  await shot(page, '01-3d-dock');
  log('3D boxes', JSON.stringify(await boxes(page)));
  const p0 = await programs(page, 'showcase');
  // her speech bubble
  await page.evaluate(() => window.__cbx.internals.modes.get('showcase').sh.hud.speech('Hi friend! Shall we take a photo together? Tap the button up there!'));
  await sleep(1200);
  await shot(page, '02-3d-bubble');
  log('3D bubble boxes', JSON.stringify(await boxes(page)));
  await page.evaluate(() => window.__cbx.internals.modes.get('showcase').sh.hud.speech(null));
  await sleep(800);
  // tap = photo
  await tapPhoto(page);
  await shot(page, '03-3d-review');
  await page.evaluate(() => document.querySelector('.cbc-review .cbc-chip[data-id="rainbow"]').click());
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbc-review .cbc-chip[data-id="warm"]').click());
  await sleep(1500);
  await shot(page, '04-3d-review-rainbow-warm');
  log('3D photo', JSON.stringify(await sc(page, 'showcase')));
  await save(page, 'showcase', 'lastPhoto', `scene-${TAG}-3d-photo`);
  await retake(page);
  await sleep(1000);
  await holdVideo(page, '05-3d');
  log('3D clip', JSON.stringify(await sc(page, 'showcase')));
  await save(page, 'showcase', 'lastClip', `scene-${TAG}-3d-clip`);
  await retake(page);
  await sleep(1500);
  // the dock hides mid-clip (a game starting, a mode cover): the clip must end there, with its review
  {
    const b = await (await page.$('.cbx-dock .is-shot')).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await sleep(2500);
    await page.evaluate(() => window.__cbx.internals.modes.get('showcase').sh.hud.dock(false));
    const ended = await waitFor(page, () => !!document.querySelector('.cbc-review video'), null, 20000).then(() => true).catch(() => false);
    await page.mouse.up();
    log('dock hidden mid-clip -> clip ended with its review:', ended, JSON.stringify(await sc(page, 'showcase')));
    await retake(page);
    await page.evaluate(() => window.__cbx.internals.modes.get('showcase').sh.hud.dock(true));
    await sleep(1000);
  }
  log('3D programs', p0, '->', await programs(page, 'showcase'));

  // ---- AR
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=ar]').click());
  await waitFor(page, () => window.__cbx.mode === 'ar' && !document.querySelector('.cbx-switch.busy'), null, T);
  await sleep(2500);
  await closeDialogs(page);
  log('AR placing boxes', JSON.stringify(await boxes(page)));
  await shot(page, '06-ar-placing');
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled && /Place/.test(b.textContent); })) break; await sleep(4000); }
  const a0 = await programs(page, 'ar');
  await page.evaluate(() => document.querySelector('.cbx-slot-centre .cbx-pill').click());
  await waitFor(page, () => window.__cbx.internals.modes.get('ar').state === 'placed', null, T);
  await sleep(4000);
  await closeDialogs(page);
  await shot(page, '07-ar-placed-dock');
  log('AR placed boxes', JSON.stringify(await boxes(page)));
  await page.evaluate(() => window.__cbx.internals.modes.get('ar').sh.hud.speech('Look, my house! Take a photo of us!'));
  await sleep(1200);
  await shot(page, '08-ar-bubble');
  log('AR bubble boxes', JSON.stringify(await boxes(page)));
  await page.evaluate(() => window.__cbx.internals.modes.get('ar').sh.hud.speech(null));
  await sleep(600);
  await tapPhoto(page);
  await page.evaluate(() => document.querySelector('.cbc-review .cbc-chip[data-id="hearts"]').click());
  await sleep(1500);
  await shot(page, '09-ar-review-hearts');
  log('AR photo', JSON.stringify(await sc(page, 'ar')));
  await save(page, 'ar', 'lastPhoto', `scene-${TAG}-ar-photo`);
  await retake(page);
  await sleep(1000);
  await holdVideo(page, '10-ar');
  log('AR clip', JSON.stringify(await sc(page, 'ar')));
  await save(page, 'ar', 'lastClip', `scene-${TAG}-ar-clip`);
  await retake(page);
  await sleep(1000);
  // Move: back to placing, the shutter goes with the dock
  await page.evaluate(() => document.querySelector('.cbx-slot-left .cbx-tool').click());
  await sleep(1500);
  log('AR after Move boxes', JSON.stringify(await boxes(page)));
  log('AR programs', a0, '->', await programs(page, 'ar'));
  await page.evaluate(() => document.querySelector('.cbx-switch [data-mode=showcase]').click());
  await waitFor(page, () => window.__cbx.mode === 'showcase' && !document.querySelector('.cbx-switch.busy'), null, T);
  await sleep(2500);
  log('back in 3D boxes', JSON.stringify(await boxes(page)), 'programs', await programs(page, 'showcase'));
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
