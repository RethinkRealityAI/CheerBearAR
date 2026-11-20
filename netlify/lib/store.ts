// Config store: the current AppConfig plus a capped history, on Netlify Blobs.
//   - Deployed / `netlify dev`: Netlify Blobs (site-wide store "cheerbear-config", strong consistency).
//   - scripts/dev-api.ts: a JSON file under .tmp/ (survives restarts, easy to inspect or delete).
//   - Anything else (Blobs unavailable): in memory, per function instance. Admin status reports which one is live.
// Owner: server-voice.

import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type AppConfig,
  applyConfigPatch,
  coerceConfig,
  defaultConfig,
  diffConfigPaths,
} from '../../src/shared/config';
import { isLocalDev } from './http';

export type StorageKind = 'blobs' | 'file' | 'memory';

export interface HistoryEntry {
  id: string;
  at: string;
  by: string;
  summary: string;
  config: AppConfig;
}

interface Current {
  config: AppConfig;
  updatedAt: string | null;
  updatedBy: string | null;
}

const STORE_NAME = 'cheerbear-config';
const CURRENT_KEY = 'current';
const HISTORY_KEY = 'history';
export const HISTORY_LIMIT = 30;

interface Backend {
  kind: StorageKind;
  read<T>(key: string): Promise<{ data: T | null; etag?: string }>;
  /** Writes unless the stored etag changed since `etag` (optimistic concurrency); returns false on conflict. */
  write(key: string, data: unknown, etag?: string | null): Promise<boolean>;
}

// ---------------------------------------------------------------- backends

function blobsBackend(): Backend | null {
  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    return {
      kind: 'blobs',
      async read<T>(key: string) {
        const r = await store.getWithMetadata(key, { type: 'json' });
        return { data: (r?.data ?? null) as T | null, etag: r?.etag };
      },
      async write(key, data, etag) {
        if (etag === undefined) {
          await store.setJSON(key, data);
          return true;
        }
        const res = etag === null ? await store.setJSON(key, data, { onlyIfNew: true }) : await store.setJSON(key, data, { onlyIfMatch: etag });
        return res.modified;
      },
    };
  } catch {
    return null; // MissingBlobsEnvironmentError: not on Netlify
  }
}

function fileBackend(dir: string): Backend {
  const file = (key: string) => path.join(dir, `${key}.json`);
  let version = 0;
  return {
    kind: 'file',
    async read<T>(key: string) {
      try {
        const text = await fs.readFile(file(key), 'utf8');
        return { data: JSON.parse(text) as T, etag: String(version) };
      } catch {
        return { data: null, etag: String(version) };
      }
    },
    async write(key, data) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file(key)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, file(key));
      version += 1;
      return true;
    },
  };
}

const memory = new Map<string, unknown>();
const memoryBackend: Backend = {
  kind: 'memory',
  async read<T>(key: string) {
    return { data: (memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : null) as T | null };
  },
  async write(key, data) {
    memory.set(key, JSON.parse(JSON.stringify(data)));
    return true;
  },
};

let backend: Backend | null = null;

function getBackend(): Backend {
  if (backend) return backend;
  const forced = (process.env.CHEERBEAR_STORE || '').trim();
  if (forced === 'memory') return (backend = memoryBackend);
  if (forced === 'file') return (backend = fileBackend(fileDir()));
  const blobs = blobsBackend();
  if (blobs) return (backend = blobs);
  if (forced === 'blobs') console.warn('[store] CHEERBEAR_STORE=blobs but Netlify Blobs is not available; using memory.');
  else if (isLocalDev()) return (backend = fileBackend(fileDir()));
  console.warn('[store] Netlify Blobs unavailable: config changes are kept in memory only (lost on cold start).');
  return (backend = memoryBackend);
}

function fileDir(): string {
  return path.resolve(process.env.CHEERBEAR_STORE_DIR || path.join(process.cwd(), '.tmp', 'config-store'));
}

/** For tests: forget the chosen backend and cached values. */
export function resetStoreForTests(): void {
  backend = null;
  memory.clear();
  cache = null;
}

export function storageKind(): StorageKind {
  return getBackend().kind;
}

// ---------------------------------------------------------------- reads (with a short per-instance cache)

let cache: { value: Current; etag?: string; at: number } | null = null;
const CACHE_MS = 5_000;

async function readCurrent(fresh = false): Promise<{ value: Current; etag?: string | null }> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return { value: cache.value, etag: cache.etag };
  const b = getBackend();
  let r: { data: Partial<Current> | null; etag?: string };
  try {
    r = await b.read<Partial<Current>>(CURRENT_KEY);
  } catch (err) {
    console.error('[store] read failed, serving defaults:', err instanceof Error ? err.message : err);
    return { value: { config: defaultConfig(), updatedAt: null, updatedBy: null } };
  }
  const value: Current = r.data
    ? { config: coerceConfig(r.data.config), updatedAt: r.data.updatedAt ?? null, updatedBy: r.data.updatedBy ?? null }
    : { config: defaultConfig(), updatedAt: null, updatedBy: null };
  cache = { value, etag: r.etag, at: Date.now() };
  return { value, etag: r.data ? r.etag : null };
}

export async function getConfig(opts: { fresh?: boolean } = {}): Promise<Current> {
  return (await readCurrent(opts.fresh)).value;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const r = await getBackend().read<HistoryEntry[]>(HISTORY_KEY);
  return Array.isArray(r.data) ? r.data : [];
}

// ---------------------------------------------------------------- writes

async function save(next: AppConfig, by: string, summaryOverride?: string): Promise<Current> {
  const b = getBackend();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { value: prev, etag } = await readCurrent(true);
    const changed = diffConfigPaths(prev.config, next);
    const summary = summaryOverride || (changed.length ? `Changed ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` +${changed.length - 6} more` : ''}` : 'Saved (no changes)');
    const current: Current = { config: next, updatedAt: new Date().toISOString(), updatedBy: by };
    const ok = await b.write(CURRENT_KEY, current, b.kind === 'blobs' ? (etag ?? null) : undefined);
    if (!ok) continue; // someone else saved in between: re-read and retry
    cache = { value: current, at: Date.now() };
    // History stores the NEW config, so "restore" brings back exactly what was saved at that time.
    const history = await getHistory();
    const entry: HistoryEntry = { id: randomUUID(), at: current.updatedAt!, by, summary, config: next };
    await b.write(HISTORY_KEY, [entry, ...history].slice(0, HISTORY_LIMIT));
    return current;
  }
  throw new Error('Config was changed by someone else at the same time. Reload and try again.');
}

/** Merge + validate + save. Throws ConfigValidationError (400) on bad input. */
export async function updateConfig(patch: unknown, by: string): Promise<Current> {
  const { value } = await readCurrent(true);
  const next = applyConfigPatch(value.config, patch);
  return save(next, by);
}

export async function resetConfig(by: string): Promise<Current> {
  return save(defaultConfig(), by, 'Reset to defaults');
}

export async function restoreConfig(id: string, by: string): Promise<Current | null> {
  const entry = (await getHistory()).find((h) => h.id === id);
  if (!entry) return null;
  return save(coerceConfig(entry.config), by, `Restored version from ${entry.at}`);
}
