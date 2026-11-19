// /lab/lipsync: the lip sync test bench. Bear close up, audio inputs (sample, synthetic speech, microphone, your
// own file), a "phone quality" switch that turns any input into 8 kHz / 300-3400 Hz call audio, live viseme bars,
// a shape test that sweeps every blend shape to full weight, tuning sliders, and buttons for clips and expressions.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import '../../shared/theme.css';
import { loadBear, unlockAudio } from '..';
import type { Bear } from '../Bear';
import type { BearClip, BearExpression, Viseme } from '../../shared/contracts';
import { VISEMES } from '../../shared/contracts';
import { getAudioContext } from '../../audio/context';
import { DEFAULT_LIPSYNC_CONFIG, LIPSYNC_CONFIG_RANGES, phoneBandFilter, renderPhoneBand, type LipSyncConfig } from '../../lipsync';
import { SYNTH_SCRIPTS, synthSpeech } from './synth';
import sampleUrl from './test-audio.wav?url';

const CLIPS: BearClip[] = ['idle', 'talkIdle', 'wave', 'walk', 'run', 'dance', 'cheer', 'sway', 'present', 'sleep', 'wakeUp', 'shiver'];
const EXPRS: BearExpression[] = ['neutral', 'happy', 'surprised', 'sleepy', 'cold', 'wink'];
const EXTRA_CLIPS = ['backflip', 'sad', 'angry', 'danceSmall', 'flap'];

type Source = 'none' | 'sample' | 'vowels' | 'syllables' | 'file' | 'mic';

const css = `
.lsl{position:fixed;inset:0;display:grid;grid-template-columns:minmax(0,1fr) 380px;background:var(--cb-cloud);color:var(--cb-ink);font-family:var(--cb-font)}
.lsl-stage{position:relative;min-height:0}
.lsl-stage canvas.lsl-gl{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.lsl-hud{position:absolute;left:12px;top:12px;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.lsl-pill{background:var(--cb-glass);color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;backdrop-filter:var(--cb-blur);-webkit-backdrop-filter:var(--cb-blur);width:max-content;max-width:60vw}
.lsl-shape{font-size:18px;font-weight:600}
.lsl-meters{position:absolute;right:12px;top:12px;background:var(--cb-glass-strong);border-radius:var(--cb-radius-sm);padding:8px}
.lsl-panel{overflow:auto;padding:16px 16px 32px;border-left:1px solid var(--cb-pink-soft);background:var(--cb-white)}
.lsl h1{font-size:20px;margin:0 0 4px}
.lsl h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--cb-ink-soft);margin:18px 0 8px}
.lsl p.lsl-note{font-size:13px;color:var(--cb-ink-soft);margin:0 0 8px;line-height:1.35}
.lsl-row{display:flex;flex-wrap:wrap;gap:6px}
.lsl button{font:inherit;font-size:14px;min-height:36px;padding:0 12px;border-radius:999px;border:1.5px solid var(--cb-pink);background:var(--cb-white);color:var(--cb-pink-deep);cursor:pointer}
.lsl button:hover{background:var(--cb-pink-soft)}
.lsl button.on{background:var(--cb-pink);color:#fff}
.lsl button:disabled{opacity:.45;cursor:default}
.lsl label.lsl-toggle{display:flex;align-items:center;gap:8px;font-size:14px;margin:8px 0;cursor:pointer}
.lsl-slider{display:grid;grid-template-columns:130px 1fr 52px;align-items:center;gap:8px;font-size:12px;margin:3px 0}
.lsl-slider input{width:100%;accent-color:var(--cb-pink)}
.lsl-slider span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.lsl select{font:inherit;font-size:14px;border-radius:var(--cb-radius-sm);border:1.5px solid var(--cb-pink-soft);padding:6px;max-width:100%}
@media (max-width:900px){.lsl{grid-template-columns:1fr;grid-template-rows:56vh auto;position:static;min-height:100vh}.lsl-panel{border-left:0;border-top:1px solid var(--cb-pink-soft)}.lsl-meters{transform:scale(.8);transform-origin:top right}}
`;

declare global {
  interface Window {
    __lab?: Record<string, unknown>;
  }
}

export default function LipSyncLab() {
  const stageRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const bearRef = useRef<Bear | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const camModeRef = useRef<'face' | 'body'>('face');
  const lookRef = useRef(false);
  const micRef = useRef<{ stream: MediaStream; node?: MediaStreamAudioSourceNode; filt?: ReturnType<typeof phoneBandFilter> } | null>(null);
  const sweepRef = useRef<{ names: string[]; i: number; t: number; per: number; kind: 'shape' | 'viseme' } | null>(null);
  const shapeLabelRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading Cheer Bear...');
  const [source, setSource] = useState<Source>('none');
  const [phone, setPhone] = useState(false);
  const [camMode, setCamMode] = useState<'face' | 'body'>('face');
  const [look, setLook] = useState(false);
  const [sweeping, setSweeping] = useState<null | 'shape' | 'viseme'>(null);
  const [shapes, setShapes] = useState<string[]>([]);
  const [holdShape, setHoldShape] = useState('');
  const [cfg, setCfg] = useState<LipSyncConfig>({ ...DEFAULT_LIPSYNC_CONFIG });
  const [clip, setClip] = useState<BearClip>('idle');
  const [expr, setExpr] = useState<BearExpression>('neutral');

  // ---------------------------------------------------------------- scene
  useEffect(() => {
    const host = stageRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.className = 'lsl-gl';
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#fff7fb');
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe8d8ee, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.2, 2.2, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe6f3, 1.2);
    rim.position.set(-2, 1.5, -1.5);
    scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(0.7, 48), new THREE.MeshBasicMaterial({ color: '#ffd6ea' }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    camRef.current = cam;
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let disposed = false;
    loadBear({ onProgress: (p) => setStatus(`Loading Cheer Bear... ${Math.round(p * 100)}%`) })
      .then((b) => {
        if (disposed) return b.dispose();
        const bear = b as Bear;
        bearRef.current = bear;
        scene.add(bear.object);
        setShapes([...bear.face.shapeNames].sort());
        setReady(true);
        setStatus('Ready. Pick an input (tap once to enable sound).');
      })
      .catch((e) => setStatus(`Could not load the bear: ${String(e)}`));

    const pointer = new THREE.Vector2();
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    renderer.domElement.addEventListener('pointermove', onMove);

    const clock = new THREE.Clock();
    const target = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const camAim = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      const bear = bearRef.current;
      // camera framing
      const face = camModeRef.current === 'face';
      camPos.set(0, face ? 0.74 : 0.62, face ? 1.05 : 3.1);
      camAim.set(0, face ? 0.69 : 0.5, 0);
      cam.position.lerp(camPos, 1 - Math.exp(-dt * 6));
      cam.lookAt(camAim);
      if (bear) {
        if (lookRef.current) {
          target.set(pointer.x * 0.8, 0.7 + pointer.y * 0.5, 1.2);
          bear.lookAt(target);
        }
        runSweep(bear, dt);
        bear.update(dt);
        drawMeters(meterRef.current, bear);
      }
      renderer.render(scene, cam);
    });

    return () => {
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      bearRef.current?.dispose();
      bearRef.current = null;
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.dispose();
      renderer.domElement.remove();
      stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- shape / viseme sweep
  const runSweep = (bear: Bear, dt: number) => {
    const s = sweepRef.current;
    if (!s) return;
    s.t += dt;
    if (s.t > s.per) {
      s.t = 0;
      s.i++;
      if (s.i >= s.names.length) {
        sweepRef.current = null;
        bear.face.override = null;
        bear.face.lidOverride = null;
        bear.setVisemes(null);
        if (shapeLabelRef.current) shapeLabelRef.current.textContent = '';
        setSweeping(null);
        return;
      }
    }
    const name = s.names[s.i];
    // ramp 0 -> 1 -> hold, so tearing at any weight is visible
    const w = Math.min(1, s.t / (s.per * 0.35));
    if (s.kind === 'shape') {
      if (name === 'blink (lids)') {
        bear.face.override = {};
        bear.face.lidOverride = w;
      } else {
        bear.face.lidOverride = null;
        bear.face.override = { [name]: w };
      }
    } else {
      bear.setVisemes({ weights: { [name as Viseme]: w }, amplitude: w, speaking: true });
    }
    if (shapeLabelRef.current) shapeLabelRef.current.textContent = `${name}  ${w.toFixed(2)}`;
  };

  const startSweep = useCallback((kind: 'shape' | 'viseme') => {
    const bear = bearRef.current;
    if (!bear) return;
    const names = kind === 'shape' ? [...bear.face.shapeNames].sort().concat(['blink (lids)']) : VISEMES.filter((v) => v !== 'sil');
    sweepRef.current = { names, i: 0, t: 0, per: kind === 'shape' ? 1.1 : 1.2, kind };
    setSweeping(kind);
  }, []);

  const stopSweep = useCallback(() => {
    const bear = bearRef.current;
    sweepRef.current = null;
    if (bear) {
      bear.face.override = null;
      bear.face.lidOverride = null;
      bear.setVisemes(null);
    }
    if (shapeLabelRef.current) shapeLabelRef.current.textContent = '';
    setSweeping(null);
  }, []);

  // ---------------------------------------------------------------- inputs
  const stopMic = () => {
    const m = micRef.current;
    if (!m) return;
    m.stream.getTracks().forEach((t) => t.stop());
    m.node?.disconnect();
    m.filt?.dispose();
    micRef.current = null;
  };

  const stopAll = useCallback(() => {
    const bear = bearRef.current;
    stopMic();
    bear?.setSpeechStream(null);
    setSource('none');
  }, []);

  const playBuffer = useCallback(async (buf: AudioBuffer, src: Source, asPhone: boolean) => {
    const bear = bearRef.current;
    if (!bear) return;
    stopMic();
    const b = asPhone ? await renderPhoneBand(buf) : buf;
    setSource(src);
    setStatus(`${src}: ${asPhone ? 'phone band (8 kHz, 300-3400 Hz)' : 'full band'}, ${b.duration.toFixed(1)} s`);
    await bear.sayBuffer(b);
    setSource((s) => (s === src ? 'none' : s));
  }, []);

  const decodeUrl = async (url: string) => {
    const data = await (await fetch(url)).arrayBuffer();
    return getAudioContext().decodeAudioData(data);
  };

  const playSample = useCallback(async (asPhone = phone) => {
    unlockAudio();
    await playBuffer(await decodeUrl(sampleUrl), 'sample', asPhone);
  }, [phone, playBuffer]);

  const playSynth = useCallback(async (name: 'vowels' | 'syllables', asPhone = phone) => {
    unlockAudio();
    const ctx = getAudioContext();
    const data = synthSpeech(name, ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    await playBuffer(buf, name, asPhone);
  }, [phone, playBuffer]);

  const playFile = useCallback(async (file: File) => {
    unlockAudio();
    const buf = await getAudioContext().decodeAudioData(await file.arrayBuffer());
    await playBuffer(buf, 'file', phone);
  }, [phone, playBuffer]);

  const startMic = useCallback(async () => {
    unlockAudio();
    const bear = bearRef.current;
    if (!bear) return;
    stopAll();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (phone) {
        // Analysis only (not played back), through the live phone-band chain.
        const ctx = getAudioContext();
        const node = ctx.createMediaStreamSource(stream);
        const filt = phoneBandFilter();
        node.connect(filt.input);
        bear.lipSync.attachNode(filt.output);
        micRef.current = { stream, node, filt };
      } else {
        // The same path a call uses: analysed, never played.
        bear.setSpeechStream(stream);
        micRef.current = { stream };
      }
      setSource('mic');
      setStatus(`Microphone (${phone ? 'phone band' : 'full band'}). Talk to her.`);
    } catch (e) {
      setStatus(`Microphone unavailable: ${String(e)}`);
    }
  }, [phone, stopAll]);

  // ---------------------------------------------------------------- tuning
  const setParam = (k: keyof LipSyncConfig, v: number) => {
    setCfg((c) => {
      const n = { ...c, [k]: v } as LipSyncConfig;
      bearRef.current?.lipSync.setConfig({ [k]: v } as Partial<LipSyncConfig>);
      return n;
    });
  };
  const resetCfg = () => {
    setCfg({ ...DEFAULT_LIPSYNC_CONFIG });
    bearRef.current?.lipSync.setConfig({ ...DEFAULT_LIPSYNC_CONFIG });
  };

  // ---------------------------------------------------------------- hooks for headless evidence capture
  useEffect(() => {
    window.__lab = {
      bear: () => bearRef.current,
      playSample: (p: boolean) => playSample(p),
      playSynth: (n: 'vowels' | 'syllables', p: boolean) => playSynth(n, p),
      camera: (m: 'face' | 'body') => {
        camModeRef.current = m;
        setCamMode(m);
        const cam = camRef.current;
        if (cam) cam.position.set(0, m === 'face' ? 0.74 : 0.62, m === 'face' ? 1.05 : 3.1);
      },
      shape: (name: string | null, w = 1) => {
        const b = bearRef.current;
        if (!b) return;
        b.face.override = name ? (name === 'lids' ? {} : { [name]: w }) : null;
        b.face.lidOverride = name === 'lids' ? w : null;
      },
      sweep: (k: 'shape' | 'viseme') => startSweep(k),
    };
    return () => {
      delete window.__lab;
    };
  }, [playSample, playSynth, startSweep]);

  const bear = bearRef.current;
  return (
    <div className="lsl">
      <style>{css}</style>
      <div className="lsl-stage" ref={stageRef}>
        <div className="lsl-hud">
          <div className="lsl-pill">{status}</div>
          <div className="lsl-pill lsl-shape" ref={shapeLabelRef} style={{ display: sweeping ? undefined : 'none' }} />
        </div>
        <canvas className="lsl-meters" ref={meterRef} width={220} height={300} />
      </div>
      <div className="lsl-panel">
        <h1>Lip Sync Lab</h1>
        <p className="lsl-note">Cheer Bear's mouth is driven only by the audio. Switch on phone quality to hear and see what a call gives us.</p>

        <h2>Input</h2>
        <label className="lsl-toggle">
          <input type="checkbox" checked={phone} onChange={(e) => setPhone(e.target.checked)} /> Phone quality (8 kHz, 300-3400 Hz)
        </label>
        <div className="lsl-row">
          <button disabled={!ready} className={source === 'sample' ? 'on' : ''} onClick={() => void playSample()}>Sample voice</button>
          <button disabled={!ready} className={source === 'vowels' ? 'on' : ''} onClick={() => void playSynth('vowels')}>{SYNTH_SCRIPTS.vowels.label}</button>
          <button disabled={!ready} className={source === 'syllables' ? 'on' : ''} onClick={() => void playSynth('syllables')}>{SYNTH_SCRIPTS.syllables.label}</button>
          <button disabled={!ready} className={source === 'mic' ? 'on' : ''} onClick={() => void startMic()}>Microphone</button>
          <button disabled={!ready || source === 'none'} onClick={stopAll}>Stop</button>
        </div>
        <p className="lsl-note" style={{ marginTop: 8 }}>
          Your own file:{' '}
          <input type="file" accept="audio/*" disabled={!ready} onChange={(e) => e.target.files?.[0] && void playFile(e.target.files[0])} />
        </p>

        <h2>Shape test</h2>
        <p className="lsl-note">Ramps every blend shape (and the eyelids) to full weight, one at a time. Nothing should tear.</p>
        <div className="lsl-row">
          <button disabled={!ready} className={sweeping === 'shape' ? 'on' : ''} onClick={() => startSweep('shape')}>Sweep all shapes</button>
          <button disabled={!ready} className={sweeping === 'viseme' ? 'on' : ''} onClick={() => startSweep('viseme')}>Sweep visemes (with jaw)</button>
          <button disabled={!sweeping} onClick={stopSweep}>Stop</button>
        </div>
        <div className="lsl-row" style={{ marginTop: 8 }}>
          <select
            value={holdShape}
            disabled={!ready}
            onChange={(e) => {
              setHoldShape(e.target.value);
              const b = bearRef.current;
              if (b) {
                b.face.override = e.target.value ? { [e.target.value]: 1 } : null;
                b.face.lidOverride = null;
              }
            }}
          >
            <option value="">Hold one shape at 1.0...</option>
            {shapes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <h2>Body</h2>
        <div className="lsl-row">
          {CLIPS.map((c) => (
            <button key={c} disabled={!ready} className={clip === c ? 'on' : ''} onClick={() => { bear?.play(c); setClip(c); }}>{c}</button>
          ))}
        </div>
        <div className="lsl-row" style={{ marginTop: 6 }}>
          {EXTRA_CLIPS.map((c) => (
            <button key={c} disabled={!ready} onClick={() => bear?.playByName(c)}>{c}</button>
          ))}
        </div>

        <h2>Face</h2>
        <div className="lsl-row">
          {EXPRS.map((e) => (
            <button key={e} disabled={!ready} className={expr === e ? 'on' : ''} onClick={() => { bear?.setExpression(e); setExpr(e); }}>{e}</button>
          ))}
          <button disabled={!ready} onClick={() => bear?.face.blink()}>blink</button>
        </div>

        <h2>View</h2>
        <div className="lsl-row">
          <button className={camMode === 'face' ? 'on' : ''} onClick={() => { camModeRef.current = 'face'; setCamMode('face'); }}>Close up</button>
          <button className={camMode === 'body' ? 'on' : ''} onClick={() => { camModeRef.current = 'body'; setCamMode('body'); }}>Full body</button>
          <button
            className={look ? 'on' : ''}
            onClick={() => {
              lookRef.current = !look;
              if (look) bearRef.current?.lookAt(null);
              setLook(!look);
            }}
          >Eyes follow pointer</button>
        </div>

        <h2>Tuning</h2>
        <p className="lsl-note">Live. Defaults live in src/lipsync/config.ts (documented in docs/LIPSYNC.md).</p>
        {(Object.keys(LIPSYNC_CONFIG_RANGES) as Array<keyof typeof LIPSYNC_CONFIG_RANGES>).map((k) => {
          const [lo, hi, step] = LIPSYNC_CONFIG_RANGES[k];
          return (
            <div className="lsl-slider" key={k}>
              <span>{k}</span>
              <input type="range" min={lo} max={hi} step={step} value={cfg[k]} onChange={(e) => setParam(k, Number(e.target.value))} />
              <span>{cfg[k]}</span>
            </div>
          );
        })}
        <div className="lsl-row" style={{ marginTop: 8 }}>
          <button onClick={resetCfg}>Reset</button>
          <button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(cfg, null, 2))}>Copy JSON</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- meters (canvas, no React re-render per frame)
function drawMeters(c: HTMLCanvasElement | null, bear: Bear) {
  if (!c) return;
  const g = c.getContext('2d');
  if (!g) return;
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);
  const f = bear.lipSync.lastFrame;
  const d = bear.lipSync.debug;
  g.font = '11px ui-monospace, monospace';
  const rowH = 15;
  VISEMES.forEach((v, i) => {
    const y = 4 + i * rowH;
    const w = (f.weights[v] ?? 0) * (W - 50);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(40, y + 2, W - 50, rowH - 5);
    g.fillStyle = i >= 10 ? '#ffd84a' : '#ff389b';
    g.fillRect(40, y + 2, w, rowH - 5);
    g.fillStyle = '#fff';
    g.fillText(v, 4, y + 11);
  });
  const y0 = 4 + VISEMES.length * rowH + 6;
  g.fillStyle = '#fff';
  g.fillText('loud', 4, y0 + 10);
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.fillRect(40, y0 + 2, W - 50, 10);
  g.fillStyle = d.gate ? '#5fcf86' : '#9a6bff';
  g.fillRect(40, y0 + 2, f.amplitude * (W - 50), 10);
  g.fillStyle = '#fff';
  g.fillText(`${d.gate ? 'SPEECH' : 'quiet '} lvl ${d.levelDb.toFixed(0)} floor ${d.floorDb.toFixed(0)} dB`, 4, y0 + 28);
  g.fillText(`F1 ${d.f1.toFixed(0)} F2 ${d.f2.toFixed(0)} voi ${d.voicing.toFixed(2)}`, 4, y0 + 42);
  g.fillText(`open ${d.openness.toFixed(2)} front ${d.frontness.toFixed(2)}`, 4, y0 + 56);
  g.fillText(`fric ${d.fricative.toFixed(2)} clos ${d.closure.toFixed(2)} ${d.fullBand ? 'FULL' : 'PHONE'}`, 4, y0 + 70);
}
