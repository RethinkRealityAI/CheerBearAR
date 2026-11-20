// 3D Photo run (fake floor camera + fake IMU, ?desktop): 3D -> Photo -> settle -> Place -> poses -> capture -> review ->
// retake -> Move (keeps pose + size) -> Place -> capture -> Photo -> Selfie -> Photo -> 3D.
//   node docs/evidence/xr-capture/sim/photo.cjs /path/to/floor.y4m
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
  return { state: m.state, pose: m.pose, size: +m.size.toFixed(2), anchorVisible: m.anchor.visible, diag: { ...m.diag, lastPhoto: m.diag.lastPhoto ? m.diag.lastPhoto.size : 0 } };
});
const programs = (page) => page.evaluate(() => window.__cb.debug().enginePrograms);

async function savePhoto(page, name) {
  const b64 = await page.evaluate(async () => {
    const b = window.__cb.internals().modes.get('photo').diag.lastPhoto;
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const p = path.join(OUT, name + '.jpg');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

async function shoot(page) {
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => !!document.querySelector('.cbc-review img'), null, 60000);
  await sleep(600);
}

(async () => {
  const video = process.argv[2] || path.join(__dirname, 'floor.y4m');
  const { browser, page, logs } = await launch({ phone: true, video });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-start');
  await modeIs(page, 'showcase');
  await waitFor(page, () => window.__cb.internals().modes.get('photo')?.constructor?.name === 'PhotoMode', null, T);
  log('showcase live, real photo mode loaded');
  await sleep(1500);

  await click(page, '.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  log('photo live', JSON.stringify(await photo(page)));
  await sleep(800);
  await shot(page, 'photo-01-finding-floor');
  await waitFor(page, () => window.__cb.debug().settled, null, T);
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await sleep(2500);
  await shot(page, 'photo-02-placing');
  // pinch: simulate by calling the gesture path (two pointers apart)
  await page.evaluate(() => {
    const c = document.querySelector('canvas.cbx-xr');
    const o = (id, x, y) => ({ pointerId: id, bubbles: true, isPrimary: id === 21, pointerType: 'touch', clientX: x, clientY: y });
    c.dispatchEvent(new PointerEvent('pointerdown', o(21, 150, 500)));
    c.dispatchEvent(new PointerEvent('pointerdown', o(22, 240, 500)));
    c.dispatchEvent(new PointerEvent('pointermove', o(22, 260, 500)));
    c.dispatchEvent(new PointerEvent('pointermove', o(22, 280, 500)));
    c.dispatchEvent(new PointerEvent('pointerup', o(22, 280, 500)));
    c.dispatchEvent(new PointerEvent('pointerup', o(21, 150, 500)));
  });
  log('after pinch', JSON.stringify(await photo(page)));
  const p0 = await programs(page);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2500);
  await shot(page, 'photo-03-placed-frame');
  log('placed; programs', p0, '->', await programs(page), JSON.stringify(await photo(page)));

  await shoot(page);
  await shot(page, 'photo-04-review');
  log('photo 1', await savePhoto(page, 'photo-photo-1-frame'), 'programs', await programs(page));
  await clickText(page, 'Retake');

  await clickText(page, 'Wave');
  await sleep(2500);
  await shot(page, 'photo-05-pose-wave');
  log('wave; programs', await programs(page));
  await clickText(page, 'Cheer');
  await sleep(2500);
  await shot(page, 'photo-06-pose-cheer');
  await shoot(page);
  log('photo 2', await savePhoto(page, 'photo-photo-2-cheer'), 'programs', await programs(page));
  await clickText(page, 'Retake');
  log('trigger Dance ->', await page.evaluate(() => window.__cb.trigger('Dance')));

  // Move keeps pose and size
  const before = await photo(page);
  await click(page, '.cbx-slot-left .cbx-tool');
  await sleep(1500);
  await shot(page, 'photo-07-move');
  const during = await photo(page);
  log('move: before', JSON.stringify(before), 'during', JSON.stringify(during));
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return b && !b.disabled; }, null, T);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await sleep(1000);
  log('placed again', JSON.stringify(await photo(page)), 'Move present', await page.evaluate(() => !!document.querySelector('.cbx-slot-left .cbx-tool')));
  await shoot(page);
  log('photo 3; programs', await programs(page), '(placed:', p0 + ')');
  await clickText(page, 'Retake');

  // Photo -> Selfie -> Photo -> 3D
  await click(page, '.cbx-switch [data-mode=face]');
  await modeIs(page, 'face');
  await sleep(2500);
  log('photo -> face', JSON.stringify(await photo(page)));
  await click(page, '.cbx-switch [data-mode=photo]');
  await modeIs(page, 'photo');
  await sleep(1500);
  log('face -> photo', JSON.stringify(await photo(page)));
  await click(page, '.cbx-switch [data-mode=showcase]');
  await modeIs(page, 'showcase');
  await sleep(1000);
  log('3D; leftovers', await page.evaluate(() => document.querySelectorAll('.cbc-overlay,.cbc-review,.cbc-player,.cbc-seg').length),
    'videos', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => [(v.currentSrc || '').split('/').pop(), v.paused]))));
  log('engine', JSON.stringify((await page.evaluate(() => window.__cb.debug())).engine?.engine));
  const errs = errorsOf(logs);
  log('errors', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
