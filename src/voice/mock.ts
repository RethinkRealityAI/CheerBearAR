// The demo call: no Twilio, no accounts. It rings, connects, Cheer Bear greets you ONCE, then it is your turn. Talk
// (the browser's speech recognition) or type in the chat; she answers each turn out loud with the browser's voice, her
// mouth moving with the words (demoBear.ts). Her words go through the real trigger pipeline as `cheer_bear`
// transcripts, so "can you dance?" fires Dance because she answers "Let's dance!", and small talk fires nothing,
// exactly like a real call.
//
// voice-5: turn taking (callListener.ts). The microphone is closed while she talks and opens ~0.25 s after she has
// finished (no echo, no earpiece routing on iOS, no Android restart loop); your turn ends when your words have
// settled; `turn` events say whose turn it is ('bear' / 'listening' / 'hearing' + your words / 'thinking' / 'paused'
// / 'muted') so the app can show it. Nobody speaks for 14 s: she asks once if you are still there, the next time the
// call waits for a tap on the mic ('paused'). A tap on the mic while she talks interrupts her and listens (barge-in by
// touch: she can't hear you over herself).
//
// Turn on: ?mockVoice in the URL (options: ?mockVoice=fast for 3x speed, ?mockVoice=silent for no sound, combine
// with a comma: ?mockVoice=fast,silent), or startCall({ mock: true }), or createVoiceSession({ mock: 'always' }).
import type { DemoBear } from './demoBear';
import { CallListener, type ListenEnd } from './callListener';
import type { RecognitionFactory, SpeechInputState } from './speechInput';

export interface MockFlags {
  enabled: boolean;
  speed: number;
  audible: boolean;
}

/** Reads ?mockVoice flags from the page URL. */
export function mockFlagsFromUrl(search = typeof location !== 'undefined' ? location.search : ''): MockFlags {
  const params = new URLSearchParams(search);
  if (!params.has('mockVoice')) return { enabled: false, speed: 1, audible: true };
  const flags = (params.get('mockVoice') || '').toLowerCase().split(',').map((s) => s.trim());
  return { enabled: !['0', 'false', 'off'].includes(flags[0] || ''), speed: flags.includes('fast') ? 3 : 1, audible: !flags.includes('silent') };
}

export type CallTurnPhase = 'off' | 'bear' | 'listening' | 'hearing' | 'thinking' | 'paused' | 'muted';

/** Whose turn it is in the demo call (the app shows it on the mic button). `text`: your words while 'hearing'. */
export interface CallTurn {
  phase: CallTurnPhase;
  text?: string;
  message?: string;
}

export interface MockCallHandlers {
  ringing(): void;
  accepted(): void;
  /** The child's own words from speech recognition (partials and the final of each turn). */
  userTranscript(id: string, text: string, final: boolean): void;
  /** Keywords the child's words fire themselves (so her answer does not fire them a second time). */
  userKeywords(text: string): string[];
  /** Listening state for the debug view and the "type instead" message. */
  listening(state: SpeechInputState, message?: string): void;
  turn(t: CallTurn): void;
  /** The child finished a spoken turn: answer it (commands or the brain). Resolves once her answer has been said. */
  userTurn(text: string, claimed: string[]): Promise<void>;
}

/** Said once when nobody has spoken for a while (no trigger words: every keyword is claimed for it anyway). */
const STILL_THERE = [
  "I'm still here! You can ask me for a joke, or ask me to show you my moves.",
  'Are you still there, friend? Ask me anything you like!',
];

/** iOS Safari 16.4+: hint the audio session (her voice on the loud speaker while the mic is closed). Best effort. */
function audioSession(type: 'playback' | 'auto') {
  try {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (s && s.type !== type) s.type = type;
  } catch {
    /* not supported */
  }
}

export class MockCall {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  private live = false;
  /** Connected (from 'accepted'): a tap may interrupt even the greeting. */
  private connected = false;
  private muted = false;
  private listener: CallListener;
  private offTalking: () => void;
  private warming = false;
  private idle = 0;
  private phase: CallTurnPhase = 'off';
  private listenGen = 0;
  private nudge = 0;

  constructor(
    private flags: MockFlags,
    private bear: DemoBear,
    private on: MockCallHandlers,
    recognition?: RecognitionFactory | null,
    private getKeywords: () => string[] = () => [],
  ) {
    this.listener = new CallListener(
      {
        onOpen: () => this.onOpen(),
        onWords: (id, text, final) => this.onWords(id, text, final),
        onEnd: (end, text, message) => this.onEnd(end, text, message),
      },
      recognition === undefined ? undefined : recognition,
    );
    this.offTalking = bear.onTalking((t) => {
      if (this.stopped) return;
      if (t) {
        // half duplex: the mic closes before her voice starts. A warm-up still waiting on the permission prompt is
        // left alone (aborting it would cancel the prompt); it closes itself once the mic opens.
        if (this.warming && this.listener.listening && !this.listener.isOpen) { /* permission prompt up */ } else {
          this.listener.stop();
          this.warming = false;
        }
        this.listenGen += 1;
        audioSession('playback');
        this.setPhase('bear');
      }
    });
  }

  get turn(): CallTurn {
    return { phase: this.phase };
  }

  private setPhase(phase: CallTurnPhase, extra: Omit<CallTurn, 'phase'> = {}) {
    if (phase === this.phase && !extra.text && !extra.message) return;
    this.phase = phase;
    this.on.turn({ phase, ...extra });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms / this.flags.speed);
      this.timers.add(t);
    });
  }

  /** Call from the tap that starts the call: unlocks speech, and opens the mic once inside the gesture (this is when
   * the browser asks for the microphone, during the ringing). It closes again as soon as it has opened. */
  start(): void {
    this.bear.unlock();
    if (this.listener.supported) {
      this.warming = true;
      this.listener.listen({ openTimeoutMs: 0 });
    } else this.listener.listen(); // reports 'blocked' (type instead)
    void this.run();
  }

  private async run() {
    await this.wait(600);
    if (this.stopped) return;
    this.on.ringing();
    await this.wait(1400);
    if (this.stopped) return;
    this.on.accepted();
    this.connected = true;
    await this.wait(700);
    if (this.stopped) return;
    await this.bear.greet();
    if (this.stopped) return;
    this.live = true;
    this.afterBear();
  }

  get isLive(): boolean {
    return this.live && !this.stopped;
  }

  /** Her line(s) are done: after a short gap (the room's echo of her voice), it is the child's turn. */
  private afterBear() {
    if (this.stopped || !this.live || this.muted || this.bear.busy || this.listener.listening) return;
    if (this.listener.blocked) return this.setPhase('off', { message: this.listener.blocked });
    if (this.phase === 'paused') return;
    const gen = ++this.listenGen;
    void this.wait(250).then(() => {
      if (gen !== this.listenGen || this.stopped || this.muted || this.bear.busy) return;
      this.openTurn();
    });
  }

  private openTurn() {
    audioSession('auto');
    this.warming = false;
    // the phase becomes 'listening' when the mic says it is open (onOpen)
    if (!this.listener.listen()) this.setPhase('off', { message: this.listener.blocked ?? undefined });
  }

  private onOpen() {
    if (this.warming) {
      // the permission is settled and the mic works: close it again until it is the child's turn
      this.warming = false;
      this.listener.stop();
      this.on.listening('live', undefined);
      if (this.live && !this.bear.busy) this.afterBear();
      return;
    }
    this.on.listening('live');
    this.setPhase('listening');
  }

  private onWords(id: string, text: string, final: boolean) {
    if (this.stopped || this.warming || !this.live) return;
    this.on.userTranscript(id, text, final);
    if (!final) this.setPhase('hearing', { text });
  }

  private onEnd(end: ListenEnd, text: string, message?: string) {
    if (this.stopped) return;
    if (this.warming) {
      this.warming = false;
      if (end === 'blocked') this.on.listening(/blocked|allow/i.test(message ?? '') ? 'denied' : 'unsupported', message);
      return;
    }
    switch (end) {
      case 'heard': {
        this.idle = 0;
        this.setPhase('thinking', { text });
        void this.on.userTurn(text, this.on.userKeywords(text)).finally(() => this.afterBear());
        return;
      }
      case 'timeout':
        this.idle += 1;
        if (this.idle === 1) {
          this.setPhase('thinking');
          void this.bear.say(STILL_THERE[this.nudge++ % STILL_THERE.length], { chat: false, claimed: this.getKeywords() }).finally(() => this.afterBear());
        } else this.setPhase('paused');
        return;
      case 'paused':
        this.setPhase('paused', message ? { message } : {});
        return;
      case 'blocked':
        this.on.listening(/blocked|allow/i.test(message ?? '') ? 'denied' : 'error', message);
        this.setPhase('off', message ? { message } : {});
        return;
      default:
    }
  }

  /**
   * A tap on the mic (a user gesture): she stops talking if she is, and the child's turn starts now. Also resumes a
   * paused call (nobody spoke, or the browser wanted a tap to listen again).
   */
  listenNow(): boolean {
    if (this.stopped || !this.connected || this.muted || this.listener.blocked) return false;
    this.idle = 0;
    this.bear.cancel();
    this.listenGen += 1;
    this.openTurn();
    return true;
  }

  /** A message typed in the chat during the demo call. */
  userTyped(text: string, claimed: string[]): void {
    if (this.stopped) return;
    this.listener.stop();
    this.listenGen += 1;
    this.idle = 0;
    this.setPhase('thinking');
    void this.bear.answer(text, { chat: true, claimed }).finally(() => this.afterBear());
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted) {
      this.listener.stop();
      this.listenGen += 1;
      this.setPhase('muted');
    } else {
      this.setPhase('paused');
      if (!this.bear.busy) this.listenNow();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listener.dispose();
    this.offTalking();
    this.bear.cancel();
    audioSession('auto');
    this.phase = 'off';
    this.on.listening('off');
  }
}
