import type { AdminApi } from '@/shared/contracts';

export interface LoadedApi {
  api: AdminApi;
  source: 'real' | 'mock';
  /** Why the mock is in use (shown in the practice-mode banner). */
  reason?: string;
}

// `import.meta.glob` instead of `import('@/voice')`: it resolves to an empty map while src/voice does not exist yet,
// so the panel builds and runs before (and without) the voice module, and picks it up as soon as it lands.
// The contract entry is src/voice/index.ts; src/voice/adminApi.ts is used directly while index.ts is not written yet.
const voiceModules = import.meta.glob<{ adminApi?: AdminApi }>(['../voice/index.ts', '../voice/adminApi.ts']);

async function mock(reason: string): Promise<LoadedApi> {
  const { createMockAdminApi } = await import('./dev/mockAdminApi');
  return { api: createMockAdminApi(), source: 'mock', reason };
}

export async function loadAdminApi(): Promise<LoadedApi> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mock')) return mock('Opened with ?mock.');
  const load = voiceModules['../voice/index.ts'] ?? voiceModules['../voice/adminApi.ts'];
  // In a production build a silent fallback would let someone "save" into a browser-only copy at an event, so the
  // mock is only used there when asked for explicitly.
  const fallbackAllowed = import.meta.env.DEV;
  try {
    if (!load) throw new Error('The voice module (src/voice) is not in this build yet.');
    const mod = await load();
    if (!mod.adminApi) throw new Error('src/voice does not export adminApi yet.');
    return { api: mod.adminApi, source: 'real' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!fallbackAllowed) throw new Error(`The admin service could not be loaded. ${msg}`);
    console.warn('[admin] real adminApi unavailable, using the mock:', msg);
    return mock(msg);
  }
}

/** True when an error means the sign-in is no longer valid. */
export function isAuthError(err: unknown, api?: AdminApi): boolean {
  const e = err as { status?: number; code?: string; message?: string } | null;
  if (e?.status === 401) return true;
  if (e?.code && /unauth|expired|token/i.test(e.code)) return true;
  if (e?.message && /\b401\b|unauthori[sz]ed|expired|not (logged|signed) in|sign in again|invalid token/i.test(e.message)) return true;
  return api ? api.loggedIn === false : false;
}

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong. Please try again.';
}
