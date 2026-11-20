// camera-5 3D Photo: welcome sheet, selfie, place (steady gate), tap photo, review chips restyle, Retake, hold video.
// node photo.cjs [w h tag]
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const S = __dirname;
const OUT = process.env.OUT || path.join(S, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const W = +process.argv[2] || 390, H = +process.argv[3] || 844, TAG = process.argv[4] || 'p';
const T = 300000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `photo-${TAG}-${n}.jpg`), type: 'jpeg', quality: 62 });
const click = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
const clickText = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text && x.offsetParent);
  if (!b) throw new Error('no button ' + text); b.click();
}, text);
const st = (page) => page.evaluate(() => { const m = window.__cb.internals().modes.get('photo'); const d = m.diag; return { state: m.state, cam: m.camera, frame: m.frame, filter: m.filter, shots: d.shots, clips: d.clips, welcomed: d.welcomed, restyles: d.restyles, selfies: d.selfies, programs: window.__cb.debug().enginePrograms }; });
async function saveBlob(page, key, name) {
  const r = await page.evaluate(async (key) => {
    const b = window.__cb.internals().modes.get('photo').diag[key]; if (!b) return null;
    const buf = new Uint8Array(await b.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type: b.type, size: b.size };
  }, key);
  if (!r) return null;
  const p = path.join(OUT, name + (r.type.includes('mp4') ? '.mp4' : r.type.includes('webm') ? '.webm' : '.jpg'));
  fs.writeFileSync(p, Buffer.from(r.b64, 'base64'));
  return { p, type: r.type, size: r.size };
}
(async () => {
  const { browser, page, logs } = await launch({ phone: W < 900, w: W, h: H, cams: { user: S + '/../capture2/face.webm', environment: S + '/../capture2/floor.webm' } });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await waitFor(page, () => window.__cb.internals().modes.get('photo')?.constructor?.name === 'PhotoMode', null, T);
  await sleep(1200);
  await page.click('.cbx-switch [data-mode=photo]');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'photo' && d.entered; }, null, T);
  await waitFor(page, () => !!document.querySelector('.cbx-sheet .cbc-welcome'), null, 60000);
  await sleep(1500);
  await shot(page, '01-welcome');
  log('welcome', JSON.stringify(await st(page)));
  await clickText(page, 'Let’s go');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').faceFound, null, 120000);
  await sleep(2000);
  await shot(page, '02-selfie');
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').diag.selfies >= 1, null, 60000);
  await sleep(900);
  await shot(page, '03-selfie-taken');
  await page.click('text=Meet Cheer Bear');
  await sleep(600);
  await shot(page, '04-flip-toast');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placing', null, T);
  await sleep(300);
  log('placing (gate) ', JSON.stringify(await page.evaluate(() => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return { disabled: b && b.disabled, text: b && b.textContent }; })));
  await waitFor(page, () => window.__cb.debug().settled, null, T);
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(1500);
  await shot(page, '05-placing');
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2500);
  await shot(page, '06-placed');
  const p0 = (await st(page)).programs;
  // tap = photo
  const sh = await page.$('.cbx-slot-centre .cbx-shutter');
  const box = await sh.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(1000);
  await shot(page, '07-review');
  log('photo', JSON.stringify(await saveBlob(page, 'lastPhoto', `photo-${TAG}-photo`)), JSON.stringify(await st(page)));
  // review chips: Hearts + Candy
  await page.evaluate(() => document.querySelector('.cbc-review .cbc-chip[data-id="hearts"]').click());
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.cbc-review .cbc-chip[data-id="candy"]').click());
  await sleep(1500);
  await shot(page, '08-review-hearts-candy');
  log('restyled', JSON.stringify(await st(page)));
  await clickText(page, 'Retake');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, 20000);
  await sleep(800);
  // hold = video
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(2500);
  await shot(page, '09-recording');
  log('recording', JSON.stringify(await st(page)));
  await sleep(2500);
  await page.mouse.up();
  await waitFor(page, () => !!document.querySelector('.cbc-review video'), null, 30000);
  await sleep(2500);
  await shot(page, '10-review-video');
  log('video el', JSON.stringify(await page.evaluate(() => { const v = document.querySelector('.cbc-review video'); return { t: v.currentTime, paused: v.paused, dur: v.duration, w: v.videoWidth, h: v.videoHeight, ready: v.readyState }; })));
  log('clip', JSON.stringify(await saveBlob(page, 'lastClip', `photo-${TAG}-clip`)));
  await clickText(page, 'Retake');
  await sleep(1500);
  log('after', JSON.stringify(await st(page)), 'programs before/after', p0);
  await page.click('.cbx-switch [data-mode=showcase]');
  await sleep(3000);
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
