// Typed client for /api/admin/*. The token lives in sessionStorage (gone when the tab closes).
import type { AdminApi, DeepPartial } from '../shared/contracts';
import type { AppConfig } from '../shared/config';
import { api, ApiError } from './api';
import { configClient } from './configClient';

const TOKEN_KEY = 'cb.admin.token';

interface ConfigResponse {
  config: AppConfig;
  updatedAt: string | null;
  updatedBy: string | null;
  storage: 'blobs' | 'file' | 'memory';
}

export interface AdminStatus {
  twilio: boolean;
  openai: boolean;
  sms: boolean;
  storage: 'blobs' | 'memory' | 'file';
  adminConfigured: boolean;
  adminProblems?: string[];
  webhookSignatureCheck?: boolean;
  transcribeModel?: string;
  serverTime?: string;
}

export interface TestPhraseResult {
  matches: string[];
  engine: string;
  tokens?: string[];
  details?: Array<{ token: string; matchedKeyword: string | null }>;
  text?: string;
}

/** AdminApi plus a few extras the admin panel may use (not in the contract). */
export interface AdminApiExt extends AdminApi {
  readonly username: string | null;
  /** True when the local dev server let you in with admin/admin (never on a deployed site). */
  readonly devDefaults: boolean;
  /** Last config response metadata (updatedAt/updatedBy/storage). */
  readonly lastSaved: Omit<ConfigResponse, 'config'> | null;
  /** Called when the session expires (401), so the panel can show the login form. */
  onLoggedOut(cb: () => void): () => void;
  status(): Promise<AdminStatus>;
  testPhrase(text: string, draft?: DeepPartial<AppConfig>): Promise<TestPhraseResult>;
}

function readStored(): { token: string; username: string; expiresAt: number; devDefaults: boolean } | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.token !== 'string' || typeof v?.expiresAt !== 'number') return null;
    return v;
  } catch {
    return null;
  }
}

class AdminApiImpl implements AdminApiExt {
  private session = readStored();
  private logoutListeners = new Set<() => void>();
  lastSaved: Omit<ConfigResponse, 'config'> | null = null;

  get loggedIn(): boolean {
    return !!this.session && this.session.expiresAt > Date.now() + 5_000;
  }
  get username(): string | null {
    return this.loggedIn ? this.session!.username : null;
  }
  get devDefaults(): boolean {
    return !!this.session?.devDefaults;
  }

  onLoggedOut(cb: () => void): () => void {
    this.logoutListeners.add(cb);
    return () => this.logoutListeners.delete(cb);
  }

  async login(username: string, password: string): Promise<void> {
    const res = await api<{ token: string; username: string; expiresAt: string; devDefaults: boolean }>('/api/admin/login', {
      body: { username, password },
    });
    this.session = { token: res.token, username: res.username, expiresAt: Date.parse(res.expiresAt), devDefaults: !!res.devDefaults };
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.session));
    } catch {
      /* ignore */
    }
  }

  logout(): void {
    this.session = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    for (const cb of [...this.logoutListeners]) cb();
  }

  private async authed<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.loggedIn) {
      this.logout();
      throw new ApiError(401, 'unauthorized', 'Please log in.');
    }
    try {
      return await api<T>(path, { ...opts, token: this.session!.token });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.logout();
      throw err;
    }
  }

  private took(res: ConfigResponse): AppConfig {
    const { config, ...meta } = res;
    this.lastSaved = meta;
    return config;
  }

  async getConfig(): Promise<AppConfig> {
    return this.took(await this.authed<ConfigResponse>('/api/admin/config'));
  }

  async updateConfig(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
    const config = this.took(await this.authed<ConfigResponse>('/api/admin/config', { method: 'PUT', body: patch }));
    void configClient.refresh(); // the app in this tab picks it up straight away
    return config;
  }

  async resetConfig(): Promise<AppConfig> {
    const config = this.took(await this.authed<ConfigResponse>('/api/admin/config/reset', { method: 'POST' }));
    void configClient.refresh();
    return config;
  }

  async history(): Promise<Array<{ id: string; at: string; by: string; summary: string }>> {
    return (await this.authed<{ history: Array<{ id: string; at: string; by: string; summary: string }> }>('/api/admin/history')).history;
  }

  async restore(id: string): Promise<AppConfig> {
    const config = this.took(await this.authed<ConfigResponse>('/api/admin/history/restore', { method: 'POST', body: { id } }));
    void configClient.refresh();
    return config;
  }

  testPhrase(text: string, draft?: DeepPartial<AppConfig>): Promise<TestPhraseResult> {
    return this.authed<TestPhraseResult>('/api/admin/test-phrase', { method: 'POST', body: draft === undefined ? { text } : { text, draft } });
  }

  status(): Promise<AdminStatus> {
    return this.authed<AdminStatus>('/api/admin/status');
  }
}

export const adminApi: AdminApiExt = new AdminApiImpl();
