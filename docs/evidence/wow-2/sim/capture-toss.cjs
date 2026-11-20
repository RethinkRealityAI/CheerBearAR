// Heart toss film for Dapo: the showcase is stepped frame by frame at a fixed 1/30 s (the headless GPU is too slow
// for real time), each frame is screenshotted, then ffmpeg makes an MP4 and a JPEG strip.
//   BASE=http://localhost:5194 OUT=<dir> node capture-toss.cjs
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { launch, sleep, waitFor, BASE, OUT } = require('./lib.cjs');
(async () => {
  const dir = path.join(OUT, 'toss-frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page } = await launch({ phone: true });
  await page.goto(`${BASE}/experience-dev.html?clean&test`, { waitUntil: 'load' });
  await waitFor(page, () => { const b = document.querySelector('.cbx-start'); return b && !b.disabled; }, null, 240000);
  await page.click('.cbx-start');
  await waitFor(page, () => window.__cb.started && window.__cb.debug().entered, null, 240000);
  await waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  await sleep(6000); // let the hints pass
  await waitFor(page, () => !window.__cb.debug().moment.showcase, null, 240000);
  // take over the clock
  await page.evaluate(() => {
    const sc = window.__cb.internals().showcase;
    sc.renderer.setAnimationLoop(null);
    window.__step = () => { sc.last = performance.now() - 1000 / 30; sc.loop(); };
  });
  // throws: [frame, power, side]; one sideways miss, one too short
  const plan = new Map([[6, [0.55, 0]], [40, [0.62, 0.15]], [72, [0.5, -0.2]], [104, [0.58, 0.05]], [136, [0.25, 0.5]], [176, [0.6, -0.05]], [208, [0.56, 0.1]]]);
  const N = 270;
  for (let f = 0; f < N; f++) {
    if (plan.has(f)) await page.evaluate(([p, s]) => window.__cb.internals().showcase.throwHeart(p, s), plan.get(f));
    await page.evaluate(() => window.__step());
    await page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
  }
  const t = await page.evaluate(() => { const x = window.__cb.internals().showcase.toss; return { thrown: x.thrown, caught: x.caught, best: x.best }; });
  console.log('toss', JSON.stringify(t));
  await browser.close();
  const mp4 = path.join(OUT, 'heart-toss-3d.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, 'f%04d.jpg'), '-vf', 'scale=390:844', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', mp4]);
  // strip: 9 frames across the first throw and catch
  const strip = path.join(OUT, 'heart-toss-3d-strip.jpg');
  const pick = [7, 11, 15, 19, 23, 27, 30, 34, 42].map((i) => path.join(dir, `f${String(i).padStart(4, '0')}.jpg`));
  const args = ['-y', '-loglevel', 'error'];
  for (const p of pick) args.push('-i', p);
  args.push('-filter_complex', pick.map((_, i) => `[${i}]crop=390:560:0:150,scale=195:280[v${i}]`).join(';') + ';' + pick.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${pick.length}`, '-q:v', '4', strip);
  execFileSync('ffmpeg', args);
  console.log('wrote', mp4, strip);
})().catch((e) => { console.error(e); process.exit(1); });
