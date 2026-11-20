// Cheer Bear's side of the demo: her brain (brain.ts) answers, her browser voice (browserVoice.ts) says it, and
// while she talks her words stream as `cheer_bear` partial transcripts (final when she finishes) and her mouth
// shapes go out as VisemeFrames. The transcripts go through the real trigger pipeline in the session, so moments fire
// from what she SAYS, exactly as on a real call. Lines are spoken one at a time, in order.
// Used by the demo call (mock.ts) and for typed chat when no call is live.
import type { AppConfig } from '../shared/config';
import type { VisemeFrame } from '../shared/contracts';
import { BrowserVoice } from './browserVoice';
import { DemoBrain, type BrainAnswer } from './brain';
import type { MockFlags } from './mock';

export interface DemoBearOptions {
  getConfig(): AppConfig;
  flags: MockFlags;
  /** `chat`: an answer to a typed message (the app shows it in the chat whatever the transcript policy). */
  onTranscript(id: string, text: string, final: boolean, chat: boolean): void;
  onVisemes(frame: VisemeFrame | null): void;
  /** Called with a line's transcript id before its first word: keywords that must not fire again for it. */
  claim(id: string, keywords: string[]): void;
}

let lineSeq = 0;

export class DemoBear {
  readonly brain: DemoBrain;
  readonly voice: BrowserVoice;
  private chain: Promise<void> = Promise.resolve();
  private gen = 0;
  private pending = 0;
  private talkingListeners = new Set<(talking: boolean) => void>();
  private disposed = false;

  constructor(private opts: DemoBearOptions) {
    this.brain = new DemoBrain(opts.getConfig);
    this.voice = new BrowserVoice(() => {
      const dv = opts.getConfig().demoVoice;
      return { pitch: dv.pitch, rate: dv.rate, audible: opts.flags.audible, silentSpeed: opts.flags.speed };
    });
  }

  /** Call inside the tap that starts the demo call or sends a chat message (iOS speech unlock). */
  unlock(): void {
    this.voice.unlock();
  }

  /** True while a line is playing or queued. */
  get busy(): boolean {
    return this.pending > 0;
  }

  onTalking(cb: (talking: boolean) => void): () => void {
    this.talkingListeners.add(cb);
    return () => this.talkingListeners.delete(cb);
  }

  private setTalking(t: boolean) {
    for (const cb of [...this.talkingListeners]) {
      try {
        cb(t);
      } catch {
        /* ignore */
      }
    }
  }

  /** The demo call's greeting (once per call). */
  greet(): Promise<void> {
    return this.enqueue(async () => this.brain.greeting(), { chat: false, claimed: [] });
  }

  /**
   * Answers what the child said or typed. `claimed`: keywords their own words already fired. `onReply`: the answer,
   * as soon as it is known (before she says it). An AI answer claims every keyword (it never fires a moment).
   */
  answer(userText: string, opts: { chat: boolean; claimed?: string[]; thinkMs?: number; onReply?(r: BrainAnswer): void }): Promise<void> {
    const reply = this.brain.reply(userText); // starts now (AI request in flight while an earlier line plays)
    const think = (opts.thinkMs ?? 200) / Math.max(1, this.opts.flags.speed);
    const claimed = [...(opts.claimed ?? [])];
    return this.enqueue(async () => {
      const [r] = await Promise.all([reply, sleep(think)]);
      if (r.blockAll) claimed.push(...this.opts.getConfig().localClassifier.keywords);
      try { opts.onReply?.(r); } catch { /* ignore */ }
      return r.text;
    }, { chat: opts.chat, claimed });
  }

  /**
   * Says a fixed line (voice mode's canned answers). `claimed`: keywords that must not fire from it (voice mode
   * passes every keyword, so her answer can never start a moment).
   */
  say(text: string, opts: { chat: boolean; claimed: string[] }): Promise<void> {
    return this.enqueue(async () => text, opts);
  }

  private enqueue(getText: () => Promise<string>, opts: { chat: boolean; claimed: string[] }): Promise<void> {
    const gen = this.gen;
    this.pending += 1;
    const run = async () => {
      try {
        if (gen !== this.gen || this.disposed) return;
        const text = (await getText()).trim().slice(0, 300);
        if (!text || gen !== this.gen || this.disposed) return;
        await this.speakLine(text, opts, gen);
      } catch (err) {
        console.warn('[voice] demo line failed:', err);
      } finally {
        this.pending -= 1;
      }
    };
    const p = this.chain.then(run);
    this.chain = p;
    return p;
  }

  private async speakLine(text: string, opts: { chat: boolean; claimed: string[] }, gen: number) {
    const id = `bear-${Date.now().toString(36)}-${(lineSeq++).toString(36)}`;
    this.opts.claim(id, opts.claimed);
    let last = '';
    this.setTalking(true);
    try {
      const res = await this.voice.speak(text, {
        onWords: (soFar) => {
          if (gen !== this.gen) return;
          const t = soFar.trim();
          if (t && t !== text && t !== last) {
            last = t;
            this.opts.onTranscript(id, t, false, opts.chat);
          }
        },
        onFrame: (frame) => gen === this.gen && this.opts.onVisemes(frame),
      });
      if (!res.cancelled && gen === this.gen) this.opts.onTranscript(id, text, true, opts.chat);
    } finally {
      this.setTalking(false);
      this.opts.onVisemes(null);
    }
  }

  /** Stops what she is saying and drops anything queued. */
  cancel(): void {
    this.gen += 1;
    this.voice.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.voice.dispose();
    this.talkingListeners.clear();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
