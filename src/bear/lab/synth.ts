// Synthetic test speech for the lab (no recordings, nothing copyrighted). A small Klatt-style cascade formant
// synthesiser: glottal pulses with lip radiation through DC-normalised formant resonators for vowels (with formant
// glides for diphthongs), shaped noise for fricatives, silence + burst for stops, low murmur for nasals.

interface Seg {
  kind: 'vowel' | 'fric' | 'stop' | 'nasal' | 'gap';
  dur: number;
  /** Formants at the start (and `to` at the end, for glides). */
  f?: [number, number, number];
  to?: [number, number, number];
  hiHz?: number;
  gain?: number;
}

// Adult female formants (Hz), Peterson & Barney style averages.
const V: Record<string, [number, number, number]> = {
  a: [850, 1220, 2810],
  e: [600, 2050, 2900],
  i: [330, 2750, 3300],
  o: [560, 950, 2830],
  u: [370, 950, 2670],
  r: [450, 1250, 1650],
};

const vowel = (dur: number, f: [number, number, number], to?: [number, number, number]): Seg => ({ kind: 'vowel', dur, f, to });
const gap = (dur: number): Seg => ({ kind: 'gap', dur });

export const SYNTH_SCRIPTS: Record<string, { label: string; segs: Seg[] }> = {
  vowels: {
    label: 'Vowel sweep a-e-i-o-u',
    segs: ['a', 'e', 'i', 'o', 'u'].flatMap((k) => [vowel(0.42, V[k]), gap(0.16)]),
  },
  syllables: {
    label: 'Syllables ba-ma-sa-sha-fa',
    segs: [
      gap(0.2),
      { kind: 'stop', dur: 0.08 }, vowel(0.3, V.a), gap(0.14),
      { kind: 'nasal', dur: 0.12 }, vowel(0.3, V.a), gap(0.14),
      { kind: 'fric', dur: 0.16, hiHz: 5500, gain: 1.6 }, vowel(0.3, V.a), gap(0.14),
      { kind: 'fric', dur: 0.16, hiHz: 2600, gain: 1 }, vowel(0.3, V.a), gap(0.14),
      { kind: 'fric', dur: 0.14, hiHz: 1500, gain: 0.12 }, vowel(0.3, V.a), gap(0.3),
    ],
  },
  phrase: {
    label: 'Phrase "hi, I\'m Cheer Bear"',
    segs: [
      gap(0.15),
      { kind: 'fric', dur: 0.07, hiHz: 1400, gain: 0.15 }, vowel(0.3, V.a, V.i), gap(0.12),
      vowel(0.2, V.a, V.i), { kind: 'nasal', dur: 0.12 }, gap(0.08),
      { kind: 'fric', dur: 0.12, hiHz: 2600, gain: 1 }, vowel(0.24, V.i), vowel(0.1, V.i, V.r), gap(0.06),
      { kind: 'stop', dur: 0.07 }, vowel(0.34, V.e, V.r), gap(0.3),
    ],
  },
};

export function synthSpeech(script: keyof typeof SYNTH_SCRIPTS, rate: number): Float32Array<ArrayBuffer> {
  const segs = SYNTH_SCRIPTS[script].segs;
  const total = Math.ceil(segs.reduce((a, s) => a + s.dur, 0) * rate) + segs.length;
  const out = new Float32Array(total);
  let pos = 0;
  let phase = 0;
  let prevG = 0;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  const res = [new Resonator(), new Resonator(), new Resonator()];
  const noiseRes = new Resonator();
  for (const s of segs) {
    const n = Math.floor(s.dur * rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.max(0, Math.min(1, t / 0.025, (s.dur - t) / 0.035));
      let y = 0;
      if (s.kind === 'vowel' || s.kind === 'nasal') {
        const f0 = 215 + 18 * Math.sin(2 * Math.PI * 2.2 * (pos + i) / rate) - 25 * (t / s.dur);
        phase += f0 / rate;
        if (phase >= 1) phase -= 1;
        // Rosenberg glottal flow, then lip radiation (first difference): about -6 dB/octave overall, like real voice.
        const g = phase < 0.6 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.6)) : Math.max(0, Math.cos((Math.PI * (phase - 0.6)) / 0.8));
        const src = (g - prevG) * 40 + rnd() * 0.01;
        prevG = g;
        if (s.kind === 'vowel') {
          const u = s.to ? smooth(t / s.dur) : 0;
          y = src * env;
          for (let k = 0; k < 3; k++) {
            const fc = s.f![k] + (s.to ? (s.to[k] - s.f![k]) * u : 0);
            y = res[k].step(y, fc, 60 + 40 * k, rate);
          }
        } else {
          y = res[0].step(src * env, 260, 100, rate) * 0.12;
        }
      } else if (s.kind === 'fric') {
        y = noiseRes.stepPeak(rnd() * env, s.hiHz!, s.hiHz! * (s.hiHz! < 2000 ? 1.4 : 0.45), rate) * (s.gain ?? 1);
      } else if (s.kind === 'stop') {
        y = i < n * 0.7 ? 0 : rnd() * 1.2 * Math.exp(-(i - n * 0.7) / (rate * 0.006));
      }
      out[pos + i] = y;
    }
    pos += n;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / (peak || 1)) * 0.6;
  return out;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Two-pole resonator (Klatt): unity gain at DC, so a cascade gives natural formant amplitudes. */
class Resonator {
  private y1 = 0;
  private y2 = 0;
  step(x: number, fc: number, bw: number, rate: number): number {
    const r = Math.exp((-Math.PI * bw) / rate);
    const b = 2 * r * Math.cos((2 * Math.PI * fc) / rate);
    const c = -r * r;
    const v = (1 - b - c) * x + b * this.y1 + c * this.y2;
    this.y2 = this.y1;
    this.y1 = v;
    return v;
  }
  /** Same filter scaled to about unity gain at the peak (for noise bands). */
  stepPeak(x: number, fc: number, bw: number, rate: number): number {
    const r = Math.exp((-Math.PI * bw) / rate);
    const b = 2 * r * Math.cos((2 * Math.PI * fc) / rate);
    const c = -r * r;
    const v = (1 - r) * x + b * this.y1 + c * this.y2;
    this.y2 = this.y1;
    this.y1 = v;
    return v;
  }
}
