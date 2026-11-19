// Loads the public config from GET /api/config, keeps the last copy (memory + localStorage for an instant start),
// re-checks every minute and when the tab comes back, and notifies subscribers only when something changed.
import type { ConfigClient } from '../shared/contracts';
import { type AppConfig, coerceConfig, defaultConfig, type PublicConfigResponse } from '../shared/config';
import { api } from './api';

const STORAGE_KEY = 'cb.config.v1';
const RECHECK_MS = 60_000;
const FOCUS_MIN_GAP_MS = 10_000;

export type Services = PublicConfigResponse['services'];

export interface ConfigClientExt extends ConfigClient {
  /** Which server-side services are configured (false until the first load). */
  readonly services: Services;
  readonly loaded: boolean;
  /** Re-fetch now (ignores the focus throttle). */
  refresh(): Promise<AppConfig>;
}

class ConfigClientImpl implements ConfigClientExt {
  private _current: AppConfig;
  private _services: Services = { calls: false, transcription: false, sms: false, intentAi: false, chatAi: false };
  private _loaded = false;
  private signature: string;
  private subs = new Set<(c: AppConfig) => void>();
  private inflight: Promise<AppConfig> | null = null;
  private lastFetch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._current = this.readCache() ?? defaultConfig();
    this.signature = JSON.stringify(this._current);
  }

  get current(): AppConfig {
    return this._current;
  }
  get services(): Services {
    return this._services;
  }
  get loaded(): boolean {
    return this._loaded;
  }

  load(): Promise<AppConfig> {
    this.startWatching();
    return this.refresh();
  }

  refresh(): Promise<AppConfig> {
    if (this.inflight) return this.inflight;
    this.lastFetch = Date.now();
    this.inflight = api<PublicConfigResponse>('/api/config', { timeoutMs: 10_000 })
      .then((res) => {
        this._services = { ...this._services, ...(res.services || {}) };
        this._loaded = true;
        this.apply(coerceConfig(res.config));
        return this._current;
      })
      .catch((err) => {
        console.warn('[config] could not load /api/config, keeping the last known config:', err?.message || err);
        return this._current;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  subscribe(cb: (config: AppConfig) => void): () => void {
    this.subs.add(cb);
    try {
      cb(this._current);
    } catch (err) {
      console.error('[config] subscriber threw:', err);
    }
    this.startWatching();
    if (!this._loaded && !this.inflight) void this.refresh();
    return () => this.subs.delete(cb);
  }

  private apply(next: AppConfig) {
    const sig = JSON.stringify(next);
    if (sig === this.signature) return;
    this.signature = sig;
    this._current = next;
    this.writeCache(next);
    for (const cb of [...this.subs]) {
      try {
        cb(next);
      } catch (err) {
        console.error('[config] subscriber threw:', err);
      }
    }
  }

  private startWatching() {
    if (this.timer || typeof window === 'undefined') return;
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, RECHECK_MS);
    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastFetch > FOCUS_MIN_GAP_MS) void this.refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  }

  private readCache(): AppConfig | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      return raw ? coerceConfig(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private writeCache(c: AppConfig) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } catch {
      /* private mode / quota: fine */
    }
  }
}

export const configClient: ConfigClientExt = new ConfigClientImpl();
