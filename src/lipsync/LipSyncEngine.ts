// Realtime, audio-only lip sync: an audio source -> Oculus-style viseme weights (VisemeFrame), with no added latency
// beyond one analysis window (~21 ms) and the mouth's own motion smoothing.
//
// Pipeline per rendered frame:
//   level + noise floor -> speech gate (hysteresis + hold)
//   loudness above the gate (auto-ranged) -> openness
//   formant estimates (F1/F2, speaker-normalised) -> soft vowel classification (aa, E, I, O, U)
//   tilt / hiss / periodicity -> fricatives (SS, CH, FF);  level dips -> closures (PP);  murmur -> nn;  onsets -> DD/kk
//   critically damped motion per viseme (attack/release), caps so shapes blend
//
// It only ANALYSES audio. It never routes a call's audio to the speakers (the Twilio SDK already plays it).
import type { Viseme, VisemeFrame } from '../shared/contracts';
import { VISEMES } from '../shared/contracts';
import { getAudioContext } from '../audio/context';
import { DEFAULT_LIPSYNC_CONFIG, type LipSyncConfig } from './config';
import { FeatureExtractor, type Features } from './features';

type VisemeMap = Record<Viseme, number>;
const zeroMap = (): VisemeMap => Object.fromEntries(VISEMES.map((v) => [v, 0])) as VisemeMap;

/** Vowel prototypes in normalised (openness, frontness) space, 0..1. */
const VOWELS: Array<[Viseme, number, number]> = [
  ['aa', 0.9, 0.45],
  ['E', 0.62, 0.82],
  ['I', 0.18, 0.92],
  ['O', 0.6, 0.15],
  ['U', 0.15, 0.12],
];

/** Snapshot for meters and debugging. */
export interface LipSyncDebug {
  levelDb: number;
  floorDb: number;
  loudness: number;
  gate: boolean;
  openness: number;
  frontness: number;
  voicing: number;
  fricative: number;
  closure: number;
  fullBand: boolean;
  f1: number;
  f2: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class LipSyncEngine {
  readonly config: LipSyncConfig;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;
  private input: AudioNode | null = null;
  private ownsInput = false;
  private holdEl: HTMLAudioElement | null = null;
  private fx: FeatureExtractor | null = null;

  // state
  private floorDb = -60;
  private peakDb = -30;
  private sylPeakDb = -60;
  private prevLevel = -120;
  private gate = false;
  private gateHeld = 0;
  private quietFor = 0;
  private m1 = Math.log(620);
  private v1 = 0.06;
  private m2 = Math.log(1750);
  private v2 = 0.04;
  private burst = 0;
  private burstKind: Viseme = 'DD';
  private target = zeroMap();
  private x = zeroMap();
  private v = zeroMap();
  private amp = 0;
  private ampV = 0;
  private frame: VisemeFrame = { weights: {}, amplitude: 0, speaking: false };
  readonly debug: LipSyncDebug = {
    levelDb: -120, floorDb: -60, loudness: 0, gate: false, openness: 0, frontness: 0, voicing: 0, fricative: 0,
    closure: 0, fullBand: false, f1: 0, f2: 0,
  };

  constructor(config?: Partial<LipSyncConfig>) {
    this.config = { ...DEFAULT_LIPSYNC_CONFIG, ...config };
  }

  /** Change tunables live. */
  setConfig(patch: Partial<LipSyncConfig>): void {
    const fftChanged = patch.fftSize !== undefined && patch.fftSize !== this.config.fftSize;
    Object.assign(this.config, patch);
    if (fftChanged && this.analyser) {
      this.analyser.fftSize = this.config.fftSize;
      this.fx = new FeatureExtractor(this.analyser, this.analyser.context.sampleRate);
    }
  }

  get attached(): boolean {
    return !!this.input;
  }

  /** The analyser input, for callers that want to tap the same signal (meters). */
  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Analyse a live MediaStream (Cheer Bear's side of the call). Nothing is played: the stream is only analysed.
   * Chrome (and some Android browsers) deliver silence to Web Audio from a REMOTE WebRTC stream unless the stream is
   * also attached to a media element, so it is attached to a muted, never-shown <audio> as well.
   */
  attachStream(stream: MediaStream): void {
    const ctx = getAudioContext();
    this.attachNode(ctx.createMediaStreamSource(stream), true);
    const el = document.createElement('audio');
    el.muted = true;
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    this.holdEl = el;
  }

  /** Analyse any node already in the shared graph (a BufferSource from `say`, a media element source, a filter). */
  attachNode(node: AudioNode, owns = false): void {
    this.detach();
    const ctx = getAudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = this.config.fftSize;
    an.smoothingTimeConstant = 0;
    an.minDecibels = -110;
    an.maxDecibels = -10;
    // Analysers are only guaranteed to run when pulled by the destination, so feed a silent gain into it.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(an);
    an.connect(sink);
    sink.connect(ctx.destination);
    this.analyser = an;
    this.sink = sink;
    this.input = node;
    this.ownsInput = owns;
    this.fx = new FeatureExtractor(an, ctx.sampleRate);
    this.resetState();
  }

  detach(): void {
    try {
      if (this.input && this.analyser) this.input.disconnect(this.analyser);
    } catch {
      /* already gone */
    }
    if (this.ownsInput) {
      try {
        this.input?.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      this.analyser?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.holdEl) {
      this.holdEl.pause();
      this.holdEl.srcObject = null;
      this.holdEl = null;
    }
    this.analyser = null;
    this.sink = null;
    this.input = null;
    this.fx = null;
    this.gate = false;
    for (const k of VISEMES) this.target[k] = 0;
  }

  private resetState(): void {
    this.floorDb = this.config.floorMinDb + 15;
    this.peakDb = this.floorDb + this.config.dynamicRangeDb;
    this.gate = false;
    this.gateHeld = 0;
    this.burst = 0;
  }

  /** Advance one rendered frame. Always returns a frame (closing the mouth when nothing is attached). */
  update(dt: number): VisemeFrame {
    dt = Math.min(Math.max(dt, 0.001), 0.1);
    const c = this.config;
    const t = this.target;
    for (const k of VISEMES) t[k] = 0;
    let loud = 0;

    if (this.fx) {
      const f = this.fx.compute(c.bandTopHz, dt);
      loud = this.analyse(f, dt);
    }
    // Motion: critically damped per viseme; attack when rising, release when falling.
    const wA = 3.9 / (c.attackMs / 1000);
    const wR = 3.9 / (c.releaseMs / 1000);
    const weights: Partial<Record<Viseme, number>> = {};
    for (const k of VISEMES) {
      const w = t[k] > this.x[k] ? wA : wR;
      [this.x[k], this.v[k]] = spring(this.x[k], this.v[k], t[k], w, dt);
      const val = clamp01(this.x[k]);
      if (val > 0.002) weights[k] = val;
    }
    const wJ = 3.9 / (c.jawMs / 1000);
    [this.amp, this.ampV] = spring(this.amp, this.ampV, loud, wJ, dt);
    this.frame = { weights, amplitude: clamp01(this.amp), speaking: this.gate };
    return this.frame;
  }

  get lastFrame(): VisemeFrame {
    return this.frame;
  }

  /** Features -> target weights. Returns the loudness (0..1) used for the jaw/energy envelope. */
  private analyse(f: Features, dt: number): number {
    const c = this.config;
    const d = this.debug;
    const lvl = Math.max(f.levelDb, -120);

    // ---- noise floor: falls instantly to quieter levels, rises slowly (faster while nobody talks)
    if (lvl < this.floorDb) this.floorDb = lvl;
    else this.floorDb += c.floorRiseDbPerSec * (this.gate ? 1 : 3) * dt;
    this.floorDb = Math.max(this.floorDb, c.floorMinDb);

    // ---- gate with hysteresis and hold
    const above = lvl - this.floorDb;
    if (above > c.gateOpenDb) {
      this.gate = true;
      this.gateHeld = 0;
    } else if (this.gate && above < c.gateCloseDb) {
      this.gateHeld += dt * 1000;
      if (this.gateHeld > c.gateHoldMs) this.gate = false;
    } else if (this.gate) {
      this.gateHeld = 0;
    }
    this.quietFor = this.gate ? 0 : this.quietFor + dt;

    // ---- loudness, auto-ranged between the gate and recent peaks
    this.peakDb = Math.max(lvl, this.peakDb - 4 * dt);
    const base = this.floorDb + c.gateCloseDb;
    const range = Math.max(10, Math.min(c.dynamicRangeDb, this.peakDb - base));
    let loud = clamp01((lvl - base) / range);
    loud = Math.pow(loud, c.loudnessGamma);
    // Syllable peak: decays fast, so a quick dip after a vowel shows up as a closure.
    this.sylPeakDb = Math.max(lvl, this.sylPeakDb - 45 * dt);
    const onsetRate = (lvl - this.prevLevel) / dt;
    this.prevLevel = lvl;

    d.levelDb = lvl;
    d.floorDb = this.floorDb;
    d.loudness = loud;
    d.gate = this.gate;
    d.voicing = f.voicing;
    d.fullBand = f.fullBand;
    d.f1 = f.f1;
    d.f2 = f.f2;

    if (!this.gate) {
      d.fricative = 0;
      d.closure = 0;
      this.burst = 0;
      return 0;
    }
    const t = this.target;
    const k = c.intensity;

    // ---- speaker-normalised formants -> openness / frontness
    const l1 = Math.log(Math.max(150, f.f1));
    const l2 = Math.log(Math.max(500, f.f2));
    const voiced = f.voicing > 0.5 && loud > 0.15;
    if (voiced) {
      const a = Math.min(1, dt / c.speakerAdaptSec);
      this.m1 += (l1 - this.m1) * a;
      this.m2 += (l2 - this.m2) * a;
      this.v1 += ((l1 - this.m1) ** 2 - this.v1) * a;
      this.v2 += ((l2 - this.m2) ** 2 - this.v2) * a;
    }
    const z1 = (l1 - this.m1) / Math.sqrt(Math.max(this.v1, 0.004));
    const z2 = (l2 - this.m2) / Math.sqrt(Math.max(this.v2, 0.003));
    // Open vowels are also the loud ones: blend in loudness so the jaw tracks the syllable rhythm.
    const open = clamp01(0.65 * sigmoid(1.5 * z1) + 0.35 * loud);
    const front = sigmoid(1.5 * z2);
    d.openness = open;
    d.frontness = front;

    // ---- fricatives (S/Z, SH/CH/J, F/V/TH): unvoiced-ish, energy tilted up
    const tiltScore = f.fullBand ? Math.max(f.tiltDb, f.hissDb + 6) : f.tiltDb;
    let fric = sigmoid((tiltScore + 4) / 2.5) * (1 - clamp01((f.voicing - 0.35) / 0.4));
    fric = clamp01(fric * c.fricativeGain);
    d.fricative = fric;

    // ---- closures (P/B/M): a sharp dip below the syllable peak while still inside speech
    const dip = this.sylPeakDb - lvl;
    let closure = clamp01((dip - c.closureDipDb * 0.6) / (c.closureDipDb * 0.6)) * (1 - fric);
    // nasal murmur (m, n): voiced, quiet, all energy low
    const nasal = clamp01((f.nasalDb - 10) / 8) * clamp01((f.voicing - 0.4) / 0.3) * (1 - loud);
    closure = clamp01(closure + nasal * 0.5) * c.closureGain;
    d.closure = closure;

    // ---- bursts (T/D/K): a fast onset right after a closure
    if (onsetRate > 180 && dip < 4) {
      this.burst = 1;
      this.burstKind = front > 0.45 ? 'DD' : 'kk';
    }
    this.burst = Math.max(0, this.burst - dt / 0.07);

    // ---- vowels: soft classification around prototypes
    const sharp = c.vowelSharpness;
    const sig2 = 2 * (0.3 / sharp) ** 2;
    let sum = 0;
    const p: number[] = [];
    for (const [, vo, vf] of VOWELS) {
      const e = Math.exp(-((open - vo) ** 2 + (front - vf) ** 2) / sig2);
      p.push(e);
      sum += e;
    }
    const vowelAmt = loud * (1 - fric) * (1 - closure) * k;
    VOWELS.forEach(([name], i) => {
      t[name] += vowelAmt * (p[i] / sum);
    });

    // fricative shape: phone audio cannot see S (4-8 kHz), so S vs SH comes from where the 1.8-3.4 kHz energy sits
    const fricAmt = fric * k * Math.max(0.45, Math.min(1, loud * 1.6));
    let sh: number;
    if (f.fullBand) sh = clamp01((-f.hissDb - 2) / 8);
    else sh = clamp01((2600 - f.hiCentroid) / 600);
    const weak = clamp01((0.3 - loud) / 0.3); // quiet frication reads as F/TH
    t.SS += fricAmt * (1 - sh) * (1 - weak * 0.6);
    t.CH += fricAmt * sh * (1 - weak * 0.6);
    t.FF += fricAmt * weak * 0.6;

    t.PP += closure * Math.max(0.5, 1 - nasal);
    t.nn += nasal * 0.6 * c.closureGain;
    t[this.burstKind] += this.burst * c.burstGain * k * 0.8;

    // ---- caps: shapes blend instead of fighting
    let total = 0;
    for (const v of VISEMES) {
      t[v] = Math.min(t[v], c.maxViseme);
      total += t[v];
    }
    if (total > c.maxTotal) {
      const s = c.maxTotal / total;
      for (const v of VISEMES) t[v] *= s;
    }
    return loud * k;
  }

  dispose(): void {
    this.detach();
  }
}

/** Exact step of a critically damped spring toward `target` (stable for any dt). */
function spring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const x0 = x - target;
  const e = Math.exp(-w * dt);
  const j = (v + w * x0) * dt;
  return [target + (x0 + j) * e, (v - w * j) * e];
}
