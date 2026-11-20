// Voice mode (hold to talk): no call, no Twilio, no AI. Hold the talk button and say what should happen.
//
//   press()   -> HoldListener starts the browser's speech recognition (interim results while held)
//   interim   -> CommandTracker finds commands as soon as they are clearly said; each fires ONCE per hold
//   release() -> recognition stops, the last words are accepted, a short wait for the final adds anything new
//   'commands' events carry what to do; the app runs them (trigger words go through fireTrigger, i.e. the same
//   TriggerPipeline as the call: cooldown, dispatch spacing, the app's word-game rules and toasts all apply)
//   say(line) -> Happi answers with a short canned line in the browser's voice (claims every keyword, so her
//                line can never fire a moment)
//
// The app gets this from the voice session (`(voice as VoiceSessionExt).voiceMode`); see docs/handoff/voice-3.md.
import type { AppConfig } from '../shared/config';
import { Emitter } from './emitter';
import { CommandTracker, exampleCommands, matchVoiceCommands, type VoiceCommand, type VoiceMatch } from './commands';
import { HoldListener, micPermission, watchMicPermission, type HoldResult, type HoldState, type MeterLike, type MicPermission } from './holdToTalk';
import { problemHelp, voicePlatform, type HoldProblem, type ProblemHelp, type VoicePlatform } from './voiceHelp';
import { voiceLog } from './voiceLog';
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
  /**
   * The hold is over. `matched`: how many commands it ran in total. `help`: what to tell the child when nothing
   * usable came back (voice-4: one specific, kind line per cause; `block` = pressing again cannot work).
   */
  done: HoldResult & { matched: number; help: ProblemHelp | null };
}

export interface VoiceModeApi {
  /** The browser has speech recognition at all. */
  readonly supported: boolean;
  /** 'unsupported' / 'denied' once known (the app falls back to buttons). */
  readonly unavailable: 'unsupported' | 'denied' | null;
  readonly active: boolean;
  readonly state: HoldState;
  /** Why the last hold (or press) failed, if it did. */
  readonly lastProblem: HoldProblem | null;
  /** The microphone permission as far as the browser says ('unknown' where it cannot be asked). */
  readonly micPermission: MicPermission;
  readonly platform: VoicePlatform;
  /** The help for a problem (e.g. after press() returned false). */
  help(problem: HoldProblem): ProblemHelp;
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
  /** Speak a fixed line as Happi (browser voice + mouth + speech bubble). */
  say(line: string): void;
  hush(): void;
  /** Call inside the press: unlock speech synthesis for her answer (iOS). */
  unlock(): void;
  factory?: RecognitionFactory | null;
  meter?: MeterLike | null;
  /** Tests: the permission check / watcher and the platform. */
  permission?: () => Promise<MicPermission>;
  watchPermission?: (cb: (p: MicPermission) => void) => () => void;
  platform?: VoicePlatform;
}

export class VoiceMode implements VoiceModeApi {
  private ev = new Emitter<VoiceModeEvents>();
  private listener: HoldListener;
  private tracker: CommandTracker | null = null;
  private matched = 0;
  private perm: MicPermission = 'unknown';
  private permAtPress: MicPermission = 'unknown';
  private stopWatch: () => void = () => undefined;
  private lastProblemSeen: HoldProblem | null = null;
  private repeat = 0;
  readonly platform: VoicePlatform;

  constructor(private deps: VoiceModeDeps) {
    const factory = deps.factory === undefined ? browserRecognition() : deps.factory;
    this.platform = deps.platform ?? voicePlatform();
    const permission = deps.permission ?? micPermission;
    this.listener = new HoldListener({
      onText: (text, final) => this.onText(text, final),
      onState: (state, message) => this.ev.emit('state', { state, message }),
      onDone: (r) => this.onDone(r),
      onLevel: (l) => this.ev.emit('level', l),
    }, factory, { meter: deps.meter, permission, tag: 'app' });
    // the permission, live: a refusal changed back to Allow in Settings unblocks the button without a reload
    const onPerm = (p: MicPermission) => {
      if (p !== this.perm) voiceLog(0, 'mic permission', p);
      this.perm = p;
      if (p === 'granted') this.listener.unblock();
    };
    this.stopWatch = deps.watchPermission ? deps.watchPermission(onPerm) : watchMicPermission(onPerm);
    voiceLog(0, 'voice mode ready', `${this.platform.name}; recognition ${factory ? 'yes' : 'none'}`);
  }

  get supported(): boolean { return this.listener.supported; }
  get unavailable(): 'unsupported' | 'denied' | null { return this.listener.unavailable; }
  get active(): boolean { return this.listener.active; }
  get state(): HoldState { return this.listener.current; }
  get lastProblem(): HoldProblem | null { return this.listener.lastProblem; }
  get micPermission(): MicPermission { return this.perm; }
  help(problem: HoldProblem): ProblemHelp { return problemHelp(problem, this.platform); }

  on<K extends keyof VoiceModeEvents>(event: K, cb: (payload: VoiceModeEvents[K]) => void): () => void {
    return this.ev.on(event, cb);
  }

  private classifier = () => this.deps.getConfig().localClassifier;

  press(opts: { auto?: boolean } = {}): boolean {
    // half duplex: her voice stops before we listen (also so the recogniser never hears her). No speech-synthesis
    // unlock here any more: speaking (even a silent line) in the same gesture as start() can take iOS's audio session
    // away from the recogniser. It happens in the release instead (also a gesture).
    this.deps.hush();
    this.tracker = new CommandTracker(this.classifier);
    this.matched = 0;
    this.permAtPress = this.perm;
    return this.listener.press(opts);
  }

  release(): void {
    if (!this.listener.active) return;
    this.listener.release();
    try { this.deps.unlock(); } catch { /* ignore */ } // after stop(): her answer can speak later (iOS)
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
    let problem = r.text ? undefined : r.problem;
    // let go before the mic opened: during a permission prompt that is "tap Allow", otherwise "keep holding"
    if (problem === 'too-short') {
      const asked = this.permAtPress === 'prompt' || (this.permAtPress === 'unknown' && (r.startDelayMs < 0 || r.startDelayMs > 1500));
      if (asked) problem = 'permission-pending';
    }
    if (problem && problem === this.lastProblemSeen) this.repeat += 1;
    else this.repeat = problem ? 1 : 0;
    this.lastProblemSeen = problem ?? null;
    const help = problem ? problemHelp(problem, this.platform, { repeat: this.repeat }) : null;
    this.ev.emit('done', { ...r, problem, matched: this.matched, help });
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
    this.stopWatch();
    this.listener.dispose();
    this.ev.clear();
  }
}
