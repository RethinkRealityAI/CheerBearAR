// Voice mode's "what you can say": words -> things to do. Pure and local (no network, no AI), unit-tested in Node
// (scripts/check-voice-commands.ts).
//
//   matchVoiceCommands(text, classifier)  -> every command in a sentence, in the order they were said
//   new CommandTracker(getClassifier)     -> one hold: feed it interim and final text, get each command ONCE
//
// What it understands:
//   - every trigger word and its synonyms from the live config (localClassifier: keywords, synonyms, morphology),
//     so an admin's new word works by voice straight away;
//   - modes: "3D", "AR" / "augmented reality" / "put her in my room", "selfie", "photo" / "3D photo";
//   - camera: "take a picture / photo", "cheese", "say cheese"; "place" / "put her here"; "move";
//   - games: "play heart run", "play heart hoops", "stop the game", "pause", "keep going", "again" / "play again";
//   - fun: "hello" / "hi Happi" (at the start) -> Wave; "I love you" / "hug" -> a hug.
//
// Robust to recognition noise: lower case, punctuation stripped, number words ("three d" -> 3d), "a r" -> ar,
// "share bear" / "cheer bare" / "chair bear" -> cheer bear, "hard run" / "art hoops" -> heart ... Whole words only,
// so "rain" never fires Rainbow and "dancer" never fires Dance. "don't dance" / "stop dancing" fire nothing.
// When two readings overlap, the longest wins ("play heart run" is the game, not the Running moment); for the same
// length a built-in command wins over a trigger word.
import type { LocalClassifier } from '../shared/config';
import type { ExperienceCommand, ExperienceMode, PlayGameId } from '../shared/contracts';

export type VoiceCommand =
  | { kind: 'trigger'; keyword: string }
  /** `orCapture`: "take a selfie" -> switch to selfie, or take the photo when already there. */
  | { kind: 'mode'; mode: ExperienceMode; orCapture?: boolean }
  /** `orMode`: bare "photo" / "picture" -> the shutter where there is one, else open that mode (resolveCapture). */
  | { kind: 'command'; name: ExperienceCommand; orMode?: ExperienceMode }
  | { kind: 'play'; game: PlayGameId }
  | { kind: 'stopPlay' };

export interface VoiceMatch {
  /** Stable per command (dedupe key): 'trigger:rainbow', 'mode:ar', 'command:capture', 'play:heart-run'... */
  id: string;
  command: VoiceCommand;
  /** The words that matched (normalised). */
  phrase: string;
  /** Token span in the normalised text. */
  start: number;
  end: number;
  /** Ending an interim result, wait for the next result or the release (see Pattern.settle). */
  settle?: boolean;
}

export type ClassifierLike = Pick<LocalClassifier, 'keywords' | 'synonyms' | 'morphologyEnabled'>;

// ------------------------------------------------------------------ normalising speech

const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};
/** Single-word mishearings, always safe to rewrite. */
const WORD_FIX: Record<string, string> = {
  selfy: 'selfie', selfies: 'selfie', selphie: 'selfie', foto: 'photo', fotos: 'photos', pic: 'picture', pics: 'pictures',
  hapi: 'happi', happie: 'happi', happey: 'happi',
  hiya: 'hi', heya: 'hey', hullo: 'hello', helo: 'hello', okay: 'ok', rainbo: 'rainbow',
  '3rd': '3d', thrd: '3d',
};
const CHEER = new Set(['cheer', 'share', 'chair', 'cher', 'shear', 'sheer', 'cheers', 'chia', 'jeer', 'chiar']);
const BEAR = new Set(['bear', 'bare', 'bears', 'bair', 'bayer', 'bar']);

/** Lower-case words with recognition noise smoothed out. */
export function normalizeSpeech(text: string): string[] {
  let s = String(text || '').toLowerCase().replace(/[‘’ʼ`]/g, "'");
  s = s.replace(/\ba\s*\.\s*r\s*\.?(?=\s|$)/g, ' ar ').replace(/\b3\s*-\s*d\b/g, ' 3d ');
  s = s.replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ');
  const raw: string[] = [];
  for (const w of s.split(' ')) {
    if (!w) continue;
    const fixed = WORD_FIX[w] ?? NUMBERS[w] ?? w;
    for (const part of fixed.split(' ')) raw.push(part);
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i];
    const next = raw[i + 1];
    if ((w === '3' || w === 'free' || w === 'tree') && (next === 'd' || next === 'de' || next === 'dee')) { out.push('3d'); i += 1; continue; }
    if (w === 'a' && next === 'r') { out.push('ar'); i += 1; continue; }
    if (w === 'self' && (next === 'e' || next === 'he' || next === 'y')) { out.push('selfie'); i += 1; continue; }
    if (w === 'rain' && next === 'bow') { out.push('rainbow'); i += 1; continue; }
    if (CHEER.has(w) && next && BEAR.has(next)) { out.push('cheer', 'bear'); i += 1; continue; }
    out.push(w);
  }
  return out;
}

// ------------------------------------------------------------------ patterns

type Slot = { words: Set<string>; optional: boolean };
interface Pattern {
  slots: Slot[];
  command: VoiceCommand;
  /** Higher wins between same-length overlapping matches. Commands 2, trigger words 1. */
  rank: number;
  /** Only at the very start of what was said ("hi", "hello"). */
  atStart?: boolean;
  /** The whole utterance must be just this ("stop"). */
  whole?: boolean;
  /** Fires nothing when preceded by don't / do not / no / stop / never. */
  negatable?: boolean;
  /** Ending an interim result, it waits for more words ("photo" may grow into "photo mode"). */
  settle?: boolean;
}

/** "play|start (the) heart|hart run" -> slots. Parentheses mark an optional slot. */
function compile(spec: string): Slot[] {
  return spec.trim().split(/\s+/).map((tok) => {
    const optional = tok.startsWith('(') && tok.endsWith(')');
    const body = optional ? tok.slice(1, -1) : tok;
    return { words: new Set(body.split('|')), optional };
  });
}

const HEART = 'heart|hearts|hart|harts|hard|art|heat|hot|heard';
const PLAY = '(lets|let|us|can|we|i|wanna|want|to|go|play|start|do)';
const GO = '(lets|let|us|please|can|we|you|go|to|switch|change|open|show|me|turn|on|into|back|the|a)';
const ME = 'her|cheer|bear|it|you|yourself|him|she';

const BUILTIN: Array<Omit<Pattern, 'slots' | 'rank'> & { spec: string }> = [
  // ---- modes
  { spec: `${GO} ${GO} ${GO} 3d (mode|view|world)`, command: { kind: 'mode', mode: 'showcase' } },
  { spec: `${GO} ${GO} ${GO} ar (mode|view|camera)`, command: { kind: 'mode', mode: 'ar' } },
  { spec: `${GO} ${GO} ${GO} augmented reality`, command: { kind: 'mode', mode: 'ar' } },
  { spec: `put|bring|place|come|take (${ME}) (${ME}) in|into|to my|the|our room|house|kitchen|bedroom|home`, command: { kind: 'mode', mode: 'ar' } },
  { spec: `${GO} ${GO} ${GO} selfie (mode|camera|time)`, command: { kind: 'mode', mode: 'face' } },
  { spec: `take|make|lets|do (a|our|my|me|us) selfie`, command: { kind: 'mode', mode: 'face', orCapture: true } },
  { spec: `take|make|snap (a|our|my|me|us) 3d photo|picture`, command: { kind: 'mode', mode: 'photo', orCapture: true } },
  { spec: `${GO} ${GO} ${GO} 3d photo|picture (mode)`, command: { kind: 'mode', mode: 'photo' } },
  { spec: `${GO} ${GO} ${GO} photo|picture mode|camera`, command: { kind: 'mode', mode: 'photo' } },
  { spec: `go|switch|change|open|turn|to|into|back ${GO} ${GO} photo|picture`, command: { kind: 'mode', mode: 'photo' } },
  // bare "photo" / "picture": take it where there is a shutter, else open 3D Photo (resolveCapture)
  { spec: '(a|the|my|another|our) photo|picture|pic|snapshot (please|now)', command: { kind: 'command', name: 'capture', orMode: 'photo' }, settle: true },
  // ---- camera
  { spec: 'take|snap|make|click (a|the|my|our|me|us|another) (a|nice|new|cute|silly|fun|big|lovely) picture|photo|pic|snap|snapshot|shot', command: { kind: 'command', name: 'capture' } },
  { spec: '(say) cheese|cheesy', command: { kind: 'command', name: 'capture' } },
  { spec: 'place (her|it|cheer|you) (bear) (here|down|there)', command: { kind: 'command', name: 'place' } },
  { spec: `put|drop|set ${ME} (bear) here|down|there`, command: { kind: 'command', name: 'place' } },
  { spec: 'move (it)', command: { kind: 'command', name: 'move' }, whole: true },
  { spec: `move ${ME} (bear) (somewhere|over) (here|there|else)`, command: { kind: 'command', name: 'move' } },
  // ---- games
  { spec: `${PLAY} ${PLAY} (the) ${HEART} run|ran|running|race|runner`, command: { kind: 'play', game: 'heart-run' } },
  { spec: `${PLAY} ${PLAY} (the) ${HEART} hoops|hoop|hopes|hops|whoops`, command: { kind: 'play', game: 'heart-hoops' } },
  { spec: `${PLAY} ${PLAY} basketball`, command: { kind: 'play', game: 'heart-hoops' } },
  { spec: 'stop|end|quit|finish|exit|leave (the|this|playing) game|playing', command: { kind: 'stopPlay' } },
  { spec: 'stop (it|now)', command: { kind: 'stopPlay' }, whole: true },
  { spec: 'pause (the|this) (game)', command: { kind: 'command', name: 'pause' } },
  { spec: 'resume|unpause|continue (the|this) (game)', command: { kind: 'command', name: 'resume' } },
  { spec: 'keep going|playing', command: { kind: 'command', name: 'resume' } },
  { spec: '(lets|can|we|play|do|try|go) (it|that) again', command: { kind: 'command', name: 'again' } },
  { spec: '1 more time|go', command: { kind: 'command', name: 'again' } },
  // ---- fun
  { spec: '(oh|well) hello|hi|hey|howdy (there|friend|cheer) (bear)', command: { kind: 'trigger', keyword: 'Wave' }, atStart: true },
  { spec: 'good morning|afternoon (cheer) (bear)', command: { kind: 'trigger', keyword: 'Wave' }, atStart: true },
  { spec: '(i) love|luv you|ya|cheer (bear) (so) (much)', command: { kind: 'command', name: 'hug' } },
  { spec: '(give|gimme|me|a|big) (me|us|a) (a|big) hug|hugs|cuddle', command: { kind: 'command', name: 'hug' } },
];

/** Built-in patterns only (no trigger words): what voice mode understands beyond the admin's keywords. */
const BUILTIN_PATTERNS: Pattern[] = BUILTIN.map(({ spec, ...p }) => ({ ...p, slots: compile(spec), rank: 2 }));

function splitCamel(word: string): string {
  return word.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function morph(word: string, enabled: boolean): string[] {
  const out = [word];
  if (word.length < 3) return out;
  if (!word.endsWith('s')) out.push(`${word}s`);
  if (!enabled) return out;
  const last = word[word.length - 1];
  if (last === 'y' && !'aeiou'.includes(word[word.length - 2])) out.push(`${word.slice(0, -1)}ies`, `${word.slice(0, -1)}ied`, `${word.slice(0, -1)}ying`);
  else out.push(`${word}ed`, `${word}ing`);
  if (last === 'e' && word.length > 3) out.push(`${word.slice(0, -1)}ing`, `${word}d`);
  return out;
}

let triggerCache: { sig: string; patterns: Pattern[] } = { sig: '', patterns: [] };

/** One pattern per keyword phrase (keyword, its camel-case split, each synonym; the last word gets inflections). */
function triggerPatterns(c: ClassifierLike): Pattern[] {
  const keywords = (c.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const sig = JSON.stringify([keywords, c.synonyms || {}, !!c.morphologyEnabled]);
  if (sig === triggerCache.sig) return triggerCache.patterns;
  const patterns: Pattern[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const root = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const phrases = [keyword, splitCamel(keyword), ...((c.synonyms || {})[root] || (c.synonyms || {})[keyword.toLowerCase()] || [])];
    for (const phrase of phrases) {
      const words = normalizeSpeech(phrase);
      if (!words.length) continue;
      const lastForms = morph(words[words.length - 1], !!c.morphologyEnabled);
      const key = words.join(' ');
      if (seen.has(key)) continue; // first keyword wins a shared phrase (same as the classifier)
      seen.add(key);
      const slots: Slot[] = words.map((w, i) => ({ words: new Set(i === words.length - 1 ? lastForms : [w]), optional: false }));
      patterns.push({ slots, command: { kind: 'trigger', keyword }, rank: 1, negatable: true });
    }
  }
  triggerCache = { sig, patterns };
  return patterns;
}

/** Tries to match `slots` at `tokens[i]`; returns every end index it can reach (optional slots branch). */
function matchAt(slots: Slot[], tokens: string[], i: number): number[] {
  const ends: number[] = [];
  const walk = (si: number, ti: number) => {
    if (si === slots.length) { ends.push(ti); return; }
    const slot = slots[si];
    if (ti < tokens.length && slot.words.has(tokens[ti])) walk(si + 1, ti + 1);
    if (slot.optional) walk(si + 1, ti);
  };
  walk(0, i);
  return ends.filter((e) => e > i);
}

const NEGATORS = new Set(['dont', 'not', 'no', 'never', 'stop', 'quit', 'without']);

function commandId(c: VoiceCommand): string {
  switch (c.kind) {
    case 'trigger': return `trigger:${c.keyword.toLowerCase()}`;
    case 'mode': return `mode:${c.mode}`;
    case 'command': return `command:${c.name}`;
    case 'play': return `play:${c.game}`;
    case 'stopPlay': return 'stopPlay';
  }
}

/** Every command in `text` (longest readings first, no overlaps), in the order they were said. */
export function matchVoiceCommands(text: string, classifier: ClassifierLike): VoiceMatch[] {
  const tokens = normalizeSpeech(text);
  if (!tokens.length) return [];
  const patterns = [...BUILTIN_PATTERNS, ...triggerPatterns(classifier)];
  const found: Array<VoiceMatch & { rank: number; core: number; settle?: boolean }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (const p of patterns) {
      if (p.atStart && i > 0 && !(i === 1 && ['oh', 'well', 'um', 'uh'].includes(tokens[0]))) continue;
      for (const end of matchAt(p.slots, tokens, i)) {
        if (p.whole && (i !== 0 || end !== tokens.length)) continue;
        const span = tokens.slice(i, end);
        if (p.negatable && isNegated(tokens, i)) continue;
        found.push({ id: commandId(p.command), command: p.command, phrase: span.join(' '), start: i, end, rank: p.rank, core: requiredCount(p.slots), ...(p.settle ? { settle: true } : {}) });
      }
    }
  }
  // longest first; then built-in before trigger words; then more required words; then earlier
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.rank - a.rank || b.core - a.core || a.start - b.start);
  const taken = new Array<boolean>(tokens.length).fill(false);
  const picked: VoiceMatch[] = [];
  const ids = new Set<string>();
  for (const m of found) {
    let free = true;
    for (let t = m.start; t < m.end; t += 1) if (taken[t]) { free = false; break; }
    if (!free) continue;
    for (let t = m.start; t < m.end; t += 1) taken[t] = true;
    if (ids.has(m.id)) continue; // the same command said twice in one breath runs once
    ids.add(m.id);
    picked.push({ id: m.id, command: m.command, phrase: m.phrase, start: m.start, end: m.end, ...(m.settle ? { settle: true } : {}) });
  }
  return picked.sort((a, b) => a.start - b.start);
}

function requiredCount(slots: Slot[]): number {
  return slots.filter((s) => !s.optional).length;
}

function isNegated(tokens: string[], i: number): boolean {
  const a = tokens[i - 1];
  const b = tokens[i - 2];
  if (a && NEGATORS.has(a)) return true;
  if (a && b && (NEGATORS.has(b) && ['the', 'a', 'to', 'it', 'more', 'any'].includes(a))) return true;
  return b === 'do' && a === 'not';
}

// ------------------------------------------------------------------ one hold

/**
 * One hold of the talk button. Feed every interim and the final text; `update` returns only NEW commands, each at
 * most once per hold (interim and final together). A match on the LAST word of an interim result waits for the next
 * result when that word is short (under 4 letters: "hi" may grow into "hide", "ar" into "art") or the reading may
 * still change (bare "photo" -> "photo mode"); `finish()` (the
 * release) accepts it.
 */
export class CommandTracker {
  private fired = new Set<string>();
  private last = '';

  constructor(private getClassifier: () => ClassifierLike) {}

  /** Commands already run in this hold. */
  get firedIds(): ReadonlySet<string> {
    return this.fired;
  }

  /** The latest text heard (interim or final). */
  get text(): string {
    return this.last;
  }

  update(text: string, final: boolean): VoiceMatch[] {
    this.last = text;
    const tokens = normalizeSpeech(text);
    const out: VoiceMatch[] = [];
    for (const m of matchVoiceCommands(text, this.getClassifier())) {
      if (this.fired.has(m.id)) continue;
      if (!final && m.end === tokens.length && (m.settle || (tokens[tokens.length - 1] || '').length < 4)) continue;
      this.fired.add(m.id);
      out.push(m);
    }
    return out;
  }

  /** The hold ended: whatever was heard last counts as said (short last words included). */
  finish(): VoiceMatch[] {
    return this.update(this.last, true);
  }
}

// ------------------------------------------------------------------ help + examples

/** Example things to say for the "Try saying..." chips: two trigger words from the live config, then a mode. */
export function exampleCommands(keywords: readonly string[], n = 3): Array<{ say: string; label: string }> {
  const prefer = ['Rainbow', 'Dance', 'Party', 'Sparkle', 'House', 'Magic', 'Wave'];
  const have = new Map(keywords.map((k) => [k.toLowerCase(), k]));
  const words: string[] = [];
  for (const p of prefer) if (have.has(p.toLowerCase()) && words.length < Math.max(0, n - 1)) words.push(have.get(p.toLowerCase())!);
  for (const k of keywords) if (words.length < n - 1 && !words.includes(k)) words.push(k);
  const out = words.map((w) => ({ say: splitCamel(w).toLowerCase(), label: splitCamel(w) }));
  out.push({ say: 'go to 3d', label: 'Go to 3D' });
  return out.slice(0, n);
}

// ------------------------------------------------------------------ capture: shutter or switch

/** Modes whose screen has a shutter (bottom centre). AR joins when it shows one (`shutterNow`). */
export const SHUTTER_MODES: ReadonlySet<ExperienceMode> = new Set<ExperienceMode>(['face', 'photo']);

/**
 * What a capture command does in `mode`: press the shutter where there is one; otherwise open `orMode`
 * (bare "photo" -> 3D Photo) or, for "take a picture" / "cheese", Selfie (where the shutter is).
 */
export function resolveCapture(mode: ExperienceMode, orMode: ExperienceMode | undefined, shutterNow = false): { capture: true } | { mode: ExperienceMode } {
  if (SHUTTER_MODES.has(mode) || shutterNow) return { capture: true };
  return { mode: orMode ?? 'face' };
}
