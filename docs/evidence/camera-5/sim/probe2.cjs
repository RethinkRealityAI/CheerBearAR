// compare the engine screenshot with the canvas as drawn (grabbed in onRender), 3D Photo placed
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor, errorsOf, BASE } = require('./lib.cjs');
const S = __dirname, OUT = path.join(S, 'shots');
const T = 300000;
const click = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
(async () => {
  const { browser, page, logs } = await launch({ phone: true, w: 390, h: 844, cams: { user: S + '/../capture2/face.webm', environment: S + '/../capture2/floor.webm' } });
  await page.goto(`${BASE}/experience-dev.html?clean&test&desktop`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, T);
  await page.click('.cbx-start');
  await waitFor(page, () => { const d = window.__cb.debug(); return d.mode === 'showcase' && d.entered; }, null, T);
  await sleep(1200);
  await page.click('.cbx-switch [data-mode=photo]');
  await waitFor(page, () => !!document.querySelector('.cbx-sheet .cbc-welcome'), null, 60000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Let’s go').click());
  await waitFor(page, () => window.__cb.internals().modes.get('photo').faceFound, null, 120000);
  await sleep(1500);
  await click(page, '.cbx-slot-centre .cbx-shutter');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').diag.selfies >= 1, null, 60000);
  await page.click('text=Meet Cheer Bear');
  await waitFor(page, () => { const b = document.querySelector('.cbx-slot-centre .cbx-pill'); return window.__cb.internals().modes.get('photo').state === 'placing' && b && !b.disabled; }, null, T);
  await click(page, '.cbx-slot-centre .cbx-pill');
  await waitFor(page, () => window.__cb.internals().modes.get('photo').state === 'placed', null, T);
  await sleep(2500);
  const r = await page.evaluate(async () => {
    const { recorder } = await import('/src/experience/capture/recorder.ts');
    const c = document.querySelector('canvas.cbx-xr');
    const info = { w: c.width, h: c.height, css: [c.clientWidth, c.clientHeight], style: c.getAttribute('style') };
    const grab = await new Promise((res) => {
      const orig = recorder.frame.bind(recorder);
      recorder.frame = (src) => { const k = document.createElement('canvas'); k.width = src.width; k.height = src.height; k.getContext('2d').drawImage(src, 0, 0); recorder.frame = orig; res(k.toDataURL('image/jpeg', 0.8)); };
    });
    const ss = await window.XR8.CanvasScreenshot.takeScreenshot();
    const im = new Image(); im.src = 'data:image/jpeg;base64,' + ss; await im.decode();
    info.shot = [im.naturalWidth, im.naturalHeight];
    return { info, grab, ss };
  });
  console.log(JSON.stringify(r.info));
  fs.writeFileSync(path.join(OUT, 'probe-grab.jpg'), Buffer.from(r.grab.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'probe-shot.jpg'), Buffer.from(r.ss, 'base64'));
  await page.screenshot({ path: path.join(OUT, 'probe-page.jpg'), type: 'jpeg', quality: 60 });
  console.log('ERRORS:\n' + errorsOf(logs).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
