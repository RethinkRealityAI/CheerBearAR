// The demo call: no Twilio, no OpenAI, no accounts. It rings, connects, Happi greets you ONCE, then waits for
// you. Talk (the browser's speech recognition, while the call is live; mute pauses it) or type in the chat; she
// answers each turn out loud with the browser's voice, her mouth moving with the words (demoBear.ts). Her words go
// through the real trigger pipeline as `cheer_bear` transcripts, so "can you dance?" fires Dance because she
// answers "Let's dance!", and small talk fires nothing, exactly like a real call.
//
// Turn on: ?mockVoice in the URL (options: ?mockVoice=fast for 3x speed, ?mockVoice=silent for no sound, combine
// with a comma: ?mockVoice=fast,silent), or startCall({ mock: true }), or createVoiceSession({ mock: 'always' }).
import type { DemoBear } from './demoBear';
import { SpeechInput, type RecognitionFactory, type SpeechInputState } from './speechInput';

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

export interface MockCallHandlers {
  ringing(): void;
  accepted(): void;
  /** The child's own words from speech recognition (partials and finals). */
  userTranscript(id: string, text: string, final: boolean): void;
  /** Keywords the child's words fire themselves (so her answer does not fire them a second time). */
  userKeywords(text: string): string[];
  listening(state: SpeechInputState, message?: string): void;
}

export class MockCall {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  private live = false;
  private speech: SpeechInput;
  private offTalking: () => void;

  constructor(
    private flags: MockFlags,
    private bear: DemoBear,
    private on: MockCallHandlers,
    recognition?: RecognitionFactory | null,
  ) {
    this.speech = new SpeechInput(
      {
        onResult: (id, text, final) => this.onSpeech(id, text, final),
        onState: (state, message) => !this.stopped && this.on.listening(state, message),
      },
      recognition === undefined ? undefined : recognition,
    );
    this.offTalking = bear.onTalking((t) => this.speech.setBearTalking(t));
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

  /** Call from the tap that starts the call: unlocks speech and the microphone inside the gesture. */
  start(): void {
    this.bear.unlock();
    this.speech.start();
    void this.run();
  }

  private async run() {
    await this.wait(600);
    if (this.stopped) return;
    this.on.ringing();
    await this.wait(1400);
    if (this.stopped) return;
    this.on.accepted();
    await this.wait(700);
    if (this.stopped) return;
    await this.bear.greet();
    if (!this.stopped) this.live = true;
  }

  get isLive(): boolean {
    return this.live && !this.stopped;
  }

  private onSpeech(id: string, text: string, final: boolean) {
    if (this.stopped || !this.live) return; // nothing before she has said hello
    this.on.userTranscript(id, text, final);
    if (final) void this.bear.answer(text, { chat: false, claimed: this.on.userKeywords(text) });
  }

  /** A message typed in the chat during the demo call. */
  userTyped(text: string, claimed: string[]): void {
    if (this.stopped) return;
    void this.bear.answer(text, { chat: true, claimed });
  }

  setMuted(muted: boolean): void {
    this.speech.setPaused(muted);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.speech.stop();
    this.offTalking();
    this.bear.cancel();
  }
}
