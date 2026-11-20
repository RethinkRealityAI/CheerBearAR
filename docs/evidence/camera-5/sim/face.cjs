// camera-5 Selfie: live chips (frame + filter), photo baked, hold = video, review, Just me.
// node face.cjs [w h tag]
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const S = __dirname;
const OUT = process.env.OUT || path.join(S, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const W = +process.argv[2] || 390, H = +process.argv[3] || 844, TAG = process.argv[4] || 'p';
const T = 240000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `face-${TAG}-${n}.jpg`), type: 'jpeg', quality: 62 });
const fm = (page) => page.evaluate(() => { const m = window.__cb.internals().modes.get('face'); return { state: m.state, look: m.look, frame: m.frame, filter: m.filter, shots: m.diag.shots, clips: m.diag.clips, found: m.faceFound }; });
async function saveBlob(page, expr, name) {
  const r = await page.evaluate(async (expr) => {
    const b = eval(expr); if (!b) return null;
    const buf = new Uint8Array(await b.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type: b.type, size: b.size };
  }, expr);
  if (!r) return null;
  const p = path.join(OUT, name + (r.type.includes('mp4') ? '.mp4' : r.type.includes('webm') ? '.webm' : '.jpg'));
  fs.writeFileSync(p, Buffer.from(r.b64, 'base64'));
  return { p, type: r.type, size: r.size };
}
(async () => {
  const cam = S + '/../capture2/face.webm';
  const phone = W < 900;
  const { browser, page, logs } = await launch({ phone, w: W, h: H, cams: { user: cam, environment: cam } });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(1500);
  await page.click('.cbx-switch [data-mode=face]');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'face' && d.entered; }, null, T);
  await waitFor(page, () => window.__cb.internals().modes.get('face').faceFound, null, 120000);
  await sleep(2500);
  log('live', JSON.stringify(await fm(page)), 'programs', await page.evaluate(() => window.__cb.debug().enginePrograms));
  await shot(page, '01-live-rainbow');
  // tap chips for real: Hearts + Candy
  const tapChip = async (id) => { await page.evaluate((id) => document.querySelector(`.cbc-chipc[data-id="${id}"]`).click(), id); await sleep(900); };
  await tapChip('hearts'); await tapChip('candy');
  log('after chips', JSON.stringify(await fm(page)), 'canvas filter', await page.evaluate(() => document.querySelector('canvas.cbx-xr').style.filter));
  await shot(page, '02-live-hearts-candy');
  await tapChip('clouds'); await tapChip('mono');
  await shot(page, '03-live-clouds-mono');
  // photo: shutter tap (countdown), tap again to shoot now
  const sh = await page.$('.cbx-slot-centre .cbx-shutter');
  const box = await sh.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(1200);
  await shot(page, '04-countdown');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(800);
  await shot(page, '05-review-photo');
  log('photo', JSON.stringify(await saveBlob(page, "window.__cb.internals().modes.get('face').diag.lastPhoto", `face-${TAG}-photo`)));
  await page.evaluate(() => [...document.querySelectorAll('.cbc-review button')].find((b) => b.textContent.trim() === 'Retake').click());
  await waitFor(page, () => window.__cb.internals().modes.get('face').state === 'live', null, 10000);
  await tapChip('rainbow'); await tapChip('warm');
  // hold = video: press 4.5 s
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(2500);
  await shot(page, '06-recording');
  log('recording', JSON.stringify(await fm(page)), JSON.stringify(await page.evaluate(() => window.__cbRec && window.__cbRec.diag)));
  await sleep(2500);
  await page.mouse.up();
  await waitFor(page, () => !!document.querySelector('.cbc-review video'), null, 30000);
  await sleep(2500);
  await shot(page, '07-review-video');
  const vstate = await page.evaluate(() => { const v = document.querySelector('.cbc-review video'); return { t: v.currentTime, paused: v.paused, dur: v.duration, w: v.videoWidth, h: v.videoHeight, ready: v.readyState }; });
  log('video el', JSON.stringify(vstate));
  log('clip', JSON.stringify(await saveBlob(page, "window.__cb.internals().modes.get('face').diag.lastClip", `face-${TAG}-clip`)));
  await page.evaluate(() => [...document.querySelectorAll('.cbc-review button')].find((b) => b.textContent.trim() === 'Retake').click());
  await sleep(800);
  // Just me
  await page.evaluate(() => [...document.querySelectorAll('.cbc-seg button')].find((b) => b.textContent.trim() === 'Just me').click());
  await sleep(1500);
  await shot(page, '08-just-me');
  log('just me', JSON.stringify(await fm(page)), 'programs', await page.evaluate(() => window.__cb.debug().enginePrograms));
  // back to 3D
  await page.evaluate(() => [...document.querySelectorAll('.cbc-seg button')].find((b) => b.textContent.trim() === '3D bear').click());
  await sleep(1000);
  await page.click('.cbx-switch [data-mode=showcase]');
  await sleep(4000);
  log('canvas filter after leaving', await page.evaluate(() => document.querySelector('canvas.cbx-xr')?.style.filter));
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
