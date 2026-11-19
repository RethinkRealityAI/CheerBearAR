// Synthetic test speech for the lab (no recordings, nothing copyrighted): a glottal pulse train through formant
// resonators for vowels, shaped noise for fricatives, silence + burst for stops, low murmur for nasals.

interface Seg {
  kind: 'vowel' | 'fric' | 'stop' | 'nasal' | 'gap';
  dur: number;
  f?: [number, number, number];
  hiHz?: number;
}

// Female-ish formants (Hz)
const V: Record<string, [number, number, number]> = {
  a: [850, 1220, 2810],
  e: [600, 2050, 2900],
  i: [330, 2750, 3300],
  o: [560, 950, 2830],
  u: [370, 950, 2670],
};

export const SYNTH_SCRIPTS: Record<string, { label: string; segs: Seg[] }> = {
  vowels: {
    label: 'Vowel sweep a-e-i-o-u',
    segs: ['a', 'e', 'i', 'o', 'u'].flatMap((k) => [{ kind: 'vowel', dur: 0.42, f: V[k] } as Seg, { kind: 'gap', dur: 0.16 } as Seg]),
  },
  syllables: {
    label: 'Syllables ba-ma-sa-sha-fa',
    segs: [
      { kind: 'gap', dur: 0.2 },
      { kind: 'stop', dur: 0.08 }, { kind: 'vowel', dur: 0.3, f: V.a }, { kind: 'gap', dur: 0.14 },
      { kind: 'nasal', dur: 0.12 }, { kind: 'vowel', dur: 0.3, f: V.a }, { kind: 'gap', dur: 0.14 },
      { kind: 'fric', dur: 0.16, hiHz: 5500 }, { kind: 'vowel', dur: 0.3, f: V.a }, { kind: 'gap', dur: 0.14 },
      { kind: 'fric', dur: 0.16, hiHz: 2600 }, { kind: 'vowel', dur: 0.3, f: V.a }, { kind: 'gap', dur: 0.14 },
      { kind: 'fric', dur: 0.14, hiHz: 1500 }, { kind: 'vowel', dur: 0.3, f: V.a }, { kind: 'gap', dur: 0.3 },
    ],
  },
};

export function synthSpeech(script: keyof typeof SYNTH_SCRIPTS, rate: number): Float32Array<ArrayBuffer> {
  const segs = SYNTH_SCRIPTS[script].segs;
  const total = Math.ceil(segs.reduce((a, s) => a + s.dur, 0) * rate);
  const out = new Float32Array(total);
  let pos = 0;
  let phase = 0;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (const s of segs) {
    const n = Math.floor(s.dur * rate);
    const src = new Float32Array(n);
    // source
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.03, (s.dur - t) / 0.04);
      if (s.kind === 'vowel' || s.kind === 'nasal') {
        const f0 = 215 + 20 * Math.sin(2 * Math.PI * 2.2 * t);
        phase += f0 / rate;
        if (phase >= 1) phase -= 1;
        // Rosenberg-ish glottal pulse
        const g = phase < 0.6 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.6)) : Math.cos((Math.PI * (phase - 0.6)) / 0.8);
        src[i] = (g - 0.3) * env + rnd() * 0.02;
      } else if (s.kind === 'fric') src[i] = rnd() * env;
      else if (s.kind === 'stop') src[i] = i < n * 0.7 ? 0 : rnd() * 2 * Math.exp(-(i - n * 0.7) / (rate * 0.006));
    }
    // filter
    let y = src;
    if (s.kind === 'vowel') {
      const f = s.f!;
      const parts = f.map((fc, k) => resonate(src, fc, 80 + 40 * k, rate));
      y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = parts[0][i] + 0.6 * parts[1][i] + 0.3 * parts[2][i];
    } else if (s.kind === 'nasal') {
      const p = resonate(src, 250, 60, rate);
      y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = p[i] * 0.35;
    } else if (s.kind === 'fric') {
      const p = resonate(src, s.hiHz!, s.hiHz! * 0.4, rate);
      y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = p[i] * 0.25;
    }
    out.set(y.subarray(0, Math.min(n, total - pos)), pos);
    pos += n;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / (peak || 1)) * 0.6;
  return out;
}

/** Two-pole resonator, unity-ish peak gain. */
function resonate(x: Float32Array, fc: number, bw: number, rate: number): Float32Array {
  const r = Math.exp((-Math.PI * bw) / rate);
  const a1 = 2 * r * Math.cos((2 * Math.PI * fc) / rate);
  const a2 = -r * r;
  const g = 1 - r;
  const y = new Float32Array(x.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = g * x[i] + a1 * y1 + a2 * y2;
    y[i] = v;
    y2 = y1;
    y1 = v;
  }
  return y;
}
