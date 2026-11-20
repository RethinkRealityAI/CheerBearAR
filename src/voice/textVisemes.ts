// Text -> mouth shapes, for speech we cannot analyse (the browser's speechSynthesis plays straight to the speakers,
// so there is no audio stream for the lip sync engine). A small letter-to-sound pass turns each word into the 15
// visemes of the contract with natural durations, then `sampleTimeline` blends neighbouring sounds (coarticulation:
// every sound is a raised-cosine bump that overlaps its neighbours, lip closures win over vowels) and adds a
// jaw/loudness envelope. BrowserVoice re-anchors the clock on the synthesiser's word boundary events.
// Pure logic, no DOM: tested in Node (scripts/check-voice-logic.ts).
import type { Viseme, VisemeFrame } from '../shared/contracts';

export interface VisemeSeg {
  v: Viseme;
  /** Start and end, seconds from the start of the utterance. */
  t0: number;
  t1: number;
  /** Peak weight 0..1. */
  peak: number;
  vowel: boolean;
}

export interface WordTiming {
  /** The word as written (with its punctuation stripped). */
  text: string;
  /** Character range in the original text (matches SpeechSynthesisUtterance boundary `charIndex`). */
  charStart: number;
  charEnd: number;
  t0: number;
  t1: number;
}

export interface VisemeTimeline {
  segs: VisemeSeg[];
  words: WordTiming[];
  duration: number;
}

// Seconds at speech rate 1. Calibrated so a typical sentence lasts about as long as a browser voice at rate 1
// (~165 words a minute).
const DUR: Record<Viseme, number> = {
  sil: 0.05, PP: 0.075, FF: 0.085, TH: 0.08, DD: 0.06, kk: 0.07, CH: 0.095, SS: 0.09, nn: 0.065, RR: 0.07,
  aa: 0.12, E: 0.11, I: 0.1, O: 0.12, U: 0.11,
};
// Peak weights: vowels open the jaw (the face mixes each viseme's jaw share), closures must close fully.
const PEAK: Record<Viseme, number> = {
  sil: 0, PP: 0.9, FF: 0.75, TH: 0.55, DD: 0.5, kk: 0.45, CH: 0.7, SS: 0.6, nn: 0.5, RR: 0.55,
  aa: 0.8, E: 0.7, I: 0.65, O: 0.75, U: 0.7,
};
const VOWELS = new Set<Viseme>(['aa', 'E', 'I', 'O', 'U']);
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'is', 'it', 'in', 'on', 'at', 'for', 'i', 'you', 'me', 'my', 'we', 'be', 'so', 'or', 'as', 'with', 'that', 'this', 'are', 'am', 'was', 'can', 'do']);
const PAUSE: Array<[RegExp, number]> = [
  [/\.\.\.|…/, 0.4],
  [/[.!?]/, 0.34],
  [/[;:]/, 0.25],
  [/[,–—-]/, 0.18],
];

type Sound = { v: Viseme; dur?: number; peak?: number };

const isVowelLetter = (c: string | undefined) => !!c && 'aeiouy'.includes(c);
const isCons = (c: string | undefined) => !!c && /[b-df-hj-np-tv-z]/.test(c);

// Common words the spelling rules get wrong.
const EXCEPTIONS: Record<string, string> = {
  i: 'aa I', hi: 'aa I', you: 'I U', your: 'I U RR', youre: 'I U RR', to: 'DD U', do: 'DD U', two: 'DD U', too: 'DD U',
  who: 'U', are: 'aa RR', one: 'U aa nn', once: 'U aa nn SS', said: 'SS E DD', was: 'U aa SS', what: 'U aa DD',
  of: 'aa FF', love: 'nn aa FF', come: 'kk aa PP', some: 'SS aa PP', friend: 'FF RR E nn DD', friends: 'FF RR E nn DD SS',
  bear: 'PP E RR', bears: 'PP E RR SS', care: 'kk E RR', there: 'TH E RR', where: 'U E RR', here: 'I RR',
  eye: 'aa I', eyes: 'aa I SS', buy: 'PP aa I', by: 'PP aa I', my: 'PP aa I', fly: 'FF nn aa I', sky: 'SS kk aa I',
  oh: 'O U', ok: 'O U kk E I', okay: 'O U kk E I', yay: 'I E I', wow: 'U aa U', ooh: 'U', aww: 'aa', brr: 'PP RR',
  brrr: 'PP RR', hmm: 'PP', zzz: 'SS', lot: 'nn O DD',
};

/** Letter-to-viseme for one lower-case word (letters only). Rough English rules: good enough for a mouth. */
export function wordToVisemes(word: string): Sound[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: Sound[] = [];
  if (!w) return out;
  const ex = EXCEPTIONS[w];
  if (ex) return ex.split(' ').map((v) => ({ v: v as Viseme, dur: v === 'RR' && ex.endsWith('RR') ? 0.06 : undefined }));
  // Silent final e ("make", "home") when the word has another vowel before it.
  let end = w.length;
  if (w.length > 2 && w.endsWith('e') && isCons(w[w.length - 2]) && /[aeiouy]/.test(w.slice(0, -2))) end -= 1;
  const magicE = end < w.length; // vowel before the last consonant says its name
  const push = (v: Viseme, dur?: number, peak?: number) => {
    const last = out[out.length - 1];
    if (last && last.v === v && !VOWELS.has(v)) return; // doubled consonants: one sound
    out.push({ v, dur, peak });
  };
  let i = 0;
  if (w.startsWith('kn')) i = 1;
  else if (w.startsWith('wr')) i = 1;
  while (i < end) {
    const c = w[i];
    const n = w[i + 1];
    const tri = w.slice(i, i + 3);
    const di = w.slice(i, i + 2);
    if (tri === 'tch') { push('CH'); i += 3; continue; }
    if (tri === 'igh') { push('aa', 0.08); push('I', 0.07); i += 3; continue; }
    if (di === 'gh') { i += 2; continue; } // night, though: silent
    if (di === 'sh' || di === 'ch') { push('CH'); i += 2; continue; }
    if (di === 'th') { push('TH'); i += 2; continue; }
    if (di === 'ph') { push('FF'); i += 2; continue; }
    if (di === 'ck') { push('kk'); i += 2; continue; }
    if (di === 'ng') { push('nn'); i += 2; continue; }
    if (di === 'qu') { push('kk'); push('U', 0.05); i += 2; continue; }
    if (di === 'wh') { push('U', 0.06, 0.5); i += 2; continue; }
    if (di === 'mb' && i + 2 >= end) { push('PP'); i += 2; continue; }
    if (di === 'oo') { push('U', 0.13); i += 2; continue; }
    if (di === 'ee' || di === 'ea' || di === 'ie') { push('I', 0.12); i += 2; continue; }
    if (di === 'ai' || di === 'ay' || di === 'ey') { push('E', 0.08); push('I', 0.05, 0.5); i += 2; continue; }
    if (di === 'oa') { push('O', 0.12); i += 2; continue; }
    if (di === 'ou' || di === 'ow') { push(i + 2 >= end && di === 'ow' && w.length > 3 ? 'O' : 'aa', 0.08); push('U', 0.06); i += 2; continue; }
    if (di === 'oi' || di === 'oy') { push('O', 0.08); push('I', 0.06); i += 2; continue; }
    if (di === 'au' || di === 'aw') { push('O', 0.12); i += 2; continue; }
    if (di === 'ar') { push('aa', 0.11); push('RR', 0.05, 0.4); i += 2; continue; }
    if (di === 'or') { push('O', 0.1); push('RR', 0.05, 0.4); i += 2; continue; }
    if ((di === 'er' || di === 'ir' || di === 'ur') && !isVowelLetter(w[i + 2])) { push('RR', 0.1, 0.6); i += 2; continue; }
    switch (c) {
      case 'a': {
        // "make" says its name; a lone "a" is a quick, small vowel
        if (magicE && i === end - 2) { push('E', 0.09); push('I', 0.05, 0.45); } else push('aa', w.length === 1 ? 0.07 : undefined, w.length === 1 ? 0.55 : undefined);
        break;
      }
      case 'e': push(i === end - 1 && w.length <= 3 ? 'I' : 'E'); break; // me, we, the -> ee-ish
      case 'i': if (magicE && i === end - 2) { push('aa', 0.08); push('I', 0.06); } else push('I'); break;
      case 'o': if (magicE && i === end - 2) { push('O', 0.09); push('U', 0.05, 0.5); } else push(i === end - 1 && w.length <= 3 ? 'U' : 'O'); break; // go, so, to/do
      case 'u': push(isCons(n) && (isCons(w[i + 2]) || i + 2 >= end) && !magicE ? 'aa' : 'U', undefined, 0.65); break; // fun/up vs you/blue
      case 'y':
        if (i === 0) push('I', 0.05, 0.4);
        else if (w.length <= 3) { push('aa', 0.08); push('I', 0.06); } // my, by, fly
        else push('I');
        break;
      case 'b': case 'm': case 'p': push('PP'); break;
      case 'f': case 'v': push('FF'); break;
      case 't': case 'd': push('DD'); break;
      case 'l': case 'n': push('nn'); break;
      case 'k': case 'q': push('kk'); break;
      case 'g': push(/[eiy]/.test(n || '') && i > 0 ? 'CH' : 'kk'); break;
      case 'c': push(/[eiy]/.test(n || '') ? 'SS' : 'kk'); break;
      case 's': case 'z': push('SS'); break;
      case 'x': push('kk', 0.05); push('SS', 0.07); break;
      case 'j': push('CH'); break;
      case 'r': push('RR'); break;
      case 'w': push('U', 0.06, 0.5); break;
      case 'h': break; // breath: the next vowel carries it
      default: break;
    }
    i += 1;
  }
  return out;
}

/** Deterministic small variation so repeated vowels are not identical. */
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 0.2 - 0.1;
}

/** Builds the timeline for a whole utterance. `rate` is the speech rate (1 = normal, 2 = twice as fast). */
export function buildVisemeTimeline(text: string, opts: { rate?: number } = {}): VisemeTimeline {
  const rate = Math.min(3, Math.max(0.3, opts.rate ?? 1));
  const segs: VisemeSeg[] = [];
  const words: WordTiming[] = [];
  let t = 0.04; // the synthesiser takes a moment to open the mouth
  const re = /[A-Za-z0-9'’]+/g;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  let segIndex = 0;
  while ((m = re.exec(text))) {
    // pause for punctuation between the previous word and this one
    if (words.length) {
      const between = text.slice(lastEnd, m.index);
      for (const [p, d] of PAUSE) if (p.test(between)) { t += d / rate; break; }
      t += 0.018 / rate;
    }
    const raw = m[0];
    const lower = raw.toLowerCase().replace(/[’']/g, '');
    const sounds = /^\d+$/.test(lower) ? numberSounds(lower) : wordToVisemes(lower);
    const fn = FUNCTION_WORDS.has(lower);
    const next = text.slice(m.index + raw.length, m.index + raw.length + 3);
    const phraseFinal = /^[.!?,]/.test(next) || m.index + raw.length >= text.trimEnd().length;
    const w0 = t;
    let firstVowel = true;
    sounds.forEach((s, k) => {
      const vowel = VOWELS.has(s.v);
      let dur = s.dur ?? DUR[s.v];
      let peak = s.peak ?? PEAK[s.v];
      if (vowel && firstVowel && !fn) { dur *= 1.15; peak = Math.min(1, peak * 1.08); }
      if (vowel && phraseFinal && k >= sounds.length - 2) dur *= 1.25;
      if (fn) { dur *= 0.85; peak *= 0.85; }
      if (vowel) { firstVowel = false; peak *= 1 + jitter(segIndex); }
      dur /= rate;
      segs.push({ v: s.v, t0: t, t1: t + dur, peak: Math.min(1, peak), vowel });
      segIndex += 1;
      t += dur;
    });
    if (!sounds.length) t += 0.08 / rate;
    words.push({ text: raw, charStart: m.index, charEnd: m.index + raw.length, t0: w0, t1: t });
    lastEnd = m.index + raw.length;
  }
  return { segs, words, duration: t + 0.12 };
}

function numberSounds(digits: string): Sound[] {
  // "one two three": roughly two sounds per digit is plenty for a mouth
  const out: Sound[] = [];
  for (let i = 0; i < Math.min(digits.length, 6); i += 1) out.push({ v: 'nn' }, { v: i % 2 ? 'I' : 'U' });
  return out;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Mouth shape at time `t` (seconds). Each sound is a bump that starts rising a little before it and fades a little
 * after it (overlapping its neighbours), lip closures (PP, FF) push the open shapes down while they hold, and the
 * total is capped at 1 so shapes blend instead of stacking. `amplitude` follows the open vowels (the jaw).
 */
export function sampleTimeline(tl: VisemeTimeline, t: number, opts: { gain?: number } = {}): VisemeFrame {
  const gain = opts.gain ?? 1;
  const weights: Partial<Record<Viseme, number>> = {};
  if (t < 0 || t > tl.duration || !tl.segs.length) return { weights, amplitude: 0, speaking: t >= 0 && t <= tl.duration };
  // Binary search for the first segment that could overlap t.
  let lo = 0;
  let hi = tl.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tl.segs[mid].t1 + 0.12 < t) lo = mid + 1;
    else hi = mid;
  }
  let closure = 0;
  let vowelAmp = 0;
  let consAmp = 0;
  for (let i = Math.max(0, lo - 1); i < tl.segs.length; i += 1) {
    const s = tl.segs[i];
    if (s.t0 - 0.12 > t) break;
    const d = s.t1 - s.t0;
    const pre = Math.min(0.06, d * 0.6); // anticipation: lips start moving before the sound
    const post = Math.min(0.09, d * 0.9); // carry-over into the next sound
    let x: number;
    if (t < s.t0 - pre || t > s.t1 + post) continue;
    if (t < s.t0 + d * 0.35) x = smooth((t - (s.t0 - pre)) / (pre + d * 0.35));
    else if (t <= s.t1 - d * 0.2) x = 1;
    else x = 1 - smooth((t - (s.t1 - d * 0.2)) / (post + d * 0.2));
    const w = s.peak * x;
    if (w <= 0) continue;
    weights[s.v] = Math.max(weights[s.v] ?? 0, w);
    if (s.v === 'PP' || s.v === 'FF') closure = Math.max(closure, w);
    if (s.vowel) vowelAmp = Math.max(vowelAmp, w);
    else consAmp = Math.max(consAmp, w);
  }
  // Closures dominate: the jaw and open shapes give way while the lips press.
  if (closure > 0) {
    const keep = 1 - closure * 0.85;
    for (const k of Object.keys(weights) as Viseme[]) if (k !== 'PP' && k !== 'FF') weights[k]! *= keep;
  }
  let total = 0;
  for (const k of Object.keys(weights) as Viseme[]) {
    weights[k]! *= gain;
    total += weights[k]!;
  }
  if (total > 1) for (const k of Object.keys(weights) as Viseme[]) weights[k]! /= total;
  const amplitude = Math.min(1, (vowelAmp * 0.9 + consAmp * 0.35) * (closure > 0 ? 1 - closure * 0.6 : 1) * gain);
  return { weights, amplitude, speaking: true };
}

/** Index of the word whose range contains `charIndex` (or the last one before it). */
export function wordAtChar(tl: VisemeTimeline, charIndex: number): number {
  let idx = -1;
  for (let i = 0; i < tl.words.length; i += 1) {
    if (tl.words[i].charStart <= charIndex) idx = i;
    else break;
  }
  return Math.max(0, idx);
}
