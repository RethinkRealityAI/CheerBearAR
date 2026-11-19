// Per-frame acoustic features for lip sync, computed from an AnalyserNode's float spectrum and waveform.
// Everything here is phone-safe: vowels and consonant cues use 100..3400 Hz; the 4..8 kHz band is only used as extra
// evidence when the signal actually has it (full-band audio).

export interface Features {
  /** Frame level, dBFS. */
  levelDb: number;
  /** Rough first/second formant estimates (Hz), from a harmonic-smoothed spectral envelope. */
  f1: number;
  f2: number;
  /** 0..1 periodicity (voiced speech ~0.6+, fricatives / noise low). */
  voicing: number;
  /** dB: energy 1.8 kHz..top vs 150..900 Hz. Vowels are strongly negative, sibilants near zero or positive. */
  tiltDb: number;
  /** dB: energy 4.5..8 kHz vs 1.8..4.5 kHz (only meaningful when fullBand). */
  hissDb: number;
  /** Spectral centroid of 1.8 kHz..top (Hz). SH peaks lower than S. */
  hiCentroid: number;
  /** dB: energy 150..500 Hz vs 500..top. High for nasal murmur (m, n). */
  nasalDb: number;
  /** True when the input has real energy above 4 kHz (not a phone call). */
  fullBand: boolean;
}

const dbToPow = (db: number) => Math.pow(10, db / 10);

export class FeatureExtractor {
  private freqDb: Float32Array<ArrayBuffer>;
  private pow: Float32Array<ArrayBuffer>;
  private env: Float32Array<ArrayBuffer>;
  private wave: Float32Array<ArrayBuffer>;
  private hissAvg = -60;
  readonly out: Features = {
    levelDb: -120, f1: 600, f2: 1700, voicing: 0, tiltDb: -20, hissDb: -40, hiCentroid: 2400, nasalDb: 0, fullBand: false,
  };

  constructor(private analyser: AnalyserNode, private sampleRate: number) {
    const n = analyser.frequencyBinCount;
    this.freqDb = new Float32Array(n);
    this.pow = new Float32Array(n);
    this.env = new Float32Array(n);
    this.wave = new Float32Array(analyser.fftSize);
  }

  compute(bandTopHz: number, dt: number): Features {
    const a = this.analyser;
    const o = this.out;
    a.getFloatTimeDomainData(this.wave);
    a.getFloatFrequencyData(this.freqDb);
    const w = this.wave;
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i] * w[i];
    const rms = Math.sqrt(s / w.length);
    o.levelDb = 20 * Math.log10(rms + 1e-9);

    const n = this.freqDb.length;
    const hz = this.sampleRate / a.fftSize;
    const nyq = this.sampleRate / 2;
    const top = Math.min(bandTopHz, nyq - hz);
    for (let i = 0; i < n; i++) {
      const d = this.freqDb[i];
      this.pow[i] = d > -200 ? dbToPow(d) : 0;
    }
    // Envelope: moving average over ~320 Hz in linear power (blurs voice harmonics so formant regions stand out).
    const half = Math.max(1, Math.round(160 / hz));
    let acc = 0;
    let cnt = 0;
    for (let i = 0; i < Math.min(n, half); i++) {
      acc += this.pow[i];
      cnt++;
    }
    for (let i = 0; i < n; i++) {
      const add = i + half;
      const rem = i - half - 1;
      if (add < n) {
        acc += this.pow[add];
        cnt++;
      }
      if (rem >= 0) {
        acc -= this.pow[rem];
        cnt--;
      }
      this.env[i] = acc / cnt;
    }
    const band = (lo: number, hi: number) => {
      let e = 0;
      const i0 = Math.max(1, Math.floor(lo / hz));
      const i1 = Math.min(n - 1, Math.ceil(hi / hz));
      for (let i = i0; i <= i1; i++) e += this.pow[i];
      return e + 1e-12;
    };
    // Peak-weighted centroids of the envelope approximate F1 and F2 robustly (no fragile peak picking).
    const centroid = (lo: number, hi: number, p: number) => {
      let num = 0;
      let den = 0;
      const i0 = Math.max(1, Math.floor(lo / hz));
      const i1 = Math.min(n - 1, Math.ceil(hi / hz));
      for (let i = i0; i <= i1; i++) {
        const e = Math.pow(this.env[i], p);
        num += e * i * hz;
        den += e;
      }
      return den > 0 ? num / den : (lo + hi) / 2;
    };
    o.f1 = centroid(220, 1100, 2);
    o.f2 = centroid(Math.max(900, o.f1 + 250), Math.min(3000, top), 2);
    o.hiCentroid = centroid(1800, top, 1);
    const low = band(150, 900);
    o.tiltDb = 10 * Math.log10(band(1800, top) / low);
    o.nasalDb = 10 * Math.log10(band(150, 500) / band(500, top));
    if (nyq > 8200) {
      o.hissDb = 10 * Math.log10(band(4500, 8000) / band(1800, 4500));
      // Full band = the 4-8 kHz band is not empty relative to the voice band (phone audio sits ~40 dB down there).
      const hiRel = 10 * Math.log10(band(4000, 8000) / band(300, 3000));
      if (o.levelDb > -55) this.hissAvg += (hiRel - this.hissAvg) * Math.min(1, dt / 1.5);
      o.fullBand = this.hissAvg > -32;
    } else {
      o.hissDb = -40;
      o.fullBand = false;
    }
    o.voicing = this.periodicity();
    return o;
  }

  /** Normalised autocorrelation peak over 70..450 Hz pitch lags, on a 2x decimated frame. */
  private periodicity(): number {
    const w = this.wave;
    const sr = this.sampleRate / 2;
    const N = Math.floor(w.length / 2);
    let e0 = 0;
    for (let i = 0; i < N; i++) {
      const v = w[2 * i];
      e0 += v * v;
    }
    if (e0 < 1e-9) return 0;
    const lagMin = Math.floor(sr / 450);
    const lagMax = Math.min(N - 32, Math.ceil(sr / 70));
    let best = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let c = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i + lag < N; i++) {
        const x = w[2 * i];
        const y = w[2 * (i + lag)];
        c += x * y;
        e1 += x * x;
        e2 += y * y;
      }
      const r = c / Math.sqrt(e1 * e2 + 1e-12);
      if (r > best) best = r;
    }
    return Math.max(0, Math.min(1, best));
  }
}
