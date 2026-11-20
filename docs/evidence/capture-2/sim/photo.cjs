// 3D Photo run (round 2): FRONT camera = a face photo, BACK camera = the floor clip, in ONE run and one engine session
// (lib.cjs `cams`: getUserMedia plays the file for the facingMode the engine asks for), fake IMU, `?desktop`.
//   3D -> Photo (front): guide oval, ears on the face, selfie (cropped round the head) -> "Meet Cheer Bear" (flip to the
//   back camera) -> settle -> pinch -> Place -> she holds the frame with the selfie, facing you -> tap her (hop +
//   hearts) -> shutter -> review -> Retake -> "Selfie" (flip to front) -> new selfie -> "Back to Cheer Bear" -> she is
//   restored relative to the phone with the new selfie, same size -> Move -> Place -> Photo -> Selfie mode -> Photo
//   (opens on the back camera: she is waiting) -> 3D.
//   node docs/evidence/capture-2/sim/photo.cjs <face.webm> <floor.webm>
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep, waitFor, errorsOf, BASE, OUT } = require('./lib.cjs');

const T = 300000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('.cbx button')].find((x) => x.textContent.trim() === text && x.offsetParent);
  if (!b) throw new Error('no button ' + text);
  b.click();
}, text);
const modeIs = (page, m) => waitFor(page, (m) => { const d = window.__cb.debug(); return d.mode === m && d.entered; }, m, T);
const photo = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('photo');
  const d = { ...m.diag };
  d.lastPhoto = d.lastPhoto ? d.lastPhoto.size : 0;
  d.lastSelfie = d.lastSelfie ? d.lastSelfie.size : 0;
  const a = m.anchor;
  return {
    state: m.state, camera: m.camera, size: +m.size.toFixed(2), anchorVisible: a.visible, found: m.faceFound,
    at: [+a.position.x.toFixed(2), +a.position.z.toFixed(2), +a.rotation.y.toFixed(2)], diag: d,
    frameTex: m.selfieMat.map?.uuid?.slice(0, 8), asks: window.__simcam?.asks,
  };
});
const programs = (page) => page.evaluate(() => window.__cb.debug().enginePrograms);

async function saveBlob(page, key, name) {
  const b64 = await page.evaluate(async (key) => {
    const b = window.__cb.internals().modes.get('photo').diag[key];
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, key);
  const p = path.join(OUT, name + '.jpg');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

/** Where Cheer Bear's frame centre is on screen (CSS px). */
const bearOnScreen = (page) => page.evaluate(() => {
  const m = window.__cb.internals().modes.get('photo');
  const cam = window.__cb.internals().engine.xr.camera;
  const THREE = window.THREE;
  const p = new THREE.Vector3(0.1, 0.6, 0.1);
  m.framed.localToWorld(p);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  p.project(cam);
  const r = document.querySelector('canvas.cbx-xr').getBoundingClientRect();
  return [Math.round((p.x + 1) / 2 * r.width), Math.round((1 - p.y) / 2 * r.height)];
});

async function tapAt(page, x, y) {
  await page.evaluate(([x, y]) => {
    const c = document.querySelector('canvas.cbx-xr');
    const o = { pointerId: 7, bubbles: true, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  }, [x, y]);
}

async function placeHere(page, tag) {
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placing', null, T);
  await waitFor(page, () => window.__cb.debug().settled, null, T);
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(2000);
  await shot(page, `photo-${tag}-placing`);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
}

(async () => {
  const face = process.argv[2] || path.join(__dirname, 'face.webm');
  const floor = process.argv[3] || path.join(__dirname, 'floor.webm');
  const { browser, page, logs } = await launch({ phone: true, cams: { user: face, environment: floor } });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('photo')?.constructor?.name === 'PhotoMode', null, T);
  log('showcase live, real photo mode loaded');
  await sleep(1200);

  // ---- front camera: the selfie
  await page.click('.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  log('photo live', JSON.stringify(await photo(page)));
  await waitFor(page, () => window.__cb.internals().modes.get('photo').faceFound, null, 120000);
  await sleep(2000);
  await shot(page, 'photo-01-selfie-guide');
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').diag.selfies === 1, null, 60000);
  await sleep(900);
  await shot(page, 'photo-02-selfie-taken');
  log('selfie', await saveBlob(page, 'lastSelfie', 'photo-selfie-1'), JSON.stringify(await photo(page)));
  const p0 = await programs(page);

  // ---- flip: Meet Cheer Bear (a real tap)
  await page.click('text=Meet Cheer Bear');
  await sleep(300);
  await shot(page, 'photo-03-flipping');
  await placeHere(page, '04');
  // pinch a little bigger
  await page.evaluate(() => {
    const c = document.querySelector('canvas.cbx-xr');
    const o = (id, x, y) => ({ pointerId: id, bubbles: true, isPrimary: id === 21, pointerType: 'touch', clientX: x, clientY: y });
    c.dispatchEvent(new PointerEvent('pointerdown', o(21, 150, 500)));
    c.dispatchEvent(new PointerEvent('pointerdown', o(22, 240, 500)));
    c.dispatchEvent(new PointerEvent('pointermove', o(22, 255, 500)));
    c.dispatchEvent(new PointerEvent('pointermove', o(22, 262, 500)));
    c.dispatchEvent(new PointerEvent('pointerup', o(22, 262, 500)));
    c.dispatchEvent(new PointerEvent('pointerup', o(21, 150, 500)));
  });
  await sleep(2500);
  await shot(page, 'photo-05-placed');
  log('placed', JSON.stringify(await photo(page)), 'programs', p0, '->', await programs(page));
  // tap her
  const [bx, by] = await bearOnScreen(page);
  await tapAt(page, bx, by);
  await sleep(450);
  await shot(page, 'photo-06-tap-reaction');
  log('tap at', bx, by, 'reactions', (await photo(page)).diag.reactions);
  await sleep(1200);
  // the room photo
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(700);
  await shot(page, 'photo-07-review');
  log('room photo', await saveBlob(page, 'lastPhoto', 'photo-photo-1-room'), 'programs', await programs(page));
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, 10000);
  const before = await photo(page);

  // ---- flip back for a new selfie, then back to her
  await page.click('.cbx-slot-left button[aria-label^="Flip"]');
  await waitFor(page, () => { const m = window.__cb.internals().modes.get('photo'); return m.state === 'selfie' && m.camera === 'face'; }, null, T);
  await waitFor(page, () => window.__cb.internals().modes.get('photo').faceFound, null, 120000);
  await sleep(1500);
  await shot(page, 'photo-08-front-again');
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').diag.selfies === 2, null, 60000);
  await sleep(600);
  await saveBlob(page, 'lastSelfie', 'photo-selfie-2');
  await page.click('text=Back to Cheer Bear');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2500);
  await shot(page, 'photo-09-restored-new-selfie');
  const after = await photo(page);
  log('before flip', JSON.stringify({ size: before.size, at: before.at, tex: before.frameTex }));
  log('after 2 flips', JSON.stringify({ size: after.size, at: after.at, tex: after.frameTex, restored: after.diag.restored, flips: after.diag.flipMs, asks: after.asks }));

  // ---- Move keeps size and selfie
  await clickText(page, 'Move');
  await placeHere(page, '10');
  await sleep(1500);
  await shot(page, 'photo-11-moved');
  log('after move', JSON.stringify(await photo(page)));

  // ---- Photo -> Selfie mode -> Photo (back camera: she is waiting) -> 3D
  await page.click('.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await sleep(2500);
  await page.click('.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  log('photo again', JSON.stringify(await photo(page)));
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2000);
  await shot(page, 'photo-12-photo-again');
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  log('room photo 2', await saveBlob(page, 'lastPhoto', 'photo-photo-2-room'), 'programs', await programs(page), '(after first selfie:', p0 + ')');
  await clickText(page, 'Retake');
  await page.click('.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(1200);
  log('3D; left over', await page.evaluate(() => document.querySelectorAll('.cbc-review,.cbc-player,.cbc-guide,.cbc-thumb').length), 'engine', JSON.stringify((await page.evaluate(() => window.__cb.debug())).engine?.engine));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
