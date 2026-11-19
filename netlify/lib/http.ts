// Small helpers shared by the Netlify functions: JSON responses, bounded body parsing, same-origin checks and a
// best-effort in-memory rate limiter. No Express. Owner: server-voice.
//
// Lives in netlify/lib (not netlify/functions) so Netlify never mistakes it for a function.

import type { Context } from '@netlify/functions';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

/** `{ error: code, message }`; `code` is stable for the client, `message` is for humans. */
export function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ error: code, message, ...extra }, status, headers);
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Wraps a handler: HttpError -> its response, anything else -> 500 without internals. */
export function handle(fn: (req: Request, context: Context) => Promise<Response>) {
  return async (req: Request, context: Context): Promise<Response> => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return error(err.status, err.code, err.message, err.extra);
      console.error('[api] unhandled error:', err instanceof Error ? err.message : err);
      return error(500, 'internal', 'Something went wrong. Please try again.');
    }
  };
}

export function requireMethod(req: Request, ...methods: string[]): void {
  if (!methods.includes(req.method)) throw new HttpError(405, 'method_not_allowed', `Use ${methods.join(' or ')}.`);
}

/** Reads the body as text, refusing more than `maxBytes`. */
export async function readText(req: Request, maxBytes: number): Promise<string> {
  const len = Number(req.headers.get('content-length') || '0');
  if (len > maxBytes) throw new HttpError(413, 'too_large', `Request body too large (max ${maxBytes} bytes).`);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'too_large', `Request body too large (max ${maxBytes} bytes).`);
  return text;
}

/** Parses a JSON object body (max `maxBytes`). Rejects non-objects. */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 16_384): Promise<T> {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON (Content-Type: application/json).');
  const text = await readText(req, maxBytes);
  let data: unknown;
  try {
    data = JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'bad_body', 'The request body must be a JSON object.');
  return data as T;
}

/** Trims, strips control characters and caps the length. Returns '' for non-strings. */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Browser calls to our API come from our own origin. A cross-site page cannot read our responses anyway (no CORS
 * headers are ever sent), but refusing a foreign Origin also stops it from triggering side effects (SMS, OpenAI spend).
 * Requests without an Origin header (curl, Twilio webhooks, same-origin GETs) pass; rate limits cover those.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.');
  if (!origin) return;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(req.url).origin);
  } catch {
    /* ignore */
  }
  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) allowed.add(`${fwdProto}://${fwdHost}`);
  const host = req.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  for (const extra of (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) allowed.add(extra);
  if (!allowed.has(origin)) throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.');
}

/** Client IP: Netlify's context.ip, else the first X-Forwarded-For hop (local runner), else 'unknown'. */
export function clientIp(req: Request, context?: Partial<Context>): string {
  if (context?.ip) return context.ip;
  const nf = req.headers.get('x-nf-client-connection-ip');
  if (nf) return nf;
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// ------------------------------------------------------------------ rate limiting
//
// Functions are stateless and can run on many instances, so this in-memory limiter is BEST EFFORT: it stops a burst
// hitting one warm instance. The endpoints that cost money (realtime-session, sms) ALSO declare Netlify's platform
// rate limit in their `config.rateLimit` (enforced at the edge, across instances; the free plan allows 2 such rules).

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a moment.', { retryAfter });
  }
}

/** True when running on our own machine (scripts/dev-api.ts or `netlify dev`), never on a deployed site. */
export function isLocalDev(): boolean {
  return process.env.CHEERBEAR_LOCAL_DEV === '1' || process.env.NETLIFY_DEV === 'true';
}
