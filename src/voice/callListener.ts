// The child's side of the demo call, one TURN at a time (voice-5). Half duplex, like a walkie-talkie that switches
// by itself: the microphone is closed while Cheer Bear talks and opens when she has finished; the child's turn ends
// when the recogniser has settled their words (a final result plus a short grace for more), and Cheer Bear answers.
//
// Why turns instead of one recogniser open for the whole call (round 2):
//   - echo: with the mic open, her voice from the speaker was recognised too. Round 2 ignored results that STARTED
//     while she talked, but a recogniser often keeps one result running from her last words into the child's, so the
//     child's words were dropped with no sign;
//   - iOS: an open recogniser puts the audio session in "call" mode, so her voice went to the earpiece / was ducked;
//   - Android: a continuous recogniser ends after ~1-2 s of silence; round 2 restarted it with a budget of 8 per 20 s,
//     so after ~17 s of quiet (or while she talked) the call stopped listening for good ("can't hear you right now"),
//     and every restart beeps.
// Here a fresh recogniser is opened per turn (and per restart inside a turn: stale instances fail on Android/iOS),
// restarts are bounded per turn, a turn that hears nothing for LISTEN_WINDOW_MS ends quietly ('timeout') and the
// call decides what to do (a "still there?" line once, then wait for a tap). Restarting without a fresh tap failing
// (iOS can refuse) pauses the call's listening instead of blocking it: the next tap on the mic resumes.
//
// Pure of the app: the recognition constructor is injectable (tests fake it).
import { browserRecognition, type RecognitionFactory, type RecognitionLike, type RecognitionResultEventLike } from './speechInput';
import { foldRepeat } from './holdToTalk';
import { voiceLog } from './voiceLog';

export type ListenEnd = 'heard' | 'timeout' | 'paused' | 'blocked' | 'stopped';

export interface CallListenerHandlers {
  /** The words of the current turn so far (`final` once the turn is over). `id` is stable for one turn. */
  onWords(id: string, text: string, final: boolean): void;
  /** The microphone really opened for this turn (the "your turn" moment). */
  onOpen(): void;
  /** The turn is over. `heard`: words in `text`. `timeout`: nobody spoke. `paused`: needs a tap. `blocked`: can't listen. */
  onEnd(end: ListenEnd, text: string, message?: string): void;
}

export interface CallListenerOptions {
  lang?: string;
  /** Nothing heard for this long: the turn ends with 'timeout' (default 14 s). */
  listenWindowMs?: number;
  /** After a final result: wait this long for more words before ending the turn (default 350 ms; the recogniser has
   * already waited for a pause before it sent the final). */
  graceMs?: number;
  /** Interim words that stop changing for this long count as said (some recognisers never send a final; 1.6 s). */
  stableMs?: number;
  /** Fresh recognisers per turn when the browser ends one by itself (default 12). */
  maxRestarts?: number;
}

let instances = 0;

export class CallListener {
  private rec: RecognitionLike | null = null;
  private session = 0;
  private turn = 0;
  private active = false;
  private blockedWhy: string | null = null;
  private everStarted = false;
  private text = '';
  private restarts = 0;
  private quickEnds = 0;
  private networkErrors = 0;
  private openedAt = 0;
  /** When the current recogniser was started (an end soon after = an instant failure). */
  private lastOpen = 0;
  private timers: Record<'window' | 'grace' | 'stable' | 'restart' | 'open', ReturnType<typeof setTimeout> | null> = { window: null, grace: null, stable: null, restart: null, open: null };
  private prefix = `user-${Date.now().toString(36)}${(instances++).toString(36)}`;
  private readonly o: Required<CallListenerOptions>;

  constructor(private h: CallListenerHandlers, private factory: RecognitionFactory | null = browserRecognition(), opts: CallListenerOptions = {}) {
    this.o = { lang: 'en-US', listenWindowMs: 14_000, graceMs: 350, stableMs: 1600, maxRestarts: 12, ...opts };
  }

  get supported(): boolean { return !!this.factory; }
  /** Listening is impossible for this call (no recognition, mic refused...): typing still works. */
  get blocked(): string | null { return this.blockedWhy; }
  get listening(): boolean { return this.active; }
  /** The microphone is open for the current turn (false while the browser still asks for permission). */
  get isOpen(): boolean { return this.active && this.openedAt > 0; }

  /**
   * Opens a turn. Call from a tap when you can (iOS may refuse a start without one); the call loop also calls it
   * after each of her lines. Returns false when listening is blocked.
   */
  listen(opts: { openTimeoutMs?: number } = {}): boolean {
    if (this.blockedWhy) return false;
    if (!this.factory) {
      this.block("This browser can't listen here, so type to Cheer Bear instead.");
      return false;
    }
    this.stop('stopped', true);
    this.active = true;
    this.turn += 1;
    this.text = '';
    this.restarts = 0;
    this.quickEnds = 0;
    this.openedAt = 0;
    this.arm('window', this.o.listenWindowMs, () => this.endTurn(this.text ? 'heard' : 'timeout'));
    // a start that never opens the mic (iOS can ignore a start outside a tap): wait for a tap instead
    const openMs = opts.openTimeoutMs ?? 4000;
    if (openMs > 0) this.arm('open', openMs, () => { if (!this.openedAt) this.endTurn('paused'); });
    this.open();
    return this.active;
  }

  /** Closes the turn without an end event when `silent` (her line starts, mute, hang up). */
  stop(end: ListenEnd = 'stopped', silent = true): void {
    const was = this.active;
    this.active = false;
    for (const k of Object.keys(this.timers) as Array<keyof CallListener['timers']>) this.clear(k);
    this.close();
    if (was && !silent) this.h.onEnd(end, this.text);
  }

  private get turnId() { return `${this.prefix}-${this.turn}`; }

  private open() {
    const factory = this.factory;
    if (!factory || !this.active) return;
    let rec: RecognitionLike;
    try {
      rec = factory();
    } catch (err) {
      console.warn('[voice] speech recognition unavailable:', err);
      this.block("This browser can't listen here, so type to Cheer Bear instead.");
      return;
    }
    const session = ++this.session;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.o.lang;
    rec.maxAlternatives = 1;
    const opened = () => {
      if (session !== this.session || this.openedAt) return;
      this.openedAt = Date.now();
      this.clear('open');
      this.everStarted = true;
      this.h.onOpen();
    };
    rec.onstart = () => { if (session === this.session) { voiceLog(0, 'call: recogniser start'); opened(); } };
    rec.onaudiostart = () => session === this.session && opened();
    rec.onresult = (e) => session === this.session && this.onResult(e);
    rec.onerror = (e) => session === this.session && this.onError(e.error);
    rec.onend = () => session === this.session && this.onRecEnd();
    this.rec = rec;
    this.lastOpen = Date.now();
    try {
      rec.start();
    } catch (err) {
      // InvalidStateError, or iOS refusing a start outside a tap
      console.warn('[voice] speech recognition start failed:', err);
      this.rec = null;
      if (!this.everStarted) this.block("This browser can't listen here, so type to Cheer Bear instead.");
      else this.endTurn('paused');
    }
  }

  private close() {
    const rec = this.rec;
    this.rec = null;
    this.session += 1;
    this.openedAt = 0;
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
    rec.onaudiostart = null;
    try { rec.abort(); } catch { /* ignore */ }
  }

  private onResult(e: RecognitionResultEventLike) {
    if (!this.active) return;
    if (!this.openedAt) { this.openedAt = Date.now(); this.clear('open'); this.everStarted = true; this.h.onOpen(); }
    let all = '';
    let anyInterim = false;
    let finals = 0;
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      const t = String(r?.[0]?.transcript ?? '').trim();
      if (!t) continue;
      all = foldRepeat(all, t); // Android repeats earlier phrases inside later results
      if (r.isFinal) finals += 1;
      else anyInterim = true;
    }
    const text = all.trim();
    if (!text) return;
    this.networkErrors = 0;
    const changed = text !== this.text;
    this.text = text;
    if (changed) this.h.onWords(this.turnId, text, false);
    // someone is talking: the "nobody spoke" window no longer applies
    this.clear('window');
    if (finals > 0 && !anyInterim) {
      this.clear('stable');
      this.arm('grace', this.o.graceMs, () => this.endTurn('heard'));
    } else {
      this.clear('grace');
      if (changed || !this.timers.stable) this.arm('stable', this.o.stableMs, () => this.endTurn('heard'));
    }
  }

  private onError(error: string) {
    voiceLog(0, 'call: recogniser error', error);
    switch (error) {
      case 'not-allowed':
        // after the mic worked in this call, a refusal means "needs a tap" (iOS outside a gesture), not "denied"
        if (this.everStarted) return this.endTurn('paused');
        return this.block('Microphone blocked, so type to Cheer Bear instead.');
      case 'service-not-allowed':
        if (this.everStarted) return this.endTurn('paused');
        return this.block("Cheer Bear can't listen in this browser, so type to her instead.");
      case 'audio-capture':
        return this.block('No microphone found, so type to Cheer Bear instead.');
      case 'language-not-supported':
        return this.block("This browser can't listen in English here, so type to Cheer Bear instead.");
      case 'network':
        this.networkErrors += 1;
        if (this.networkErrors >= 3) return this.endTurn('paused', 'Cheer Bear needs the internet to hear you.');
        return; // `end` follows: restart
      default:
        // no-speech, aborted, nomatch: `end` follows and we restart while the turn is open
    }
  }

  private onRecEnd() {
    this.rec = null;
    if (!this.active) return;
    if (this.text) return this.endTurn('heard'); // ended with words: that's the turn
    const lived = Date.now() - this.lastOpen;
    this.quickEnds = lived < 400 ? this.quickEnds + 1 : 0;
    this.restarts += 1;
    if (this.quickEnds >= 2 || this.restarts > this.o.maxRestarts) {
      // the service keeps failing at once, or keeps ending: stop asking (no endless beeps); a tap resumes
      return this.endTurn(this.everStarted ? 'paused' : 'timeout');
    }
    this.arm('restart', this.restarts > 2 ? 600 : 250, () => {
      if (!this.active || this.rec) return;
      this.open();
    });
  }

  private endTurn(end: ListenEnd, message?: string) {
    if (!this.active) return;
    const text = this.text;
    this.stop('stopped', true);
    if (end === 'heard' && text) this.h.onWords(this.turnId, text, true);
    this.h.onEnd(end === 'heard' && !text ? 'timeout' : end, text, message);
  }

  private block(message: string) {
    this.blockedWhy = message;
    this.stop('stopped', true);
    this.h.onEnd('blocked', '', message);
  }

  private arm(k: keyof CallListener['timers'], ms: number, fn: () => void) {
    this.clear(k);
    this.timers[k] = setTimeout(() => { this.timers[k] = null; fn(); }, ms);
  }

  private clear(k: keyof CallListener['timers']) {
    const t = this.timers[k];
    if (t) clearTimeout(t);
    this.timers[k] = null;
  }

  dispose(): void {
    this.stop('stopped', true);
  }
}
