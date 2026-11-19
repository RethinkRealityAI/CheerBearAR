// Cheer Bear's voice in the demo: the browser's own speech synthesis (no accounts, no network). Speaks one line at a
// time and, in step with it, streams the words said so far and mouth shapes (VisemeFrame at ~45 fps from
// textVisemes.ts). Word `boundary` events re-anchor the mouth clock when the browser sends them; otherwise the
// timed estimate runs on its own and the line ends on the utterance's `end`.
//
// iOS / Safari: the first speak() must happen inside a tap, so `unlock()` speaks a silent utterance from the tap that
// starts the demo call (or sends a chat message). Voices can load late (`voiceschanged`), so the choice is re-made
// when they arrive. Chrome drops events for utterances that get garbage collected, so the current one is held.
// Speech is cancelled on cancel()/dispose() and when the page is hidden.
//
// With no speech synthesis (or `audible: false`, or a voice that never starts) the line still "plays": words and
// mouth on the timed estimate, silently, so the conversation and the lip sync work everywhere.
import type { VisemeFrame } from '../shared/contracts';
import { buildVisemeTimeline, sampleTimeline, wordAtChar, type VisemeTimeline } from './textVisemes';

export interface VoiceSettings {
  pitch: number;
  rate: number;
  /** false: never use speechSynthesis (silent demo, tests). */
  audible: boolean;
  /** Clock speed for silent lines (?mockVoice=fast). */
  silentSpeed?: number;
}

export interface SpeakHandlers {
  /** The words said so far (grows word by word). */
  onWords?(textSoFar: string, wordIndex: number): void;
  onFrame?(frame: VisemeFrame | null): void;
}

export interface SpeakResult {
  /** True when the browser actually spoke it (false: silent estimate). */
  audible: boolean;
  /** True when cancel() stopped it before the end. */
  cancelled: boolean;
}

type Synth = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'> & Partial<Pick<SpeechSynthesis, 'speaking' | 'pending' | 'resume' | 'addEventListener' | 'removeEventListener'>>;

// Friendly, natural English voices first (macOS/iOS, Chrome, Edge/Windows, Android). Novelty and deep voices last.
const PREFERRED = [
  /\bsamantha\b/i, /\bava\b/i, /\ballison\b/i, /\bsusan\b/i, /\bnicky\b/i, /microsoft (ana|aria|jenny|michelle|emma)/i,
  /google us english/i, /\bkaren\b/i, /\btessa\b/i, /\bmoira\b/i, /\bserena\b/i, /\bvictoria\b/i, /\bzira\b/i,
  /google uk english female/i, /\bfiona\b/i, /\bkathy\b/i, /\bflo\b/i, /\bshelley\b/i, /\bsandy\b/i, /female/i,
];
const AVOID = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|grandpa|grandma|rocko|eddy|reed|daniel|alex|aaron|arthur|bruce|david|mark|guy|george|gordon|lee|oliver|rishi|thomas|tom|male)\b/i;

export function scoreVoice(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>): number {
  const lang = (v.lang || '').toLowerCase().replace('_', '-');
  if (!lang.startsWith('en')) return -100;
  let s = lang === 'en-us' ? 6 : lang === 'en-gb' || lang === 'en-au' || lang === 'en-ca' || lang === 'en-ie' ? 4 : 2;
  const idx = PREFERRED.findIndex((re) => re.test(v.name));
  if (idx >= 0) s += 40 - idx;
  if (AVOID.test(v.name)) s -= 60;
  if (v.localService) s += 3; // local voices start fast and send word boundaries
  if (/enhanced|premium|natural|neural/i.test(v.name)) s += 4;
  return s;
}

export function pickVoice<T extends Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>>(voices: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best && bestScore > -100 ? best : null;
}

const FRAME_MS = 22;

export class BrowserVoice {
  private synth: Synth | null;
  private voice: SpeechSynthesisVoice | null = null;
  private current: Line | null = null;
  private unlocked = false;
  private disposed = false;

  constructor(private getSettings: () => VoiceSettings) {
    this.synth = typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null;
    this.refreshVoice();
    try {
      this.synth?.addEventListener?.('voiceschanged', this.refreshVoice);
    } catch {
      /* old Safari: no EventTarget on speechSynthesis */
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** True when the browser can speak (it may still have no voices until they load). */
  get supported(): boolean {
    return !!this.synth;
  }

  get speaking(): boolean {
    return !!this.current;
  }

  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  private refreshVoice = () => {
    try {
      const voices = this.synth?.getVoices() ?? [];
      if (voices.length) this.voice = pickVoice(voices);
    } catch {
      /* ignore */
    }
  };

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.cancel();
  };

  /** Call inside a tap: unlocks speech on iOS/Safari (a silent utterance) and nudges voices to load. */
  unlock(): void {
    if (!this.synth || this.unlocked || !this.getSettings().audible) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
      this.unlocked = true;
    } catch {
      /* ignore */
    }
    this.refreshVoice();
  }

  /** Speaks one line. Resolves when it has finished (or was cancelled). Cancels a line already playing. */
  speak(text: string, handlers: SpeakHandlers = {}): Promise<SpeakResult> {
    this.cancel();
    if (this.disposed || !text.trim()) return Promise.resolve({ audible: false, cancelled: true });
    const settings = this.getSettings();
    if (!this.voice) this.refreshVoice();
    const line = new Line(text, settings, this.synth && settings.audible ? this.synth : null, this.voice, handlers, () => {
      if (this.current === line) this.current = null;
    });
    this.current = line;
    line.start();
    return line.done;
  }

  /** Stops the current line (mouth closes, its promise resolves with cancelled: true). */
  cancel(): void {
    const line = this.current;
    this.current = null;
    line?.cancel();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    try {
      this.synth?.removeEventListener?.('voiceschanged', this.refreshVoice);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

/** One spoken line: the utterance plus the mouth/word clock that follows it. */
class Line {
  readonly done: Promise<SpeakResult>;
  private resolve!: (r: SpeakResult) => void;
  private tl: VisemeTimeline;
  private utter: SpeechSynthesisUtterance | null = null;
  /** Timeline clock (seconds). Runs once the audio starts (or at once when silent). */
  private clock = 0;
  private running = false;
  private audible: boolean;
  private finished = false;
  private lastTick = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private wordShown = -1;
  /** Index of the last word the browser announced (-1: none yet). */
  private boundaryWord = -1;
  private boundaries = 0;
  private lastBoundaryAt = 0;
  private speed = 1;
  private audioEnded = false;

  constructor(
    private text: string,
    private settings: VoiceSettings,
    private synth: Synth | null,
    private voice: SpeechSynthesisVoice | null,
    private handlers: SpeakHandlers,
    private onDone: () => void,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
    this.audible = !!synth;
    this.tl = buildVisemeTimeline(text, { rate: settings.rate });
  }

  start(): void {
    if (!this.synth) return this.startSilent();
    try {
      const u = new SpeechSynthesisUtterance(this.text);
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      } else u.lang = 'en-US';
      u.pitch = clamp(this.settings.pitch, 0, 2);
      u.rate = clamp(this.settings.rate, 0.5, 2);
      u.volume = 1;
      u.onstart = () => this.onAudioStart();
      u.onboundary = (e) => this.onBoundary(e);
      u.onend = () => this.onAudioEnd();
      u.onerror = (e) => this.onAudioError((e as SpeechSynthesisErrorEvent).error);
      this.utter = u; // Chrome: keep a reference or the events can be lost
      if (this.synth.speaking || this.synth.pending) this.synth.cancel();
      this.synth.resume?.(); // Chrome sometimes leaves the queue paused after a tab switch
      this.synth.speak(u);
    } catch (err) {
      console.warn('[voice] speech synthesis failed, continuing silently:', err);
      return this.startSilent();
    }
    // No voice / headless / blocked autoplay: never starts. Carry on silently so the conversation still works.
    this.startTimeout = setTimeout(() => {
      if (!this.running && !this.finished) {
        console.warn('[voice] the browser voice did not start; showing the words without sound');
        this.dropAudio();
        this.startSilent();
      }
    }, 2500);
  }

  private startSilent() {
    this.audible = false;
    this.speed = this.settings.silentSpeed ?? 1;
    this.run();
  }

  private run() {
    if (this.running || this.finished) return;
    this.running = true;
    this.lastTick = now();
    this.tick();
  }

  private onAudioStart() {
    if (this.finished) return;
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.startTimeout = null;
    this.clock = 0;
    this.run();
    // Some engines never send `end` (Chrome with a network voice that drops): end after a generous estimate.
    const ms = (this.tl.duration * 2.2 + 4) * 1000;
    this.watchdog = setTimeout(() => this.onAudioEnd(), ms);
  }

  private onBoundary(e: SpeechSynthesisEvent) {
    if (this.finished) return;
    if (e.name && e.name !== 'word') return;
    if (!this.running) this.onAudioStart(); // Safari can send a boundary before (or instead of) start
    const idx = wordAtChar(this.tl, e.charIndex ?? 0);
    if (idx <= this.boundaryWord) return;
    const w = this.tl.words[idx];
    const t = now();
    if (this.boundaries > 0 && this.boundaryWord >= 0) {
      // Match the mouth clock to how fast this voice really talks.
      const realDt = (t - this.lastBoundaryAt) / 1000;
      const tlDt = w.t0 - this.tl.words[this.boundaryWord].t0;
      if (realDt > 0.05 && tlDt > 0) this.speed = clamp(this.speed * 0.5 + clamp(tlDt / realDt, 0.6, 1.7) * 0.5, 0.6, 1.7);
    }
    this.boundaries += 1;
    this.boundaryWord = idx;
    this.lastBoundaryAt = t;
    this.clock = w.t0;
    this.showWords(idx);
  }

  private onAudioEnd() {
    if (this.finished) return;
    this.audioEnded = true;
    this.finish(false);
  }

  private onAudioError(error: string | undefined) {
    if (this.finished) return;
    if (error === 'interrupted' || error === 'canceled') return this.finish(true);
    console.warn('[voice] speech synthesis error, continuing silently:', error);
    this.dropAudio();
    if (!this.running) this.startSilent();
    else this.audible = false;
  }

  /** Stops listening to the utterance (we carry on silently). */
  private dropAudio() {
    if (this.utter) {
      this.utter.onstart = this.utter.onend = this.utter.onerror = this.utter.onboundary = null;
      this.utter = null;
    }
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    this.audible = false;
  }

  private tick = () => {
    this.timer = null;
    if (this.finished) return;
    const t = now();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    this.clock += dt * this.speed;
    const tl = this.tl;
    if (this.audible && this.boundaries > 0 && this.boundaryWord < tl.words.length - 1) {
      // The browser tells us each word: never run more than a little past the current one (wait for the next).
      this.clock = Math.min(this.clock, tl.words[this.boundaryWord].t1 + 0.12);
    }
    if (!this.audible || this.boundaries === 0) {
      // No boundaries (yet): words follow the estimate.
      let idx = this.wordShown;
      while (idx + 1 < tl.words.length && tl.words[idx + 1].t0 <= this.clock) idx += 1;
      if (idx > this.wordShown) this.showWords(idx);
    }
    this.handlers.onFrame?.(sampleTimeline(tl, this.clock));
    if (!this.audible && this.clock >= tl.duration) return this.finish(false);
    this.timer = setTimeout(this.tick, FRAME_MS);
  };

  private showWords(idx: number) {
    if (idx <= this.wordShown) return;
    this.wordShown = idx;
    const w = this.tl.words[idx];
    this.handlers.onWords?.(this.text.slice(0, w.charEnd), idx);
  }

  cancel(): void {
    if (this.finished) return;
    this.dropAudio();
    this.finish(true);
  }

  private finish(cancelled: boolean) {
    if (this.finished) return;
    this.finished = true;
    for (const t of [this.timer, this.startTimeout, this.watchdog]) if (t) clearTimeout(t);
    if (this.utter) {
      this.utter.onstart = this.utter.onend = this.utter.onerror = this.utter.onboundary = null;
      this.utter = null;
    }
    this.handlers.onFrame?.(null);
    this.onDone();
    this.resolve({ audible: this.audible && this.audioEnded, cancelled });
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
