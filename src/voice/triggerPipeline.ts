// Trigger pipeline (browser). Port of the old server's transcript -> intent -> trigger queue logic:
//   - Cheer Bear's transcripts always classify; the user's only when config.allowUserTriggers.
//   - Partial transcripts fire (local matching only) when triggerPolicy.partialTriggerEnabled.
//   - Per-transcript dedupe: a keyword fires once per transcript (partials + final together). A transcript id that
//     has had its final is remembered (last 200), so a late or repeated partial/final for it never fires again.
//   - Finals use the configured engine (local / hybrid / openai, the AI part via POST /api/intent).
//   - Queue: per speaker+keyword cooldown, no duplicate queued items, one dispatch every dispatchIntervalMs.
//     (Fix: the old server dispatched a burst enqueued one by one all at once, because the queue emptied after each
//     item; here the interval is measured from the last dispatch, so bursts really are spaced out.)
//     dispatchMode 'first_only' drops queued duplicates of a keyword once it fires (old behaviour; enqueue already
//     refuses duplicates, so in practice first_only and queue_all behave the same, as they did before).
//   - englishOnlyTranscripts strips non-ASCII before matching.
// Pure logic: no DOM, no network (the AI call is injected), so it is tested in Node (scripts/check-voice-logic.ts).
import type { AppConfig } from '../shared/config';
import type { Speaker, TranscriptEvent, TriggerEvent } from '../shared/contracts';
import { canonicalKeyword, extractKeywordMatches, resolveIntents, sanitizeEnglishText } from '../shared/classifier';

export type TriggerSpeaker = TriggerEvent['speaker'];

interface QueueItem {
  keyword: string;
  speaker: TriggerSpeaker;
  via: TriggerEvent['via'];
  transcriptId?: string;
}

export interface TriggerPipelineOptions {
  getConfig(): AppConfig;
  /** AI intent fallback; must return configured keywords only. */
  classifyWithAI(text: string, keywords: string[]): Promise<string[]>;
  emit(trigger: TriggerEvent): void;
  now?(): number;
  /** Debug log hook. */
  log?(msg: string): void;
}

export class TriggerPipeline {
  private queue: QueueItem[] = [];
  private recent = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** transcript id -> keywords already fired for it (partials + final). */
  private perTranscript = new Map<string, Set<string>>();
  /** Transcript ids that already had their final (a late partial or a repeated final must not fire again). */
  private finished = new Set<string>();
  private disposed = false;
  private lastDispatchAt = -Infinity;
  private now: () => number;

  constructor(private opts: TriggerPipelineOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  private get config() {
    return this.opts.getConfig();
  }

  private clean(text: string): string {
    return this.config.englishOnlyTranscripts ? sanitizeEnglishText(text) : text.trim();
  }

  private speakerMayTrigger(speaker: Speaker): boolean {
    if (!this.config.localClassifier.keywords.length) return false;
    return speaker === 'cheer_bear' || this.config.allowUserTriggers;
  }

  /** Feed every transcript event (partials and finals) here. */
  async handleTranscript(evt: TranscriptEvent): Promise<void> {
    if (this.finished.has(evt.id)) return;
    if (this.disposed || !this.speakerMayTrigger(evt.speaker)) {
      if (evt.final) this.markFinished(evt.id);
      if (evt.final) this.perTranscript.delete(evt.id);
      return;
    }
    const text = this.clean(evt.text);
    const cfg = this.config;
    let fired = this.perTranscript.get(evt.id);
    if (!evt.final) {
      if (!cfg.triggerPolicy.partialTriggerEnabled || !text) return;
      const matches = extractKeywordMatches(text, cfg.localClassifier).filter((k) => !fired?.has(k.toLowerCase()));
      if (!matches.length) return;
      if (!fired) this.perTranscript.set(evt.id, (fired = new Set()));
      for (const k of matches) {
        fired.add(k.toLowerCase());
        this.enqueue({ keyword: k, speaker: evt.speaker, via: 'local', transcriptId: evt.id });
      }
      return;
    }
    // Final: forget the partial cache afterwards whatever happens.
    this.perTranscript.delete(evt.id);
    this.markFinished(evt.id);
    if (!text) return;
    const intents = await resolveIntents(text, cfg.localClassifier, cfg.intentMatchingEngine, (t, k) => this.opts.classifyWithAI(t, k));
    if (this.disposed) return;
    for (const r of intents) {
      if (fired?.has(r.keyword.toLowerCase())) continue;
      this.enqueue({ keyword: r.keyword, speaker: evt.speaker, via: r.via, transcriptId: evt.id });
    }
  }

  /**
   * Keywords that must not fire again for transcript `id` (the demo: the child's own words already fired them, so
   * Cheer Bear's answer saying the same word does not fire a second time).
   */
  claim(id: string, keywords: string[]): void {
    if (!keywords.length) return;
    let set = this.perTranscript.get(id);
    if (!set) this.perTranscript.set(id, (set = new Set()));
    for (const k of keywords) set.add(k.toLowerCase());
  }

  private markFinished(id: string) {
    this.finished.add(id);
    if (this.finished.size > 200) this.finished.delete(this.finished.values().next().value as string);
  }

  /** Classify typed text (when user triggers are allowed) and queue the matches. Returns the matched keywords. */
  async classifyTyped(text: string): Promise<string[]> {
    const cfg = this.config;
    if (!cfg.allowUserTriggers) return [];
    const clean = this.clean(text);
    if (!clean) return [];
    const intents = await resolveIntents(clean, cfg.localClassifier, cfg.intentMatchingEngine, (t, k) => this.opts.classifyWithAI(t, k));
    for (const r of intents) this.enqueue({ keyword: r.keyword, speaker: 'typed', via: r.via });
    return intents.map((r) => r.keyword);
  }

  /** Quick actions / command mode. Unknown names pass through (the experience plays a generic cheer). */
  fire(keyword: string, speaker: TriggerSpeaker = 'quick-action'): void {
    const k = String(keyword || '').trim().slice(0, 50);
    if (!k) return;
    const canonical = canonicalKeyword(k, this.config.localClassifier.keywords) ?? k;
    this.enqueue({ keyword: canonical, speaker, via: 'manual' });
  }

  private key(item: Pick<QueueItem, 'speaker' | 'keyword'>) {
    return `${item.speaker}:${item.keyword.toLowerCase()}`;
  }

  private enqueue(item: QueueItem): void {
    if (this.disposed) return;
    const key = this.key(item);
    const cooldown = this.config.triggerPolicy.triggerCooldownMs;
    const last = this.recent.get(key) ?? -Infinity;
    if (this.now() - last < cooldown) {
      this.opts.log?.(`skip ${item.keyword} (${item.speaker}): cooldown`);
      return;
    }
    if (this.queue.some((q) => this.key(q) === key)) {
      this.opts.log?.(`skip ${item.keyword} (${item.speaker}): already queued`);
      return;
    }
    this.queue.push(item);
    if (!this.timer) this.schedule();
  }

  /** Runs the queue now, or when dispatchIntervalMs has passed since the last trigger (bursts are spaced out). */
  private schedule(): void {
    const wait = this.lastDispatchAt + this.config.triggerPolicy.dispatchIntervalMs - this.now();
    if (wait > 0) this.timer = setTimeout(this.process, wait);
    else this.process();
  }

  private process = (): void => {
    this.timer = null;
    if (this.disposed) return;
    const policy = this.config.triggerPolicy;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      const key = this.key(item);
      const now = this.now();
      if (now - (this.recent.get(key) ?? -Infinity) < policy.triggerCooldownMs) continue;
      this.recent.set(key, now);
      this.lastDispatchAt = now;
      if (this.recent.size > 500) this.pruneRecent(now);
      this.opts.log?.(`fire ${item.keyword} (${item.speaker}, ${item.via})`);
      this.opts.emit({ keyword: item.keyword, speaker: item.speaker, via: item.via, transcriptId: item.transcriptId, at: now });
      if (policy.dispatchMode === 'first_only') this.queue = this.queue.filter((q) => this.key(q) !== key);
      if (this.queue.length) {
        this.timer = setTimeout(this.process, policy.dispatchIntervalMs);
        return;
      }
    }
  };

  private pruneRecent(now: number) {
    for (const [k, t] of this.recent) if (now - t > 60 * 60 * 1000) this.recent.delete(k);
  }

  /** Call when a call ends: pending partial caches are meaningless now. The queue still drains. */
  endOfCall(): void {
    this.perTranscript.clear();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.perTranscript.clear();
  }
}
