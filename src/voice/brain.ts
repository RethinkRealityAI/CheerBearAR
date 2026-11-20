// Who answers for Happi in the demo: the AI chat function (POST /api/chat) when the server has an OpenAI key and
// the admin allows it (demoVoice.useAiBrain), else the local brain (cheerBrain.ts). Any AI failure falls back to the
// local brain silently; after two failures in a row the AI is left alone for a minute. The local brain always keeps
// the session memory (the child's first name), also while the AI answers.
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
}

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

  async reply(userText: string): Promise<BrainAnswer> {
    const text = userText.trim().slice(0, 500);
    const cfg = this.getConfig();
    if (text && cfg.demoVoice.useAiBrain && this.aiAvailable() && Date.now() >= this.aiPausedUntil) {
      try {
        const res = await api<{ reply?: unknown }>('/api/chat', {
          body: { text, history: this.history.slice(-6), name: this.local.name ?? undefined },
          timeoutMs: 8000,
        });
        const reply = typeof res.reply === 'string' ? res.reply.trim().slice(0, 300) : '';
        if (reply) {
          this.aiFailures = 0;
          this.local.observe(text);
          this.remember('user', text);
          this.remember('cheer_bear', reply);
          return { text: reply, via: 'ai' };
        }
      } catch (err) {
        this.aiFailures += 1;
        if (this.aiFailures >= 2) this.aiPausedUntil = Date.now() + 60_000;
        console.info('[voice] AI brain unavailable, using the built-in one:', err instanceof Error ? err.message : err);
      }
    }
    const r = this.local.reply(text, cfg.localClassifier);
    this.remember('user', text);
    this.remember('cheer_bear', r.text);
    return { text: r.text, via: 'local' };
  }
}
