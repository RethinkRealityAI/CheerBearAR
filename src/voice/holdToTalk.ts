// Voice mode's ears: one press of the talk button = one listening session with the browser's own speech recognition
// (SpeechRecognition / webkitSpeechRecognition), continuous with interim results while held, stopped on release, then
// a short wait for the final words. A mic level meter (getUserMedia + an analyser on the shared AudioContext) makes
// the button's ring follow your voice; where the meter cannot open, the ring pulses on each word heard instead.
//
// Honest note: this is not on-device. Chrome sends the audio to Google's speech service, Safari to Apple's (free, no
// key). Firefox and some in-app browsers have no recognition at all: `supported` is false and the app falls back to
// buttons. Nothing here talks to our server or to any AI.
//
// Pure of the app: the recognition constructor and the meter are injectable (tests and the simulator fake them).
import { getAudioContext } from '../audio/context';
import { browserRecognition, type RecognitionFactory, type RecognitionLike, type RecognitionResultEventLike } from './speechInput';

export type HoldState = 'idle' | 'starting' | 'listening' | 'finishing' | 'unsupported' | 'denied' | 'error';

export interface HoldResult {
  /** Everything heard in this hold (final words, else the last interim). */
  text: string;
  /** The microphone actually started (false: released before it opened, e.g. during the permission prompt). */
  audio: boolean;
  reason: 'released' | 'auto' | 'no-speech' | 'error' | 'denied' | 'max';
  /** How long the button was held (ms), from press to release. */
  heldMs: number;
}

export interface HoldHandlers {
  /** The words so far (grows; `final` once the browser has settled them all). */
  onText(text: string, final: boolean): void;
  onState(state: HoldState, message?: string): void;
  /** The hold is over (not called after cancel()). */
  onDone(result: HoldResult): void;
  /** Mic level 0..1 at ~30 fps while listening (meter, or a pulse per word without one). */
  onLevel?(level: number): void;
}

export interface MeterLike {
  start(onLevel: (l: number) => void): Promise<boolean>;
  stop(): void;
}

export interface HoldOptions {
  lang?: string;
  /** After release, wait this long for the final words before giving up (default 1500 ms). */
  finalWaitMs?: number;
  /** A hold longer than this ends by itself (default 15 s). */
  maxMs?: number;
  /** Mic level meter (default: getUserMedia analyser; null: none). */
  meter?: MeterLike | null;
  now?(): number;
}

export class HoldListener {
  private rec: RecognitionLike | null = null;
  private session = 0;
  private state: HoldState = 'idle';
  private blocked: 'unsupported' | 'denied' | null = null;
  private text = '';
  private finalText = '';
  private audio = false;
  private pressedAt = 0;
  private releasedAt = 0;
  private auto = false;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private meter: MeterLike | null;
  private meterLive = false;
  private pulse = 0;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;

  constructor(private handlers: HoldHandlers, private factory: RecognitionFactory | null = browserRecognition(), private opts: HoldOptions = {}) {
    this.meter = opts.meter === undefined ? new MicMeter() : opts.meter;
    this.now = opts.now ?? (() => Date.now());
    if (!factory) this.blocked = 'unsupported';
  }

  /** The browser can listen at all. */
  get supported(): boolean {
    return !!this.factory;
  }

  /** 'unsupported' / 'denied' once known: pressing again will not work this session. */
  get unavailable(): 'unsupported' | 'denied' | null {
    return this.blocked;
  }

  get current(): HoldState {
    return this.state;
  }

  get active(): boolean {
    return this.state === 'starting' || this.state === 'listening' || this.state === 'finishing';
  }

  private setState(s: HoldState, message?: string) {
    if (s === this.state && !message) return;
    this.state = s;
    this.handlers.onState(s, message);
  }

  /**
   * Start listening. Call from the press (pointerdown / keydown / tap): the first start needs a user gesture.
   * `auto`: tap-to-talk, it stops by itself shortly after you pause. False when it cannot listen here.
   */
  press(opts: { auto?: boolean } = {}): boolean {
    if (this.blocked || !this.factory) {
      this.setState(this.blocked ?? 'unsupported', this.blocked === 'denied' ? DENIED : UNSUPPORTED);
      return false;
    }
    if (this.active) this.abort();
    let rec: RecognitionLike;
    try {
      rec = this.factory();
    } catch (err) {
      console.warn('[voice] speech recognition unavailable:', err);
      this.blocked = 'unsupported';
      this.setState('unsupported', UNSUPPORTED);
      return false;
    }
    const session = ++this.session;
    this.text = '';
    this.finalText = '';
    this.audio = false;
    this.auto = !!opts.auto;
    this.pressedAt = this.now();
    this.releasedAt = 0;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.opts.lang ?? 'en-US';
    rec.maxAlternatives = 1;
    const live = () => session === this.session;
    const opened = () => {
      if (!live() || this.audio) return;
      this.audio = true;
      if (this.state === 'starting') this.setState('listening');
      this.startMeter(session);
    };
    rec.onstart = () => live() && opened();
    rec.onaudiostart = () => live() && opened();
    rec.onresult = (e) => live() && this.onResult(e);
    rec.onerror = (e) => live() && this.onError(e.error, e.message);
    rec.onend = () => live() && this.finish(this.releasedAt ? (this.auto ? 'auto' : 'released') : 'no-speech');
    this.rec = rec;
    this.setState('starting');
    try {
      rec.start();
    } catch (err) {
      console.warn('[voice] speech recognition start failed:', err);
      this.rec = null;
      this.setState('error', TRY_AGAIN);
      this.session += 1;
      return false;
    }
    this.maxTimer = setTimeout(() => live() && this.release('max'), this.opts.maxMs ?? (this.auto ? 9000 : 15000));
    return true;
  }

  /** Let go: stop listening and wait briefly for the last words. */
  release(why: 'released' | 'max' | 'auto' = 'released'): void {
    if (!this.rec || this.state === 'finishing') return;
    const session = this.session;
    this.releasedAt = this.now();
    this.clearAuto();
    this.stopMeter();
    this.setState('finishing');
    try {
      this.rec.stop();
    } catch {
      /* already stopping */
    }
    this.waitTimer = setTimeout(() => session === this.session && this.finish(why === 'max' ? 'max' : this.auto ? 'auto' : 'released'), this.opts.finalWaitMs ?? 1500);
  }

  /** Throw this hold away (no onDone). */
  cancel(): void {
    if (!this.rec && this.state === 'idle') return;
    this.abort();
    if (!this.blocked) this.setState('idle');
  }

  private abort() {
    const rec = this.rec;
    this.rec = null;
    this.session += 1;
    this.clearTimers();
    this.stopMeter();
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
    rec.onaudiostart = null;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }

  private finish(reason: HoldResult['reason']) {
    if (!this.rec) return;
    const result: HoldResult = {
      text: (this.finalText || this.text).trim(),
      audio: this.audio,
      reason,
      heldMs: (this.releasedAt || this.now()) - this.pressedAt,
    };
    this.abort();
    if (reason === 'denied') return; // state already says so
    this.setState(reason === 'error' ? 'error' : 'idle', reason === 'error' ? TRY_AGAIN : undefined);
    this.handlers.onDone(result);
  }

  private onResult(e: RecognitionResultEventLike) {
    let all = '';
    let finals = '';
    let allFinal = true;
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      const t = String(r?.[0]?.transcript ?? '');
      all += t;
      if (r?.isFinal) finals += t;
      else allFinal = false;
    }
    const text = all.replace(/\s+/g, ' ').trim();
    if (!this.audio) { this.audio = true; if (this.state === 'starting') this.setState('listening'); }
    if (!this.meterLive) this.bumpPulse();
    if (text === this.text && !allFinal) return;
    this.text = text;
    if (allFinal) this.finalText = finals.replace(/\s+/g, ' ').trim();
    this.handlers.onText(text, allFinal && this.releasedAt > 0);
    if (this.auto && allFinal && text) this.armAuto();
    else if (this.auto) this.clearAuto();
  }

  /** Tap-to-talk: a pause after a finished phrase ends it. */
  private armAuto() {
    this.clearAuto();
    const session = this.session;
    this.autoTimer = setTimeout(() => session === this.session && this.release('auto'), 900);
  }

  private clearAuto() {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private clearTimers() {
    this.clearAuto();
    if (this.waitTimer) clearTimeout(this.waitTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.waitTimer = this.maxTimer = null;
  }

  private onError(error: string, message?: string) {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        this.blocked = 'denied';
        this.finish('denied');
        this.setState('denied', DENIED);
        return;
      case 'language-not-supported':
        this.blocked = 'unsupported';
        this.finish('denied');
        this.setState('unsupported', UNSUPPORTED);
        return;
      case 'audio-capture':
        // no microphone, or the level meter and the recognizer fought over it: drop the meter from now on
        if (this.meterLive || this.meter) this.meter = null;
        this.finish('error');
        return;
      case 'no-speech':
      case 'aborted':
        return; // `end` follows
      default:
        console.warn('[voice] hold-to-talk recognition error:', error, message || '');
        if (!this.text) this.finish('error');
    }
  }

  // ---- level
  private startMeter(session: number) {
    const m = this.meter;
    if (!m) return this.startPulse();
    void m.start((l) => session === this.session && this.handlers.onLevel?.(l)).then((ok) => {
      if (session !== this.session) { if (ok) m.stop(); return; }
      this.meterLive = ok;
      if (!ok) this.startPulse();
    });
  }

  private stopMeter() {
    if (this.meterLive) this.meter?.stop();
    this.meterLive = false;
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.pulseTimer = null;
    this.pulse = 0;
    this.handlers.onLevel?.(0);
  }

  private startPulse() {
    if (this.pulseTimer || !this.handlers.onLevel) return;
    this.pulseTimer = setInterval(() => {
      this.pulse *= 0.82;
      this.handlers.onLevel?.(this.pulse);
    }, 33);
  }

  private bumpPulse() {
    this.pulse = Math.min(1, this.pulse + 0.55);
  }

  dispose(): void {
    this.abort();
  }
}

const UNSUPPORTED = "This browser can't hear you, so tap a magic word instead.";
const DENIED = 'The microphone is off, so tap a magic word instead.';
const TRY_AGAIN = "Cheer Bear didn't catch that. Hold and try again.";

/** Mic level from getUserMedia + an analyser. Resolves false when the mic cannot be opened (no prompt loop). */
export class MicMeter implements MeterLike {
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private gen = 0;

  async start(onLevel: (l: number) => void): Promise<boolean> {
    const gen = ++this.gen;
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (gen !== this.gen) { stream.getTracks().forEach((t) => t.stop()); return false; }
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.5;
      src.connect(an);
      this.stream = stream;
      this.src = src;
      const buf = new Float32Array(an.fftSize);
      let level = 0;
      const tick = () => {
        if (gen !== this.gen) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const target = Math.min(1, Math.max(0, (rms - 0.01) * 7));
        level += (target - level) * (target > level ? 0.6 : 0.18);
        onLevel(level);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
      return true;
    } catch (err) {
      console.info('[voice] mic level meter unavailable:', (err as Error)?.name || err);
      return false;
    }
  }

  stop(): void {
    this.gen += 1;
    cancelAnimationFrame(this.raf);
    try { this.src?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.src = null;
  }
}
