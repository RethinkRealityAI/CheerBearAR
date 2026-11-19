// Same-origin fetch helpers for /api/*. Errors carry the server's stable `error` code.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Base URL for the API. Same origin by default; `VITE_API_BASE` can point a static preview at another deploy. */
export function apiBase(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_API_BASE || '').replace(/\/+$/, '');
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ApiError(0, ctrl.signal.aborted ? 'timeout' : 'network', ctrl.signal.aborted ? 'The server took too long to answer.' : 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  let data: unknown = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const code = typeof d.error === 'string' ? d.error : res.status === 404 ? 'not_found' : 'http_error';
    const message = typeof d.message === 'string' ? d.message : `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, message, d);
  }
  if (data === null) throw new ApiError(res.status, 'bad_response', 'The server sent an unexpected response.');
  return data as T;
}
