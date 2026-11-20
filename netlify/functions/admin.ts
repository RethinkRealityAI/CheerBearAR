// /api/admin/*: the admin API (one function, small router).
//   POST /api/admin/login               { username, password } -> { token, username, expiresAt, devDefaults }
//   GET  /api/admin/config              -> { config, updatedAt, updatedBy, storage }
//   PUT  /api/admin/config              DeepPartial<AppConfig> -> { config, ... }   (400 { errors } when invalid)
//   POST /api/admin/config/reset        -> { config, ... }
//   GET  /api/admin/history             -> { history: [{ id, at, by, summary }] }
//   POST /api/admin/history/restore     { id } -> { config, ... }
//   POST /api/admin/test-phrase         { text, draft? } -> { matches, engine, tokens, details }
//   GET  /api/admin/status              -> { twilio, openai, sms, storage, adminConfigured, ... }
import type { Config } from '@netlify/functions';
import { purgeCache } from '@netlify/functions';
import { adminSetup, checkCredentials, issueToken, requireAdmin } from '../lib/auth';
import { getConfig, getHistory, resetConfig, restoreConfig, storageKind, updateConfig } from '../lib/store';
import { services } from '../lib/env';
import { assertSameOrigin, cleanText, clientIp, error, handle, HttpError, json, rateLimit, readJson } from '../lib/http';
import { applyConfigPatch, ConfigValidationError } from '../../src/shared/config';
import { sanitizeEnglishText, testPhrase } from '../../src/shared/classifier';

type Route = (req: Request, ip: string) => Promise<Response>;

async function configResponse(current: Awaited<ReturnType<typeof getConfig>>) {
  return json({ config: current.config, updatedAt: current.updatedAt, updatedBy: current.updatedBy, storage: storageKind() });
}

/** Lets the public /api/config CDN cache pick up the change straight away (no-op locally). */
async function afterSave() {
  try {
    await purgeCache({ tags: ['config'] });
  } catch {
    /* not on Netlify, or no purge token: the 10 s CDN TTL covers it */
  }
}

const failures = new Map<string, { count: number; until: number }>();

const routes: Record<string, Route> = {
  'POST login': async (req, ip) => {
    rateLimit(`login:${ip}`, 10, 60_000);
    const lock = failures.get(ip);
    if (lock && lock.until > Date.now()) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in a few minutes.');
    const setup = adminSetup();
    if (!setup.ok) {
      console.error('[admin] Refusing login: admin is not configured:', setup.problems.join('; '));
      return error(503, 'admin_not_configured', 'Admin is not set up on this site. Set ADMIN_USERNAME, ADMIN_PASSWORD and JWT_SECRET (see README).');
    }
    const body = await readJson<{ username?: unknown; password?: unknown }>(req, 2048);
    const username = typeof body.username === 'string' ? body.username.slice(0, 200) : '';
    const password = typeof body.password === 'string' ? body.password.slice(0, 500) : '';
    if (!username || !password) throw new HttpError(400, 'missing_credentials', 'Username and password are required.');
    if (!(await checkCredentials(setup, username, password))) {
      const f = failures.get(ip) ?? { count: 0, until: 0 };
      f.count += 1;
      if (f.count >= 5) {
        f.until = Date.now() + 5 * 60_000;
        f.count = 0;
      }
      failures.set(ip, f);
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
      return error(401, 'invalid_credentials', 'Wrong username or password.');
    }
    failures.delete(ip);
    const { token, expiresAt } = issueToken(setup, setup.username);
    return json({ token, username: setup.username, expiresAt, devDefaults: setup.devDefaults });
  },

  'GET config': async (req) => {
    requireAdmin(req);
    return configResponse(await getConfig({ fresh: true }));
  },

  'PUT config': async (req) => {
    const by = requireAdmin(req);
    const patch = await readJson(req, 250_000);
    try {
      const saved = await updateConfig(patch, by);
      await afterSave();
      return configResponse(saved);
    } catch (err) {
      if (err instanceof ConfigValidationError) return error(400, 'invalid_config', err.message, { errors: err.errors });
      throw err;
    }
  },

  'POST config/reset': async (req) => {
    const by = requireAdmin(req);
    const saved = await resetConfig(by);
    await afterSave();
    return configResponse(saved);
  },

  'GET history': async (req) => {
    requireAdmin(req);
    const history = (await getHistory()).map(({ id, at, by, summary }) => ({ id, at, by, summary }));
    return json({ history, storage: storageKind() });
  },

  'POST history/restore': async (req) => {
    const by = requireAdmin(req);
    const body = await readJson<{ id?: unknown }>(req, 1024);
    const id = typeof body.id === 'string' ? body.id.slice(0, 100) : '';
    if (!id) throw new HttpError(400, 'missing_id', 'id is required.');
    const saved = await restoreConfig(id, by);
    if (!saved) throw new HttpError(404, 'not_found', 'That version is no longer in the history.');
    await afterSave();
    return configResponse(saved);
  },

  'POST test-phrase': async (req) => {
    requireAdmin(req);
    const body = await readJson<{ text?: unknown; draft?: unknown }>(req, 250_000);
    let text = cleanText(body.text, 5000);
    if (!text) throw new HttpError(400, 'bad_text', 'text is required (max 5000 characters).');
    const { config: saved } = await getConfig();
    let config = saved;
    if (body.draft !== undefined && body.draft !== null) {
      try {
        config = applyConfigPatch(saved, body.draft);
      } catch (err) {
        if (err instanceof ConfigValidationError) return error(400, 'invalid_config', err.message, { errors: err.errors });
        throw err;
      }
    }
    if (config.englishOnlyTranscripts) text = sanitizeEnglishText(text);
    const result = testPhrase(text, config.localClassifier);
    return json({ ...result, engine: config.intentMatchingEngine, text });
  },

  'GET status': async (req) => {
    requireAdmin(req);
    const s = services();
    const setup = adminSetup();
    return json({
      twilio: s.calls,
      openai: s.transcription,
      sms: s.sms,
      storage: storageKind(),
      adminConfigured: setup.ok && !setup.devDefaults,
      adminProblems: setup.problems,
      webhookSignatureCheck: !!process.env.TWILIO_AUTH_TOKEN,
      transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
      serverTime: new Date().toISOString(),
    });
  },
};

export default handle(async (req, context) => {
  assertSameOrigin(req);
  const ip = clientIp(req, context);
  rateLimit(`admin:${ip}`, 120, 60_000);
  const sub = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
  const route = routes[`${req.method} ${sub}`];
  if (route) return route(req, ip);
  if (Object.keys(routes).some((k) => k.endsWith(` ${sub}`))) return error(405, 'method_not_allowed', 'Method not allowed.');
  return error(404, 'not_found', 'Unknown admin endpoint.');
});

export const config: Config = { path: ['/api/admin', '/api/admin/*'] };
