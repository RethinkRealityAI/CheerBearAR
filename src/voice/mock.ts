// Demo call: no Twilio, no OpenAI. Rings, "connects", then Cheer Bear "says" scripted lines that contain every core
// trigger word: word-by-word partial transcripts, then a final, while a sample voice plays into `remoteStream`.
// The transcripts go through the real trigger pipeline, so transcript -> trigger -> animation and stream -> lip sync
// can be demoed and tested with no accounts.
//
// Turn on: ?mockVoice in the URL (options: ?mockVoice=fast for 3x speed, ?mockVoice=silent for no sound, combine
// with a comma: ?mockVoice=fast,silent), or startCall({ mock: true }), or createVoiceSession({ mock: 'always' }).
import { createMockVoiceAudio, type MockVoiceAudio } from './mockAudio';

export const MOCK_SCRIPT: readonly string[] = [
  "Hi friend! It's me, Cheer Bear. Welcome to my house in Care-a-Lot!",
  'Look at the rainbow on my tummy. It makes everything sparkle!',
  "Do you want to dance with me? Let's have a party!",
  'I love to wave hello to all my friends.',
  'Brrr, it feels a little cold up here in the clouds.',
  'Sometimes I do a little magic to cheer everyone up.',
  'All that running around makes me feel sleepy.',
  'Good morning! Time to wake up and play again!',
];

const REPLIES: readonly string[] = [
  'Ooh, I love that! It makes me want to dance!',
  'That sounds like magic to me!',
  "Let's celebrate with a party!",
];

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
  accepted(stream: MediaStream | null): void;
  transcript(id: string, text: string, final: boolean): void;
}

export class MockCall {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private audio: MockVoiceAudio | null = null;
  private stopped = false;
  private line = 0;
  private seq = 0;
  private speaking = false;
  private pendingReplies: string[] = [];

  constructor(private flags: MockFlags, private on: MockCallHandlers) {}

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms / this.flags.speed);
      this.timers.add(t);
    });
  }

  async start(): Promise<void> {
    // Load the sample while "ringing" (the AudioContext was unlocked by the tap that started the call).
    const audioReady = createMockVoiceAudio({ audible: this.flags.audible });
    await this.wait(600);
    if (this.stopped) return;
    this.on.ringing();
    this.audio = await audioReady;
    await this.wait(1400);
    if (this.stopped) {
      this.audio?.dispose();
      return;
    }
    this.on.accepted(this.audio?.stream ?? null);
    await this.wait(800);
    void this.loop();
  }

  private async loop() {
    while (!this.stopped) {
      const text = this.pendingReplies.shift() ?? MOCK_SCRIPT[this.line++ % MOCK_SCRIPT.length];
      await this.say(text);
      await this.wait(1800);
    }
  }

  /** Cheer Bear "answers" a typed message in the demo (next line she says). */
  reply(index = 0): void {
    this.pendingReplies.push(REPLIES[index % REPLIES.length]);
  }

  private async say(text: string) {
    if (this.stopped) return;
    this.speaking = true;
    const id = `mock-${++this.seq}`;
    const words = text.split(/\s+/);
    const perWord = 300;
    this.audio?.speak((words.length * perWord + 200) / this.flags.speed);
    for (let i = 1; i <= words.length && !this.stopped; i += 1) {
      await this.wait(perWord);
      if (this.stopped) break;
      if (i < words.length) this.on.transcript(id, words.slice(0, i).join(' '), false);
    }
    if (!this.stopped) {
      await this.wait(250);
      if (!this.stopped) this.on.transcript(id, text, true);
    }
    this.audio?.silence();
    this.speaking = false;
  }

  get isSpeaking() {
    return this.speaking;
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.audio?.dispose();
    this.audio = null;
  }
}
