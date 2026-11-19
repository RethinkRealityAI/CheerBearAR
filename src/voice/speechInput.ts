// The user's side of the demo call: the browser's own speech recognition (SpeechRecognition /
// webkitSpeechRecognition), continuous with interim results, restarted whenever the browser ends it (they all stop
// after a pause or a minute). Mute pauses it. While Cheer Bear is talking (and a moment after) results are ignored,
// so her own voice from the speakers is not heard as the user. Not supported / denied are reported once through
// `onState` and never retried in a loop.
//
// Chrome sends the audio to Google's servers for recognition; Safari uses Apple's. Only used in the demo call.

export type SpeechInputState = 'off' | 'starting' | 'live' | 'paused' | 'unsupported' | 'denied' | 'error';

export interface SpeechInputHandlers {
  /** `id` is stable for one utterance (partials and its final). */
  onResult(id: string, text: string, final: boolean): void;
  onState(state: SpeechInputState, message?: string): void;
}

/** The subset of the Web Speech API we use (also what the tests fake). */
export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onresult: ((e: RecognitionResultEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  /** The microphone is capturing (voice mode's hold-to-talk waits for it). Optional: not every browser has it. */
  onaudiostart?: (() => void) | null;
  /** Voice-4: the rest of the Web Speech events, all optional (used for the ring and the Mic check log). */
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onnomatch?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface RecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence?: number } }>;
}

export type RecognitionFactory = () => RecognitionLike;

/** The browser's recognition constructor, or null when it has none (Firefox, older browsers, some webviews). */
export function browserRecognition(): RecognitionFactory | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => RecognitionLike) | undefined;
  return typeof Ctor === 'function' ? () => new Ctor() : null;
}

const MAX_RESTARTS = 8; // within RESTART_WINDOW_MS, then give up (the service keeps failing)
const RESTART_WINDOW_MS = 20_000;
/** Results that start within this long after Cheer Bear stops talking are her echo, not the user. */
const ECHO_TAIL_MS = 700;
let instances = 0;

export class SpeechInput {
  private rec: RecognitionLike | null = null;
  private wanted = false;
  private paused = false;
  private blocked = false;
  private state: SpeechInputState = 'off';
  private restarts: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private session = 0;
  /** result index -> ignored (heard while Cheer Bear was talking) */
  private tainted = new Set<number>();
  private seen = new Set<number>();
  private finals = new Set<number>();
  private bearTalking = false;
  private bearStoppedAt = -Infinity;
  /** Unique per instance, so transcript ids never repeat across demo calls. */
  private prefix = `user-${Date.now().toString(36)}${(instances++).toString(36)}`;

  constructor(private handlers: SpeechInputHandlers, private factory: RecognitionFactory | null = browserRecognition(), private lang = 'en-US') {}

  get supported(): boolean {
    return !!this.factory;
  }

  get currentState(): SpeechInputState {
    return this.state;
  }

  private setState(s: SpeechInputState, message?: string) {
    if (s === this.state && !message) return;
    this.state = s;
    this.handlers.onState(s, message);
  }

  /** Call from the tap that starts the demo call (the first start needs a user gesture on Safari). */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    if (!this.factory) {
      this.blocked = true;
      this.setState('unsupported', "This browser can't listen here, so type to Cheer Bear instead.");
      return;
    }
    if (!this.paused) this.open();
  }

  stop(): void {
    this.wanted = false;
    this.close();
    if (!this.blocked) this.setState('off');
  }

  /** Mute: stop listening without ending the demo call. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.wanted || this.blocked) return;
    if (paused) {
      this.close();
      this.setState('paused');
    } else this.open();
  }

  /** Cheer Bear started / stopped talking (her voice comes out of the speakers). */
  setBearTalking(talking: boolean): void {
    this.bearTalking = talking;
    if (!talking) this.bearStoppedAt = Date.now();
  }

  private open() {
    if (this.rec || this.blocked || !this.factory) return;
    let rec: RecognitionLike;
    try {
      rec = this.factory();
    } catch (err) {
      this.blocked = true;
      this.setState('unsupported', "This browser can't listen here, so type to Cheer Bear instead.");
      console.warn('[voice] speech recognition unavailable:', err);
      return;
    }
    const session = ++this.session;
    this.tainted.clear();
    this.seen.clear();
    this.finals.clear();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.maxAlternatives = 1;
    rec.onstart = () => session === this.session && this.setState('live');
    rec.onresult = (e) => session === this.session && this.onResult(session, e);
    rec.onerror = (e) => session === this.session && this.onError(e.error, e.message);
    rec.onend = () => {
      if (session !== this.session) return;
      this.rec = null;
      if (this.wanted && !this.paused && !this.blocked) this.scheduleRestart();
    };
    this.rec = rec;
    this.setState('starting');
    try {
      rec.start();
    } catch (err) {
      // InvalidStateError when already started; anything else: try again shortly
      console.warn('[voice] speech recognition start failed:', err);
      this.rec = null;
      this.scheduleRestart();
    }
  }

  private close() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.rec;
    this.rec = null;
    this.session += 1;
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }

  private scheduleRestart() {
    if (this.restartTimer) return;
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.blocked = true;
      this.setState('error', "Cheer Bear can't hear you right now, so type to her instead.");
      return;
    }
    this.restarts.push(now);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wanted && !this.paused && !this.blocked) this.open();
    }, this.restarts.length > 2 ? 1000 : 250);
  }

  private onError(error: string, message?: string) {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        this.blocked = true;
        this.close();
        this.setState('denied', 'Microphone blocked, so type to Cheer Bear instead.');
        return;
      case 'audio-capture':
        this.blocked = true;
        this.close();
        this.setState('error', 'No microphone found, so type to Cheer Bear instead.');
        return;
      case 'language-not-supported':
        this.blocked = true;
        this.close();
        this.setState('unsupported', "This browser can't listen in English here, so type to Cheer Bear instead.");
        return;
      case 'no-speech':
      case 'aborted':
        return; // normal: `end` follows and we restart
      default:
        console.warn('[voice] speech recognition error:', error, message || '');
      // network etc.: `end` follows; the restart budget stops a loop
    }
  }

  private onResult(session: number, e: RecognitionResultEventLike) {
    const echo = this.bearTalking || Date.now() - this.bearStoppedAt < ECHO_TAIL_MS;
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      if (!r || this.finals.has(i)) continue;
      if (!this.seen.has(i)) {
        this.seen.add(i);
        if (echo) this.tainted.add(i);
      }
      if (this.tainted.has(i)) {
        if (r.isFinal) this.finals.add(i);
        continue;
      }
      const text = String(r[0]?.transcript ?? '').trim();
      if (r.isFinal) this.finals.add(i);
      if (!text) continue;
      this.handlers.onResult(`${this.prefix}-${session}-${i}`, text, r.isFinal);
    }
  }
}
