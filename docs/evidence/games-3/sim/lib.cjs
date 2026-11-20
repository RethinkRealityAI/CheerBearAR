// games-3 simulator helpers: the wow-2 helpers (launch, shots, synthetic flicks) plus a page-side "autopilot" that
// drives Cheer Bear to the nearest Heart Run pickup (showcase: the keyboard stick; AR: the HUD joystick's vector).
const wow = require('../../wow-2/sim/lib.cjs');

/** Start the page-side driver (runs every 50 ms until stopDriver). */
function startDriver(page, which) {
  return page.evaluate((which) => {
    const I = window.__cb.internals();
    const THREE = window.THREE;
    const t = new THREE.Vector3();
    const stage = I.stages[which];
    const mode = I.modes.get(which);
    window.__drive = setInterval(() => {
      const g = I.play.game;
      const vec = which === 'showcase' ? mode.keys.vector : mode.stick?.vector;
      if (!vec) return;
      const set = (x, y) => { if (vec.set) vec.set(x, y); else { vec.x = x; vec.y = y; } };
      if (!g || g.state !== 'playing' || !g.nearest || !g.nearest(t)) { set(0, 0); return; }
      const a = stage.actor.position;
      const dx = t.x - a.x, dz = t.z - a.z, l = Math.hypot(dx, dz) || 1;
      const f = stage.camDir.clone().setY(0).normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const sx = (dx / l) * r.x + (dz / l) * r.z, sy = -((dx / l) * f.x + (dz / l) * f.z);
      set(sx, sy);
    }, 50);
  }, which);
}
function stopDriver(page) {
  return page.evaluate(() => clearInterval(window.__drive));
}
const play = (page) => page.evaluate(() => {
  const s = window.__cb.debug().play;
  const g = window.__cb.internals().play.game;
  return { ...s, hearts: g?.hearts, rainbows: g?.rainbows, stars: g?.stars, drops: g?.drops, live: g?.live, made: g?.made, thrown: g?.thrown, swishes: g?.swishes };
});

module.exports = { ...wow, startDriver, stopDriver, play };
