// Who answers for Cheer Bear in the demo: the local brain (cheerBrain.ts) first, always; the AI chat function
// (POST /api/chat) only for what the local brain has no good answer to (its 'unknown' and generic 'question'
// replies), when the server has an OpenAI key and the admin allows it (demoVoice.useAiBrain).
//
// voice-5, why the split: the local brain answers at once (no 1-3 s round trip), action requests ("can you dance?")
// always say the exact magic word, and safety / private / rude answers never depend on a network call. An AI answer
// never fires a moment (`blockAll`): gpt-4o-mini slips magic words into small talk ("I love to dance!"), which used to
// start a dance nobody asked for. Any AI failure falls back to the local answer silently; after two failures in a
// row the AI is left alone for a minute. The local brain keeps the session memory (the child's first name).
import type { AppConfig } from '../shared/config';
import { api } from './api';
import { CheerBrain } from './cheerBrain';
import { configClient } from './configClient';

export interface ChatTurn {
  role: 'user' | 'cheer_bear';
  text: string;
}

export interface BrainAnswer {
  text: string;
  via: 'local' | 'ai';
  /** The local brain's intent ('unknown' when it had no idea; the app then also shows "Try saying" chips). */
  intent: string;
  /** True: her line must fire no moment at all (AI answers). */
  blockAll: boolean;
}

/** Local intents that are worth asking the AI about instead (the local answer is a generic redirect). */
const AI_INTENTS = new Set(['unknown', 'question']);

const MAX_HISTORY = 8;

export class DemoBrain {
  readonly local: CheerBrain;
  private history: ChatTurn[] = [];
  private aiFailures = 0;
  private aiPausedUntil = 0;

  constructor(
    private getConfig: () => AppConfig,
    private aiAvailable: () => boolean = () => !!configClient.services.chatAi,
  ) {
    this.local = new CheerBrain();
  }

  private remember(role: ChatTurn['role'], text: string) {
    this.history.push({ role, text: text.slice(0, 300) });
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
  }

  /** The demo call's one greeting. */
  greeting(): string {
    const text = this.local.greeting(this.getConfig().localClassifier);
    this.remember('cheer_bear', text);
    return text;
  }

  /** True when an AI answer would be asked for right now (key on the server, admin allows it, not paused). */
  get aiOn(): boolean {
    return this.getConfig().demoVoice.useAiBrain && this.aiAvailable() && Date.now() >= this.aiPausedUntil;
  }

  async reply(userText: string): Promise<BrainAnswer> {
    const text = userText.trim().slice(0, 500);
    const cfg = this.getConfig();
    const history = this.history.slice(-6);
    const r = this.local.reply(text, cfg.localClassifier); // also learns the name, keeps the sleep state
    if (text && AI_INTENTS.has(r.intent) && this.aiOn) {
      try {
        const res = await api<{ reply?: unknown }>('/api/chat', {
          body: { text, history, name: this.local.name ?? undefined },
          timeoutMs: 6000, // a child will not wait longer: the local answer is ready
        });
        const reply = typeof res.reply === 'string' ? res.reply.trim().slice(0, 300) : '';
        if (reply) {
          this.aiFailures = 0;
          this.remember('user', text);
          this.remember('cheer_bear', reply);
          return { text: reply, via: 'ai', intent: r.intent, blockAll: true };
        }
      } catch (err) {
        this.aiFailures += 1;
        if (this.aiFailures >= 2) this.aiPausedUntil = Date.now() + 60_000;
        console.info('[voice] AI brain unavailable, using the built-in one:', err instanceof Error ? err.message : err);
      }
    }
    this.remember('user', text);
    this.remember('cheer_bear', r.text);
    return { text: r.text, via: 'local', intent: r.intent, blockAll: false };
  }
}
