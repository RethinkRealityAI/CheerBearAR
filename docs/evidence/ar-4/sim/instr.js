// Page-side frame instrumentation for the AR engine renderer (ar-4). Injected by probe.cjs before AR starts.
// Per engine frame: interval, JS update time, three render time, draw calls, triangles, shader compiles/links,
// texture uploads made by three (render + initTexture; the engine's own camera upload is not counted), programs.
(() => {
  if (window.__m) return;
  const eng = window.__cb.internals().engine;
  const S = { frames: [], cur: null, tag: '', path: null, inThree: false, hooked: new WeakSet(), glHooked: false };
  const kindOf = (a) => {
    const src = a[a.length - 1];
    if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return 'video';
    if (src instanceof HTMLCanvasElement) return 'canvas';
    if ((typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) || src instanceof HTMLImageElement) return 'image';
    return 'data';
  };
  function newFrame(t) {
    const prev = S.cur;
    const f = { t, dt: prev ? t - prev.t : 0, js: 0, render: 0, calls: 0, tris: 0, comp: 0, link: 0, up: {}, tag: S.tag, programs: 0, tex: 0, track: eng.tracking, settled: false };
    S.cur = f;
    S.frames.push(f);
    if (S.frames.length > 20000) S.frames.shift();
    return f;
  }
  function hookGl(gl) {
    if (S.glHooked) return;
    S.glHooked = true;
    const wrap = (name, fn) => { const o = gl[name].bind(gl); gl[name] = (...a) => { fn(a); return o(...a); }; };
    wrap('compileShader', () => { if (S.cur) S.cur.comp++; });
    wrap('linkProgram', () => { if (S.cur) S.cur.link++; });
    for (const n of ['texImage2D', 'texSubImage2D', 'texStorage2D', 'compressedTexImage2D']) {
      wrap(n, (a) => { if (!S.inThree || !S.cur) return; const k = n === 'texStorage2D' ? 'alloc' : kindOf(a); S.cur.up[k] = (S.cur.up[k] || 0) + 1; });
    }
  }
  function hookRenderer(r) {
    if (S.hooked.has(r)) return;
    S.hooked.add(r);
    hookGl(r.getContext());
    const orender = r.render.bind(r);
    r.render = (s, c) => {
      S.inThree = true;
      const t0 = performance.now();
      try { orender(s, c); } finally {
        S.inThree = false;
        const f = S.cur;
        if (f) { f.render += performance.now() - t0; f.calls += r.info.render.calls; f.tris += r.info.render.triangles; f.programs = r.info.programs?.length ?? 0; f.tex = r.info.memory.textures; }
      }
    };
    const oinit = r.initTexture.bind(r);
    r.initTexture = (t) => { S.inThree = true; try { oinit(t); } finally { S.inThree = false; } };
    const ocomp = r.compile.bind(r);
    r.compile = (...a) => { S.inThree = true; try { return ocomp(...a); } finally { S.inThree = false; } };
  }
  const osetup = eng.setup;
  eng.setup = function (xr) { newFrame(performance.now()).tag = 'setup'; hookRenderer(xr.renderer); return osetup.call(this, xr); };
  if (eng.xr) hookRenderer(eng.xr.renderer);
  const oup = eng.hooks.onUpdate;
  eng.hooks.onUpdate = (dt, now) => {
    const f = newFrame(performance.now());
    f.settled = eng.settled();
    const ar = window.__cb.internals().modes.get('ar');
    if (S.path && ar?.walk) ar.walk.testPose = S.path(performance.now());
    const t0 = performance.now();
    S.inThree = true; // three uploads inside the mode updates (none expected) count too
    try { oup(dt, now); } finally { S.inThree = false; f.js = performance.now() - t0; }
  };
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  window.__m = {
    S,
    tag(t) { S.tag = t; },
    walk(fn) { S.path = fn; },
    summary(tag) {
      const fs = S.frames.filter((f) => f.tag === tag && f.dt > 0);
      const dts = fs.map((f) => f.dt), med = q(dts, 0.5);
      const up = {};
      for (const f of fs) for (const [k, v] of Object.entries(f.up)) up[k] = (up[k] || 0) + v;
      const r1 = (v) => Math.round(v * 10) / 10;
      return {
        tag, frames: fs.length,
        dtP50: r1(med), dtP95: r1(q(dts, 0.95)), dtMax: r1(Math.max(0, ...dts)),
        renderP50: r1(q(fs.map((f) => f.render), 0.5)), jsP50: r1(q(fs.map((f) => f.js), 0.5)), jsP95: r1(q(fs.map((f) => f.js), 0.95)),
        calls: Math.round(q(fs.map((f) => f.calls), 0.5)), callsMax: Math.max(0, ...fs.map((f) => f.calls)),
        tris: Math.round(q(fs.map((f) => f.tris), 0.5)),
        compiles: fs.reduce((s, f) => s + f.comp, 0), links: fs.reduce((s, f) => s + f.link, 0), uploads: up,
        stalls: fs.filter((f) => f.dt > Math.max(250, med * 2.5)).length,
        programs: fs.length ? fs[fs.length - 1].programs : 0, textures: fs.length ? fs[fs.length - 1].tex : 0,
      };
    },
    /** Compile / upload events with their time relative to the first frame and the tracking state then. */
    events() {
      const t0 = S.frames[0]?.t ?? 0;
      return S.frames.filter((f) => f.comp || f.link || Object.keys(f.up).some((k) => k !== 'video')).map((f) => ({ s: Math.round((f.t - t0) / 100) / 10, tag: f.tag, comp: f.comp, link: f.link, up: f.up, track: f.track, settled: f.settled }));
    },
  };
})();
