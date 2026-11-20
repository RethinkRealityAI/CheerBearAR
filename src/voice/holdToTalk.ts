// Voice mode's ears: one press of the talk button = one listening session with the browser's own speech recognition
// (SpeechRecognition / webkitSpeechRecognition), continuous with interim results while held, stopped on release, then
// a wait for the final words.
//
// Voice-4 (Dapo: "when pressing and holding the mic, it says it can't hear me"), what changed and why:
//   - NO second microphone stream while recognising. Round 3 opened a getUserMedia level meter next to the
//     recogniser; on Android (one capture client at a time) and iOS (separate mic sessions) the recogniser then hears
//     silence. The ring now follows recognition's own events (audiostart, soundstart, speechstart, each result). The
//     meter is opt-in only (`?voicemeter`, for A/B tests on a device).
//   - `start()` stays synchronous inside the press (iOS needs the gesture; nothing is awaited before it).
//   - A fresh recogniser per press, and per restart: if the browser ends recognition by itself while the button is
//     still held (Android stops after ~1-2 s of silence, `no-speech`, a stray `aborted`), we start a new one and keep
//     the words so far, so a child who pauses before speaking is not told "I didn't hear you".
//   - Letting go before the mic opened (the permission prompt) does not stop the recogniser mid-prompt: it waits for
//     the start, then aborts quietly, so the prompt can be answered.
//   - After the release we wait for `end` (the recogniser's own "done"), up to 1.5 s with words, 4 s without (Android
//     and some recognisers give no interim results: the only words come after the release).
//   - Every error code ends in a specific `problem` (see voiceHelp.ts) instead of one "try again".
//   - Android repeats earlier phrases inside later results in continuous mode: repeated prefixes are folded.
//   - Everything is written to the Mic check log (voiceLog.ts).
//
// Honest note: this is not on-device. Chrome sends the audio to Google's speech service, Safari to Apple's (free, no
// key). Firefox and some in-app browsers have no recognition at all: `supported` is false and the app falls back to
// buttons. Nothing here talks to our server or to any AI.
//
// Pure of the app: the recognition constructor, the meter and the permission check are injectable (tests fake them).
import { getAudioContext } from '../audio/context';
import { browserRecognition, type RecognitionFactory, type RecognitionLike, type RecognitionResultEventLike } from './speechInput';
import { problemFromError, type HoldProblem } from './voiceHelp';
import { voiceLog } from './voiceLog';

export type HoldState = 'idle' | 'starting' | 'listening' | 'finishing' | 'unsupported' | 'denied' | 'error';
export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface HoldResult {
  /** Everything heard in this hold (final words, else the last interim). */
  text: string;
  /** The microphone actually started (false: released before it opened, e.g. during the permission prompt). */
  audio: boolean;
  reason: 'released' | 'auto' | 'no-speech' | 'error' | 'denied' | 'max';
  /** How long the button was held (ms), from press to release. */
  heldMs: number;
  /** Why nothing usable came back (only when `text` is empty, or an error ended it). */
  problem?: HoldProblem;
  /** The last error code the browser gave in this hold ('' if none). */
  error: string;
  /** Recognisers restarted inside this hold (the browser ended one while still held). */
  restarts: number;
  /** Press -> mic open (ms); -1 if it never opened. Long = the browser was asking for permission. */
  startDelayMs: number;
}

export interface HoldHandlers {
  /** The words so far (grows; `final` once the browser has settled them all). */
  onText(text: string, final: boolean): void;
  onState(state: HoldState, message?: string): void;
  /** The hold is over (not called after cancel()). */
  onDone(result: HoldResult): void;
  /** Mic level 0..1 at ~30 fps while listening (from recognition events; a real meter only with `?voicemeter`). */
  onLevel?(level: number): void;
}

export interface MeterLike {
  start(onLevel: (l: number) => void): Promise<boolean>;
  stop(): void;
}

export interface HoldOptions {
  lang?: string;
  /** After release, with words already heard: wait this long for the final words (default 1500 ms). */
  finalWaitMs?: number;
  /** After release, nothing heard yet: wait this long for a late final (default 4000 ms). */
  finalWaitEmptyMs?: number;
  /** Released before the mic opened: wait this long for it to open (permission prompt), then drop it (10 s). */
  startWaitMs?: number;
  /** A hold longer than this ends by itself (default 15 s; tap-to-talk 9 s). */
  maxMs?: number;
  /** Browser ended recognition while still held: start a new one, at most this many times per hold (default 4). */
  maxRestarts?: number;
  /** Mic level meter. Default: none (it fights the recogniser for the mic); `?voicemeter` opts in. */
  meter?: MeterLike | null;
  /** continuous / interimResults (defaults true / true; the Mic check can try other combinations). */
  continuous?: boolean;
  interim?: boolean;
  /** The microphone permission right now (Permissions API). Used to tell a real "denied" from a dismissed prompt. */
  permission?: () => Promise<MicPermission>;
  /** Label in the Mic check log ('app', 'diag'). */
  tag?: string;
  now?(): number;
}

let holdSeq = 0;

export class HoldListener {
  private rec: RecognitionLike | null = null;
  private session = 0;
  private hold = 0;
  private state: HoldState = 'idle';
  private blocked: 'unsupported' | 'denied' | null = null;
  /** Words from recognisers that already ended in this hold (restarts). */
  private prefix = '';
  private text = '';
  private finalText = '';
  private audio = false;
  private pressedAt = 0;
  private openedAt = 0;
  private releasedAt = 0;
  private releaseWhy: 'released' | 'max' | 'auto' = 'released';
  /** Released before the mic opened: abort as soon as it opens. */
  private releasePending = false;
  private auto = false;
  private restarts = 0;
  private recStartedAt = 0;
  private quickEnds = 0;
  private lastError = '';
  private fatal: HoldProblem | null = null;
  private permPending = false;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private meter: MeterLike | null;
  private meterLive = false;
  private pulse = 0;
  private base = 0;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private problem: HoldProblem | null = null;
  private now: () => number;

  constructor(private handlers: HoldHandlers, private factory: RecognitionFactory | null = browserRecognition(), private opts: HoldOptions = {}) {
    this.meter = opts.meter === undefined ? (meterOptIn() ? new MicMeter() : null) : opts.meter;
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

  /** The problem that ended the last hold (or made press() fail). */
  get lastProblem(): HoldProblem | null {
    return this.problem;
  }

  get current(): HoldState {
    return this.state;
  }

  get active(): boolean {
    return this.state === 'starting' || this.state === 'listening' || this.state === 'finishing';
  }

  /** The microphone permission came back (Settings changed): pressing can work again. */
  unblock(): void {
    if (this.blocked !== 'denied') return;
    this.blocked = null;
    this.log('unblocked', 'permission granted');
    if (!this.active) this.setState('idle');
  }

  private setState(s: HoldState, message?: string) {
    if (s === this.state && !message) return;
    this.state = s;
    this.handlers.onState(s, message);
  }

  private log(ev: string, detail?: string) {
    voiceLog(this.hold, ev, detail);
  }

  /**
   * Start listening. Call from the press (pointerdown / keydown / tap): the first start needs a user gesture, so
   * nothing here awaits before `start()`. `auto`: tap-to-talk, it stops by itself shortly after you pause.
   * False when it cannot listen here (see `unavailable` / `lastProblem`).
   */
  press(opts: { auto?: boolean } = {}): boolean {
    if (this.blocked || !this.factory) {
      this.problem = this.blocked === 'denied' ? 'not-allowed' : 'unsupported';
      this.setState(this.blocked ?? 'unsupported');
      return false;
    }
    if (this.active) this.abort();
    this.hold = ++holdSeq;
    this.prefix = this.text = this.finalText = '';
    this.audio = false;
    this.auto = !!opts.auto;
    this.pressedAt = this.now();
    this.openedAt = this.releasedAt = 0;
    this.releaseWhy = 'released';
    this.releasePending = false;
    this.restarts = this.quickEnds = 0;
    this.lastError = '';
    this.fatal = null;
    this.permPending = false;
    this.problem = null;
    const g = globalThis as { speechSynthesis?: { speaking?: boolean }; navigator?: { onLine?: boolean } };
    this.log('press', `${this.opts.tag ?? 'app'}${this.auto ? ' tap-to-talk' : ''}; tts speaking=${!!g.speechSynthesis?.speaking}; online=${g.navigator?.onLine ?? '?'}; meter=${this.meter ? 'on' : 'off'}`);
    const session = ++this.session;
    if (!this.startRec(session)) return false;
    this.setState('starting');
    this.maxTimer = setTimeout(() => session === this.session && this.release('max'), this.opts.maxMs ?? (this.auto ? 9000 : 15000));
    return true;
  }

  /** A fresh recogniser, wired and started. False (and the hold is over) when it cannot start. */
  private startRec(session: number): boolean {
    let rec: RecognitionLike;
    try {
      rec = this.factory!();
    } catch (err) {
      console.warn('[voice] speech recognition unavailable:', err);
      this.log('new Recognition() threw', String((err as Error)?.name || err));
      if (this.restarts === 0) {
        this.blocked = 'unsupported';
        this.problem = 'unsupported';
        this.setState('unsupported');
        return false;
      }
      this.finish('error', 'start-failed');
      return false;
    }
    rec.continuous = this.opts.continuous ?? true;
    rec.interimResults = this.opts.interim ?? true;
    rec.lang = this.opts.lang ?? 'en-US';
    rec.maxAlternatives = 1;
    const live = () => session === this.session && this.rec === rec;
    const ev = (name: string, fn?: () => void) => () => { if (!live()) return; this.log(name); fn?.(); };
    rec.onstart = ev('start', () => this.opened());
    rec.onaudiostart = ev('audiostart', () => this.opened());
    rec.onsoundstart = ev('soundstart', () => { this.base = Math.max(this.base, 0.3); });
    rec.onspeechstart = ev('speechstart', () => { this.base = 0.42; });
    rec.onspeechend = ev('speechend', () => { this.base = 0.2; });
    rec.onsoundend = ev('soundend', () => { this.base = 0.14; });
    rec.onaudioend = ev('audioend');
    rec.onnomatch = ev('nomatch');
    rec.onresult = (e) => live() && this.onResult(e);
    rec.onerror = (e) => { if (!live()) return; this.log('error', `${e.error}${e.message ? ` "${e.message}"` : ''}`); this.onError(e.error); };
    rec.onend = () => { if (!live()) return; this.log('end'); this.onEnd(session); };
    this.rec = rec;
    this.recStartedAt = this.now();
    try {
      rec.start();
      this.log('start()', `continuous=${rec.continuous} interim=${rec.interimResults} lang=${rec.lang}${this.restarts ? ` restart ${this.restarts}` : ''}`);
    } catch (err) {
      const name = String((err as Error)?.name || err);
      console.warn('[voice] speech recognition start failed:', err);
      this.log('start() threw', name);
      this.rec = null;
      if (this.restarts === 0) {
        this.problem = 'start-failed';
        this.session += 1;
        this.setState('idle');
        return false;
      }
      this.rec = rec; // finish() needs a live hold
      this.finish('error', 'start-failed');
      return false;
    }
    return true;
  }

  private opened() {
    if (this.audio) return;
    this.audio = true;
    this.openedAt = this.now();
    if (this.releasePending) {
      // let go during the permission prompt: the mic opened now, nobody is holding: drop it quietly
      this.log('released before the mic opened', 'stopping now');
      this.finish('released', 'too-short');
      return;
    }
    if (this.state === 'starting') this.setState('listening');
    this.startLevel();
  }

  /** Let go: stop listening and wait for the last words. */
  release(why: 'released' | 'max' | 'auto' = 'released'): void {
    if (!this.rec || this.state === 'finishing') return;
    const session = this.session;
    this.releasedAt = this.now();
    this.releaseWhy = why;
    this.clearAuto();
    this.stopLevel();
    this.setState('finishing');
    this.log('release', `${why}; held ${this.releasedAt - this.pressedAt} ms; words so far "${this.full()}"`);
    if (!this.audio) {
      // the mic has not opened yet (permission prompt, slow start): stopping now can kill the prompt. Wait for it.
      this.releasePending = true;
      this.waitTimer = setTimeout(() => session === this.session && this.finish('released'), this.opts.startWaitMs ?? 10_000);
      return;
    }
    try {
      this.rec.stop();
      this.log('stop()');
    } catch {
      /* already stopping */
    }
    const wait = this.full() ? this.opts.finalWaitMs ?? 1500 : this.opts.finalWaitEmptyMs ?? 4000;
    this.waitTimer = setTimeout(() => { if (session === this.session) { this.log('final wait over', `${wait} ms`); this.finish(this.endReason()); } }, wait);
  }

  private endReason(): HoldResult['reason'] {
    return this.releaseWhy === 'max' ? 'max' : this.auto ? 'auto' : 'released';
  }

  /** Throw this hold away (no onDone). */
  cancel(): void {
    if (!this.rec && this.state === 'idle') return;
    this.log('cancel');
    this.abort();
    if (!this.blocked) this.setState('idle');
  }

  private abort() {
    const rec = this.rec;
    this.rec = null;
    this.session += 1;
    this.clearTimers();
    this.stopLevel();
    if (!rec) return;
    unhook(rec);
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }

  private full(): string {
    return joinWords(this.prefix, this.finalText || this.text);
  }

  private finish(reason: HoldResult['reason'], problem?: HoldProblem) {
    if (!this.rec) return;
    const text = this.full();
    let p: HoldProblem | undefined = problem;
    if (!text && !p) p = this.fatal ?? (this.audio ? (this.lastError === 'audio-capture' || this.lastError === 'network' ? problemFromError(this.lastError) : 'no-speech') : 'too-short');
    const result: HoldResult = {
      text,
      audio: this.audio,
      reason,
      heldMs: (this.releasedAt || this.now()) - this.pressedAt,
      problem: p,
      error: this.lastError,
      restarts: this.restarts,
      startDelayMs: this.openedAt ? this.openedAt - this.pressedAt : -1,
    };
    this.problem = p ?? null;
    this.log('done', `${reason}; text "${text}"${p ? `; problem ${p}` : ''}; restarts ${this.restarts}`);
    this.abort();
    this.setState(this.blocked ?? 'idle');
    this.handlers.onDone(result);
  }

  private onResult(e: RecognitionResultEventLike) {
    let all = '';
    let finals = '';
    let allFinal = true;
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      const t = String(r?.[0]?.transcript ?? '').replace(/\s+/g, ' ').trim();
      parts.push(`${r?.isFinal ? 'final' : 'interim'} "${t}"${typeof r?.[0]?.confidence === 'number' ? ` ${r[0].confidence.toFixed(2)}` : ''}`);
      all = foldRepeat(all, t);
      if (r?.isFinal) finals = foldRepeat(finals, t);
      else allFinal = false;
    }
    this.log('result', parts.join(' | '));
    if (!this.audio) this.opened();
    if (!this.rec) return; // opened() finished a released-early hold
    this.lastError = this.lastError === 'no-speech' ? '' : this.lastError;
    if (!this.meterLive) this.bumpPulse();
    if (all === this.text && !allFinal) return;
    this.text = all;
    if (allFinal) this.finalText = finals;
    this.handlers.onText(this.full(), allFinal && this.releasedAt > 0);
    if (this.auto && allFinal && all) this.armAuto();
    else if (this.auto) this.clearAuto();
  }

  /** The recogniser ended: after our stop() that is the end of the hold; while still held, start a fresh one. */
  private onEnd(session: number) {
    if (this.permPending) return; // a not-allowed is being checked: that decides
    if (this.fatal) return this.finish('error', this.fatal);
    if (this.releasedAt) return this.finish(this.endReason());
    // ended by itself while the button is still held
    const heard = joinWords(this.prefix, this.finalText || this.text);
    if (this.auto && heard) return this.finish('auto');
    const quick = this.now() - this.recStartedAt < 400;
    this.quickEnds = quick ? this.quickEnds + 1 : 0;
    const max = this.opts.maxRestarts ?? 4;
    if (this.restarts >= max || this.quickEnds >= 2 || ['network', 'audio-capture', 'not-allowed', 'service-not-allowed'].includes(this.lastError)) {
      return this.finish('no-speech');
    }
    this.restarts += 1;
    this.prefix = heard;
    this.text = this.finalText = '';
    this.log('restart', `ended while held${this.lastError ? ` after ${this.lastError}` : ''}`);
    if (this.rec) unhook(this.rec);
    this.startRec(session);
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

  private onError(error: string) {
    this.lastError = error;
    switch (error) {
      case 'not-allowed': {
        if (this.restarts > 0) return; // a restart without a gesture (iOS): end follows, keep the words
        // a real "no", or a dismissed prompt / no gesture? Ask the Permissions API before blocking the session.
        const session = this.session;
        this.fatal = 'not-allowed';
        this.permPending = true;
        const check = this.opts.permission?.() ?? Promise.resolve<MicPermission>('unknown');
        let settled = false;
        const settle = (perm: MicPermission) => {
          if (settled || session !== this.session) return;
          settled = true;
          this.permPending = false;
          this.log('permission', perm);
          const hard = perm === 'denied' || perm === 'unknown';
          if (hard) this.blocked = 'denied';
          this.finish('denied', hard ? 'not-allowed' : 'not-allowed-soft');
        };
        void check.then(settle, () => settle('unknown'));
        setTimeout(() => settle('unknown'), 800);
        return;
      }
      case 'service-not-allowed':
        this.blocked = 'denied';
        this.finish('denied', 'service-not-allowed');
        return;
      case 'language-not-supported':
        this.blocked = 'unsupported';
        this.finish('denied', 'unsupported');
        return;
      case 'audio-capture':
      case 'network':
        // nothing will come; with words already heard keep them (end follows)
        if (!this.full()) this.fatal = problemFromError(error);
        return;
      case 'no-speech':
      case 'aborted':
        return; // `end` follows: still held -> restart; released -> done
      default:
        console.warn('[voice] hold-to-talk recognition error:', error);
        if (!this.full()) this.fatal = 'error';
    }
  }

  // ---- level: recognition events drive it (no second mic stream); a real meter only when opted in
  private startLevel() {
    this.base = 0.14;
    const m = this.meter;
    if (!m) return this.startPulse();
    const session = this.session;
    void m.start((l) => session === this.session && this.handlers.onLevel?.(l)).then((ok) => {
      if (session !== this.session) { if (ok) m.stop(); return; }
      this.meterLive = ok;
      if (!ok) this.startPulse();
    });
  }

  private stopLevel() {
    if (this.meterLive) this.meter?.stop();
    this.meterLive = false;
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.pulseTimer = null;
    this.pulse = 0;
    this.base = 0;
    this.handlers.onLevel?.(0);
  }

  private startPulse() {
    if (this.pulseTimer || !this.handlers.onLevel) return;
    let t = 0;
    this.pulseTimer = setInterval(() => {
      t += 1;
      this.pulse *= 0.82;
      const breathe = 0.04 * Math.sin(t / 9);
      this.handlers.onLevel?.(Math.min(1, Math.max(0, this.base + breathe + this.pulse)));
    }, 33);
  }

  private bumpPulse() {
    this.pulse = Math.min(0.6, this.pulse + 0.5);
  }

  dispose(): void {
    this.abort();
  }
}

/** Android Chrome (continuous mode) repeats earlier phrases at the start of later results: fold them. */
export function foldRepeat(acc: string, next: string): string {
  if (!next) return acc;
  if (!acc) return next;
  const a = acc.toLowerCase();
  const n = next.toLowerCase();
  if (n === a || n.startsWith(`${a} `)) return next;
  if (a.endsWith(n)) return acc;
  return `${acc} ${next}`;
}

function unhook(rec: RecognitionLike) {
  rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
  rec.onaudiostart = rec.onsoundstart = rec.onspeechstart = rec.onspeechend = rec.onsoundend = rec.onaudioend = rec.onnomatch = null;
}

function joinWords(a: string, b: string): string {
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
}

/** `?voicemeter`: open the old getUserMedia level meter next to the recogniser (A/B tests on a device only). */
function meterOptIn(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('voicemeter');
  } catch {
    return false;
  }
}

/** Mic level from getUserMedia + an analyser. Resolves false when the mic cannot be opened (no prompt loop). */
export class MicMeter implements MeterLike {
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private gen = 0;
  /** The last track's label and settings (Mic check). */
  info = '';

  async start(onLevel: (l: number) => void): Promise<boolean> {
    const gen = ++this.gen;
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (gen !== this.gen) { stream.getTracks().forEach((t) => t.stop()); return false; }
      const track = stream.getAudioTracks()[0];
      const st = track?.getSettings?.() ?? {};
      this.info = `${track?.label || 'microphone'}${st.sampleRate ? ` ${st.sampleRate} Hz` : ''}${track?.muted ? ' (muted)' : ''}`;
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
      this.info = `failed: ${(err as Error)?.name || err}`;
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

/** The microphone permission via the Permissions API ('unknown' where it cannot be asked: older Safari, Firefox). */
export async function micPermission(): Promise<MicPermission> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return 'unknown';
    const st = await perms.query({ name: 'microphone' as PermissionName });
    return st.state as MicPermission;
  } catch {
    return 'unknown';
  }
}

/** Watch the microphone permission (Settings changed while the page is open). Returns an unsubscribe. */
export function watchMicPermission(cb: (p: MicPermission) => void): () => void {
  let off = () => undefined as void;
  let dead = false;
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    void perms?.query({ name: 'microphone' as PermissionName }).then((st) => {
      if (dead) return;
      cb(st.state as MicPermission);
      const on = () => cb(st.state as MicPermission);
      st.addEventListener?.('change', on);
      off = () => st.removeEventListener?.('change', on);
    }, () => cb('unknown'));
  } catch {
    cb('unknown');
  }
  return () => { dead = true; off(); };
}
