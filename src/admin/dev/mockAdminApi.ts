// In-memory AdminApi for developing the panel before (or without) the real functions. Seeded with DEFAULT_CONFIG and
// kept in this browser's localStorage so a reload shows saved values. Never used for real events: the panel shows a
// "Practice mode" banner whenever this is active.
//
// Sign in with any username and the password `demo`.
// URL switches for testing:  ?mock&expire=20  (session expires after 20 s)   ?mock&fail=save  (every save fails)
import type { AdminApi, DeepPartial } from '@/shared/contracts';
import { applyConfigPatch, coerceConfig, DEFAULT_CONFIG, type AppConfig } from '@/shared/config';
import { testPhrase } from '@/shared/classifier';
import { clone } from '../lib/configDiff';

const CONFIG_KEY = 'cb-admin-mock:config';
const HISTORY_KEY = 'cb-admin-mock:history';
const SESSION_KEY = 'cb-admin-mock:session';
export const MOCK_PASSWORD = 'demo';

interface HistoryEntry { id: string; at: string; by: string; summary: string; config: AppConfig }

class AuthError extends Error {
  status = 401;
  constructor() { super('Your session has expired. Please sign in again.'); }
}

function read<T>(key: string, fallback: T, store: Storage | null = safeStorage('local')): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, v: unknown, store: Storage | null = safeStorage('local')) {
  try { store?.setItem(key, JSON.stringify(v)); } catch { /* private mode: memory only */ }
}
function safeStorage(kind: 'local' | 'session'): Storage | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarise(patch: unknown): string {
  if (!patch || typeof patch !== 'object') return 'Saved';
  const labels: Record<string, string> = {
    modeDefault: 'default mode', transcriptVisibility: 'transcripts', allowUserTriggers: 'typed triggers',
    allowUserAudioToOpenAI: 'privacy', englishOnlyTranscripts: 'privacy', intentMatchingEngine: 'intent engine',
    localClassifier: 'keywords', triggerPolicy: 'trigger policy', smsPolicy: 'SMS',
    gameModes: 'game modes', activeGameMode: 'starting game', ui: 'look & text', lipSync: 'lip sync',
  };
  const parts = [...new Set(Object.keys(patch).map((k) => labels[k] ?? k))];
  return `Changed ${parts.join(', ')}`;
}

export function createMockAdminApi(): AdminApi {
  const params = new URLSearchParams(window.location.search);
  const expireSec = Number(params.get('expire')) || 60 * 60;
  const failSave = params.get('fail') === 'save';

  // Same merge/validation rules as the real server (src/shared/config.ts).
  let config: AppConfig = coerceConfig(read<unknown>(CONFIG_KEY, {}));
  let history: HistoryEntry[] = read<HistoryEntry[]>(HISTORY_KEY, []);
  let session = read<{ user: string; exp: number } | null>(SESSION_KEY, null, safeStorage('session'));

  const persist = () => { write(CONFIG_KEY, config); write(HISTORY_KEY, history.slice(0, 30)); };
  const guard = async () => {
    await wait(120 + Math.random() * 180);
    if (!session || Date.now() > session.exp) { session = null; write(SESSION_KEY, null, safeStorage('session')); throw new AuthError(); }
  };
  const record = (summary: string) => {
    history.unshift({ id: `v${Date.now().toString(36)}`, at: new Date().toISOString(), by: session?.user ?? 'admin', summary, config: clone(config) });
    persist();
  };

  return {
    get loggedIn() { return !!session && Date.now() < session.exp; },
    async login(username, password) {
      await wait(250);
      if (!username.trim() || password !== MOCK_PASSWORD) throw Object.assign(new Error('That username or password is not right.'), { status: 401 });
      session = { user: username.trim(), exp: Date.now() + expireSec * 1000 };
      write(SESSION_KEY, session, safeStorage('session'));
    },
    logout() { session = null; write(SESSION_KEY, null, safeStorage('session')); },
    async getConfig() { await guard(); return clone(config); },
    async updateConfig(patch: DeepPartial<AppConfig>) {
      await guard();
      await wait(250);
      if (failSave) throw new Error('The server could not save right now (simulated failure).');
      try {
        config = applyConfigPatch(config, patch);
      } catch (err) {
        throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), { status: 400 });
      }
      record(summarise(patch));
      return clone(config);
    },
    async resetConfig() {
      await guard();
      config = clone(DEFAULT_CONFIG);
      record('Reset to defaults');
      return clone(config);
    },
    async history() {
      await guard();
      return history.map(({ id, at, by, summary }) => ({ id, at, by, summary }));
    },
    async restore(id) {
      await guard();
      const h = history.find((x) => x.id === id);
      if (!h) throw new Error('That version is no longer in the history.');
      config = clone(h.config);
      record(`Restored the version from ${new Date(h.at).toLocaleString()}`);
      return clone(config);
    },
    async testPhrase(text, draft) {
      await guard();
      const merged = draft ? applyConfigPatch(config, draft) : config;
      return { matches: testPhrase(text, merged.localClassifier).matches, engine: `${merged.intentMatchingEngine} (practice: keywords only)` };
    },
    async status() {
      await guard();
      return { twilio: false, openai: true, storage: 'memory' as const, adminConfigured: true };
    },
  };
}
