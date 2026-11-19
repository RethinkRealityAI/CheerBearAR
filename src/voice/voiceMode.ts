// Voice mode (hold to talk): no call, no Twilio, no AI. Hold the talk button and say what should happen.
//
//   press()   -> HoldListener starts the browser's speech recognition (interim results while held)
//   interim   -> CommandTracker finds commands as soon as they are clearly said; each fires ONCE per hold
//   release() -> recognition stops, the last words are accepted, a short wait for the final adds anything new
//   'commands' events carry what to do; the app runs them (trigger words go through fireTrigger, i.e. the same
//   TriggerPipeline as the call: cooldown, dispatch spacing, the app's word-game rules and toasts all apply)
//   say(line) -> Cheer Bear answers with a short canned line in the browser's voice (claims every keyword, so her
//                line can never fire a moment)
//
// The app gets this from the voice session (`(voice as VoiceSessionExt).voiceMode`); see docs/handoff/voice-3.md.
import type { AppConfig } from '../shared/config';
import { Emitter } from './emitter';
import { CommandTracker, exampleCommands, matchVoiceCommands, type VoiceCommand, type VoiceMatch } from './commands';
import { HoldListener, type HoldResult, type HoldState, type MeterLike } from './holdToTalk';
import { pickReply } from './voiceReplies';
import type { RecognitionFactory } from './speechInput';
import { browserRecognition } from './speechInput';

export type VoiceModePhase = 'interim' | 'release' | 'final' | 'tap';

export interface VoiceModeEvents {
  state: { state: HoldState; message?: string };
  /** What you are saying, live (interim) and at the end (final). */
  text: { text: string; final: boolean };
  level: number;
  /**
   * New commands. `phase`: 'interim' while still held (fire triggers now; camera things wait for the release),
   * 'release' from inside the release handler (a user gesture: camera modes may start here), 'final' after it.
   */
  commands: { matches: VoiceMatch[]; phase: VoiceModePhase };
  /** The hold is over. `matched`: how many commands it ran in total. */
  done: HoldResult & { matched: number };
}

export interface VoiceModeApi {
  /** The browser has speech recognition at all. */
  readonly supported: boolean;
  /** 'unsupported' / 'denied' once known (the app falls back to buttons). */
  readonly unavailable: 'unsupported' | 'denied' | null;
  readonly active: boolean;
  readonly state: HoldState;
  /** From the press (pointerdown / keydown / first tap). False when it cannot listen. */
  press(opts?: { auto?: boolean }): boolean;
  /** From the release (pointerup / keyup / second tap): emits phase 'release' commands synchronously. */
  release(): void;
  cancel(): void;
  /** Run text as if it was said (example chips). Emits phase 'tap' commands. */
  run(text: string): VoiceMatch[];
  /** Fire a trigger word through the call's pipeline (speaker 'user', via 'local'). */
  fireTrigger(keyword: string): void;
  /** A short spoken answer for a command (null when none fits). Speaks only when `speak` is true. */
  reply(command: VoiceCommand, speak: boolean): string | null;
  /** Stop her speaking now (a new hold starts). */
  hush(): void;
  /** Things to suggest saying ("Try saying..."). */
  examples(n?: number): Array<{ say: string; label: string }>;
  on<K extends keyof VoiceModeEvents>(event: K, cb: (payload: VoiceModeEvents[K]) => void): () => void;
  dispose(): void;
}

export interface VoiceModeDeps {
  getConfig(): AppConfig;
  fireTrigger(keyword: string): void;
  /** Speak a fixed line as Cheer Bear (browser voice + mouth + speech bubble). */
  say(line: string): void;
  hush(): void;
  /** Call inside the press: unlock speech synthesis for her answer (iOS). */
  unlock(): void;
  factory?: RecognitionFactory | null;
  meter?: MeterLike | null;
}

export class VoiceMode implements VoiceModeApi {
  private ev = new Emitter<VoiceModeEvents>();
  private listener: HoldListener;
  private tracker: CommandTracker | null = null;
  private matched = 0;

  constructor(private deps: VoiceModeDeps) {
    const factory = deps.factory === undefined ? browserRecognition() : deps.factory;
    this.listener = new HoldListener({
      onText: (text, final) => this.onText(text, final),
      onState: (state, message) => this.ev.emit('state', { state, message }),
      onDone: (r) => this.onDone(r),
      onLevel: (l) => this.ev.emit('level', l),
    }, factory, { meter: deps.meter });
  }

  get supported(): boolean { return this.listener.supported; }
  get unavailable(): 'unsupported' | 'denied' | null { return this.listener.unavailable; }
  get active(): boolean { return this.listener.active; }
  get state(): HoldState { return this.listener.current; }

  on<K extends keyof VoiceModeEvents>(event: K, cb: (payload: VoiceModeEvents[K]) => void): () => void {
    return this.ev.on(event, cb);
  }

  private classifier = () => this.deps.getConfig().localClassifier;

  press(opts: { auto?: boolean } = {}): boolean {
    this.deps.hush();
    try { this.deps.unlock(); } catch { /* ignore */ }
    this.tracker = new CommandTracker(this.classifier);
    this.matched = 0;
    return this.listener.press(opts);
  }

  release(): void {
    if (!this.listener.active) return;
    this.listener.release();
    // the release is a user gesture: hand over what was said so far as final now (camera modes can start in it)
    const t = this.tracker;
    if (t) this.emitCommands(t.finish(), 'release');
  }

  cancel(): void {
    this.listener.cancel();
    this.tracker = null;
  }

  private onText(text: string, final: boolean) {
    this.ev.emit('text', { text, final });
    const t = this.tracker;
    if (!t) return;
    const releasing = this.listener.current === 'finishing';
    this.emitCommands(t.update(text, final || releasing), releasing ? 'final' : 'interim');
  }

  private onDone(r: HoldResult) {
    const t = this.tracker;
    if (t && r.text) {
      this.ev.emit('text', { text: r.text, final: true });
      this.emitCommands(t.update(r.text, true), 'final');
    }
    this.tracker = null;
    this.ev.emit('done', { ...r, matched: this.matched });
  }

  private emitCommands(matches: VoiceMatch[], phase: VoiceModePhase) {
    if (!matches.length) return;
    this.matched += matches.length;
    this.ev.emit('commands', { matches, phase });
  }

  run(text: string): VoiceMatch[] {
    const matches = matchVoiceCommands(text, this.classifier());
    if (matches.length) this.ev.emit('commands', { matches, phase: 'tap' });
    return matches;
  }

  fireTrigger(keyword: string): void {
    this.deps.fireTrigger(keyword);
  }

  reply(command: VoiceCommand, speak: boolean): string | null {
    const line = pickReply(command, this.classifier());
    if (line && speak) this.deps.say(line);
    return line;
  }

  hush(): void {
    this.deps.hush();
  }

  examples(n = 3): Array<{ say: string; label: string }> {
    return exampleCommands(this.classifier().keywords, n);
  }

  dispose(): void {
    this.listener.dispose();
    this.ev.clear();
  }
}
