// Invokes every Netlify function through the local runner (scripts/dev-api.ts) with no real credentials:
// fake env values, a fake OpenAI server on localhost, a throwaway config store. Run: npx tsx scripts/check-functions.ts
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';

// ---- environment: nothing configured, local dev, throwaway file store
const storeDir = mkdtempSync(path.join(os.tmpdir(), 'cb-store-'));
const KEEP = new Set(['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS', 'LANG']);
for (const k of Object.keys(process.env)) if (!KEEP.has(k) && /^(TWILIO|OPENAI|ADMIN|JWT|CHEER|ALLOWED|DEFAULT_CALL|NETLIFY|CHEERBEAR)/.test(k)) delete process.env[k];
process.env.CHEERBEAR_STORE = 'file';
process.env.CHEERBEAR_STORE_DIR = storeDir;
process.env.DEV_API_QUIET = '1';

const { createDevApi } = await import('./dev-api');
const api = await createDevApi();
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

// ---- a fake OpenAI API that records what we send
const upstream: Array<{ path: string; body: any; auth: string }> = [];
let clientSecretStatus = 200;
const fakeOpenAI = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  upstream.push({ path: req.url || '', body, auth: String(req.headers.authorization || '') });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/realtime/client_secrets') {
    if (clientSecretStatus !== 200) {
      res.statusCode = clientSecretStatus;
      return res.end(JSON.stringify({ error: { message: 'bad field' } }));
    }
    return res.end(JSON.stringify({ value: 'ek_test_123', expires_at: 1900000000, session: body.session }));
  }
  if (req.url === '/v1/chat/completions') {
    return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intents: ['rainbows', 'Unicorn', 'magic'] }) } }] }));
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise<void>((r) => fakeOpenAI.listen(0, '127.0.0.1', r));
const fakeOpenAIBase = `http://127.0.0.1:${(fakeOpenAI.address() as AddressInfo).port}/v1`;

// ---- helpers
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join('\n       ') : err}`);
    process.exitCode = 1;
  }
}
async function call(method: string, p: string, opts: { json?: unknown; form?: Record<string, string>; headers?: Record<string, string>; token?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(base + p, { method, headers, body });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* xml / text */
  }
  return { status: res.status, data, text, headers: res.headers };
}
const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
};
const FAKE_TWILIO = {
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_API_KEY_SID: 'SK00000000000000000000000000000000',
  TWILIO_API_KEY_SECRET: 'fake-api-key-secret-not-real',
  TWILIO_TWIML_APP_SID: 'AP00000000000000000000000000000000',
  TWILIO_PHONE_NUMBER: '+15005550006',
  CHEER_BEAR_NUMBER: '+15005550001',
};

console.log('functions (via scripts/dev-api.ts)');

// ------------------------------------------------------------------ public config
await check('GET /api/config returns defaults and all services off', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.config.intentMatchingEngine, 'local');
  assert.deepEqual(r.data.services, { calls: false, transcription: false, sms: false, intentAi: false });
  assert.equal(r.data.updatedAt, null);
  assert.ok(!r.text.includes('fake'), 'no secrets');
});
await check('POST /api/config is 405; unknown /api path is 404', async () => {
  assert.equal((await call('POST', '/api/config', { json: {} })).status, 405);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

// ------------------------------------------------------------------ token + voice, not configured
await check('GET /api/token without Twilio -> 503 not_configured (no crash)', async () => {
  const r = await call('GET', '/api/token');
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'not_configured');
  assert.equal(r.data.mockAvailable, true);
});
await check('POST /api/voice without Twilio -> TwiML that says what is missing', async () => {
  const r = await call('POST', '/api/voice', { form: { To: '+15005550001' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/xml/);
  assert.match(r.text, /<Say>System configuration error: Missing caller identifier.<\/Say>/);
});

// ------------------------------------------------------------------ token + voice, fake credentials
await check('GET /api/token with fake env -> a Voice JWT with the old grants', async () => {
  setEnv(FAKE_TWILIO);
  const r = await call('GET', '/api/token');
  assert.equal(r.status, 200);
  const decoded = jwt.verify(r.data.token, FAKE_TWILIO.TWILIO_API_KEY_SECRET) as any;
  assert.equal(decoded.iss, FAKE_TWILIO.TWILIO_API_KEY_SID);
  assert.equal(decoded.sub, FAKE_TWILIO.TWILIO_ACCOUNT_SID);
  assert.equal(decoded.grants.voice.outgoing.application_sid, FAKE_TWILIO.TWILIO_TWIML_APP_SID);
  assert.equal(decoded.grants.voice.incoming.allow, true);
  assert.match(decoded.grants.identity, /^guest-[0-9a-f]{12}$/);
  assert.ok(decoded.exp - decoded.iat <= 3600);
});
await check('GET /api/token from another origin -> 403', async () => {
  const r = await call('GET', '/api/token', { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});
await check('POST /api/voice TwiML snapshot (no <Start><Stream>, caller ID, record, answerOnBridge)', async () => {
  const r = await call('POST', '/api/voice', { form: { To: '+15005550001', From: 'client:guest-1' } });
  assert.equal(r.status, 200);
  assert.equal(
    r.text,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="+15005550006" answerOnBridge="true" record="record-from-answer"><Number>+15005550001</Number></Dial></Response>',
  );
  assert.ok(!r.text.includes('<Stream'));
});
await check('POST /api/voice with no To dials CHEER_BEAR_NUMBER; TWILIO_RECORD_CALLS=false drops recording', async () => {
  setEnv({ TWILIO_RECORD_CALLS: 'false' });
  const r = await call('POST', '/api/voice', { form: {} });
  assert.equal(r.text, '<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="+15005550006" answerOnBridge="true"><Number>+15005550001</Number></Dial></Response>');
  setEnv({ TWILIO_RECORD_CALLS: undefined });
});
await check('POST /api/voice refuses numbers that are not allowed (toll-fraud guard)', async () => {
  const r = await call('POST', '/api/voice', { form: { To: '+447700900123' } });
  assert.match(r.text, /<Say>Sorry, that number cannot be called from here.<\/Say><Hangup\/>/);
  assert.ok(!r.text.includes('<Dial'));
  setEnv({ ALLOWED_DIAL_TARGETS: '+447700900123, client:support' });
  assert.match((await call('POST', '/api/voice', { form: { To: '+447700900123' } })).text, /<Number>\+447700900123<\/Number>/);
  assert.match((await call('POST', '/api/voice', { form: { To: 'client:support' } })).text, /<Client>support<\/Client>/);
  setEnv({ ALLOWED_DIAL_TARGETS: undefined });
});
await check('POST /api/voice checks X-Twilio-Signature when TWILIO_AUTH_TOKEN is set', async () => {
  setEnv({ TWILIO_AUTH_TOKEN: 'fake_auth_token_0123456789' });
  const params = { To: '+15005550001', CallSid: 'CA123', From: 'client:guest-1' };
  assert.equal((await call('POST', '/api/voice', { form: params })).status, 403, 'missing signature');
  assert.equal((await call('POST', '/api/voice', { form: params, headers: { 'x-twilio-signature': 'bogus' } })).status, 403, 'bad signature');
  const url = `${base}/api/voice`;
  const sig = twilio.getExpectedTwilioSignature('fake_auth_token_0123456789', url, params);
  const ok = await call('POST', '/api/voice', { form: params, headers: { 'x-twilio-signature': sig } });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /<Dial/);
  // Public URL differs from what the function sees (proxy/custom domain): TWILIO_WEBHOOK_URL fixes it.
  const publicUrl = 'https://cheerbear.example/api/voice';
  const sig2 = twilio.getExpectedTwilioSignature('fake_auth_token_0123456789', publicUrl, params);
  assert.equal((await call('POST', '/api/voice', { form: params, headers: { 'x-twilio-signature': sig2 } })).status, 403);
  setEnv({ TWILIO_WEBHOOK_URL: publicUrl });
  assert.equal((await call('POST', '/api/voice', { form: params, headers: { 'x-twilio-signature': sig2 } })).status, 200);
  setEnv({ TWILIO_AUTH_TOKEN: undefined, TWILIO_WEBHOOK_URL: undefined });
});
await check('GET /api/config reports calls configured (booleans only)', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.data.services.calls, true);
  assert.equal(r.data.services.sms, false);
  for (const v of Object.values(FAKE_TWILIO)) assert.ok(!r.text.includes(v), 'no env values in public config');
});

// ------------------------------------------------------------------ realtime-session
await check('POST /api/realtime-session without OpenAI -> 503 not_configured', async () => {
  const r = await call('POST', '/api/realtime-session', { json: { speaker: 'cheer_bear' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'not_configured');
});
await check('realtime-session validates input and origin', async () => {
  assert.equal((await call('POST', '/api/realtime-session', { json: { speaker: 'robot' } })).status, 400);
  assert.equal((await call('POST', '/api/realtime-session', { json: { speaker: 'user' } })).status, 403, 'user audio disabled by default');
  assert.equal((await call('POST', '/api/realtime-session', { json: {}, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/realtime-session', { form: { speaker: 'cheer_bear' } })).status, 415);
  assert.equal((await call('GET', '/api/realtime-session')).status, 405);
});
await check('realtime-session mints a GA transcription client secret (fake OpenAI)', async () => {
  setEnv({ OPENAI_API_KEY: 'sk-fake-not-real', OPENAI_BASE_URL: fakeOpenAIBase });
  upstream.length = 0;
  const r = await call('POST', '/api/realtime-session', { json: { speaker: 'cheer_bear' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { clientSecret: 'ek_test_123', expiresAt: 1900000000, model: 'gpt-4o-mini-transcribe', commit: 'server', callsUrl: `${fakeOpenAIBase}/realtime/calls` });
  const sent = upstream[0];
  assert.equal(sent.path, '/v1/realtime/client_secrets');
  assert.equal(sent.auth, 'Bearer sk-fake-not-real');
  assert.equal(sent.body.session.type, 'transcription');
  assert.deepEqual(sent.body.expires_after, { anchor: 'created_at', seconds: 120 });
  assert.equal(sent.body.session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  assert.equal(sent.body.session.audio.input.transcription.language, 'en');
  assert.match(sent.body.session.audio.input.transcription.prompt, /Rainbow/);
  assert.equal(sent.body.session.audio.input.turn_detection.type, 'server_vad');
  assert.ok(!r.text.includes('sk-fake'), 'API key never returned');
});
await check('realtime-session: gpt-live-transcribe -> client commit, plural languages, keywords; retries without hints on 400', async () => {
  setEnv({ OPENAI_TRANSCRIBE_MODEL: 'gpt-live-transcribe' });
  upstream.length = 0;
  const r = await call('POST', '/api/realtime-session', { json: { speaker: 'cheer_bear' } });
  assert.equal(r.data.commit, 'client');
  const t = upstream[0].body.session.audio.input;
  assert.deepEqual(t.transcription.languages, ['en']);
  assert.equal(t.transcription.language, undefined);
  assert.ok(Array.isArray(t.transcription.keywords));
  assert.equal(t.turn_detection, null);
  clientSecretStatus = 400;
  upstream.length = 0;
  const r2 = await call('POST', '/api/realtime-session', { json: { speaker: 'cheer_bear' } });
  assert.equal(r2.status, 502);
  assert.equal(upstream.length, 2, 'retried once without the optional hint');
  assert.equal(upstream[1].body.session.audio.input.transcription.keywords, undefined);
  clientSecretStatus = 200;
  setEnv({ OPENAI_TRANSCRIBE_MODEL: undefined });
});

// ------------------------------------------------------------------ admin
let token = '';
await check('admin login: deployed site with no admin env -> 503 (refuses to run)', async () => {
  setEnv({ CHEERBEAR_LOCAL_DEV: undefined });
  const r = await call('POST', '/api/admin/login', { json: { username: 'admin', password: 'admin' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'admin_not_configured');
});
await check('admin login: deployed site with admin/admin -> 503', async () => {
  setEnv({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin', JWT_SECRET: 'x'.repeat(40) });
  assert.equal((await call('POST', '/api/admin/login', { json: { username: 'admin', password: 'admin' } })).status, 503);
  setEnv({ ADMIN_PASSWORD: 'correct horse battery', JWT_SECRET: 'short' });
  assert.equal((await call('POST', '/api/admin/login', { json: { username: 'admin', password: 'correct horse battery' } })).status, 503, 'short JWT secret');
});
await check('admin login: real credentials work, wrong ones fail', async () => {
  setEnv({ ADMIN_USERNAME: 'dapo', ADMIN_PASSWORD: 'correct horse battery', JWT_SECRET: 's'.repeat(48) });
  const bad = await call('POST', '/api/admin/login', { json: { username: 'dapo', password: 'wrong password!' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'invalid_credentials');
  assert.equal((await call('POST', '/api/admin/login', { json: { username: 'dapo' } })).status, 400);
  const ok = await call('POST', '/api/admin/login', { json: { username: 'dapo', password: 'correct horse battery' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.devDefaults, false);
  token = ok.data.token;
});
await check('admin login: bcrypt hash in ADMIN_PASSWORD', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  setEnv({ ADMIN_PASSWORD: bcrypt.hashSync('hashed secret pw', 4) });
  assert.equal((await call('POST', '/api/admin/login', { json: { username: 'dapo', password: 'hashed secret pw' } })).status, 200);
  setEnv({ ADMIN_PASSWORD: 'correct horse battery' });
});
await check('admin login locally with nothing set -> admin/admin dev defaults', async () => {
  const saved = { ADMIN_USERNAME: process.env.ADMIN_USERNAME, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, JWT_SECRET: process.env.JWT_SECRET };
  setEnv({ CHEERBEAR_LOCAL_DEV: '1', ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined, JWT_SECRET: undefined });
  const r = await call('POST', '/api/admin/login', { json: { username: 'admin', password: 'admin' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.devDefaults, true);
  setEnv({ ...saved, CHEERBEAR_LOCAL_DEV: undefined });
});
await check('admin endpoints need a valid token', async () => {
  assert.equal((await call('GET', '/api/admin/config')).status, 401);
  assert.equal((await call('GET', '/api/admin/config', { token: 'nope' })).status, 401);
  const forged = jwt.sign({ sub: 'dapo' }, 'another-secret-another-secret-another', { issuer: 'cheerbear-admin' });
  assert.equal((await call('GET', '/api/admin/config', { token: forged })).status, 401);
  const none = jwt.sign({ sub: 'dapo', iss: 'cheerbear-admin' }, '', { algorithm: 'none' });
  assert.equal((await call('GET', '/api/admin/config', { token: none })).status, 401);
});
await check('GET /api/admin/config', async () => {
  const r = await call('GET', '/api/admin/config', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.storage, 'file');
  assert.equal(r.data.config.triggerPolicy.triggerCooldownMs, 3000);
});
await check('PUT /api/admin/config saves, history records it, public config sees it', async () => {
  const r = await call('PUT', '/api/admin/config', { token, json: { triggerPolicy: { triggerCooldownMs: 1500 }, intentMatchingEngine: 'hybrid', localClassifier: { keywords: [...['House', 'Sparkle', 'Running', 'WakeUp', 'Sleep', 'Dance', 'Wave', 'Magic', 'Cold', 'Party', 'Rainbow'], 'Unicorn'] } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.config.triggerPolicy.triggerCooldownMs, 1500);
  assert.equal(r.data.updatedBy, 'dapo');
  const pub = await call('GET', '/api/config');
  assert.equal(pub.data.config.triggerPolicy.triggerCooldownMs, 1500);
  assert.equal(pub.data.config.intentMatchingEngine, 'hybrid');
  const h = await call('GET', '/api/admin/history', { token });
  assert.equal(h.data.history.length, 1);
  assert.match(h.data.history[0].summary, /triggerPolicy.triggerCooldownMs/);
  assert.equal(h.data.history[0].config, undefined, 'history list does not ship whole configs');
});
await check('PUT /api/admin/config rejects invalid input with a list of errors', async () => {
  const r = await call('PUT', '/api/admin/config', { token, json: { triggerPolicy: { triggerCooldownMs: -5 }, intentMatchingEngine: 'magic' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'invalid_config');
  assert.equal(r.data.errors.length, 2);
  assert.equal((await call('PUT', '/api/admin/config', { token, json: ['x'] })).status, 400);
  const big = await call('PUT', '/api/admin/config', { token, json: { ui: { customization: { experienceName: 'x'.repeat(300_000) } } } });
  assert.equal(big.status, 413);
});
await check('POST /api/admin/test-phrase with saved config and with a draft', async () => {
  const r = await call('POST', '/api/admin/test-phrase', { token, json: { text: 'A unicorn at the party!' } });
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(r.data.matches), new Set(['Unicorn', 'Party']));
  assert.equal(r.data.engine, 'hybrid');
  const d = await call('POST', '/api/admin/test-phrase', { token, json: { text: 'a pegasus', draft: { localClassifier: { synonyms: { unicorn: ['pegasus'] } } } } });
  assert.deepEqual(d.data.matches, ['Unicorn']);
  const bad = await call('POST', '/api/admin/test-phrase', { token, json: { text: 'x', draft: { intentMatchingEngine: 'nope' } } });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/admin/test-phrase', { token, json: {} })).status, 400);
});
await check('POST /api/intent (hybrid engine, fake OpenAI) maps answers to configured keywords only', async () => {
  upstream.length = 0;
  const r = await call('POST', '/api/intent', { json: { text: 'abracadabra, look at all the colours in the sky' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { intents: ['Rainbow', 'Unicorn', 'Magic'], engine: 'hybrid', available: true });
  assert.equal(upstream[0].path, '/v1/chat/completions');
  assert.equal(upstream[0].body.model, 'gpt-4o-mini');
  const scoped = await call('POST', '/api/intent', { json: { text: 'hello', keywords: ['Magic'] } });
  assert.deepEqual(scoped.data.intents, ['Magic']);
  assert.equal((await call('POST', '/api/intent', { json: { text: '' } })).status, 400);
});
await check('history restore and reset', async () => {
  await call('PUT', '/api/admin/config', { token, json: { triggerPolicy: { triggerCooldownMs: 2500 } } });
  const h = await call('GET', '/api/admin/history', { token });
  assert.equal(h.data.history.length, 2);
  const first = h.data.history[1].id; // the 1500 ms version
  const restored = await call('POST', '/api/admin/history/restore', { token, json: { id: first } });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.config.triggerPolicy.triggerCooldownMs, 1500);
  assert.equal((await call('POST', '/api/admin/history/restore', { token, json: { id: 'missing' } })).status, 404);
  const reset = await call('POST', '/api/admin/config/reset', { token });
  assert.equal(reset.data.config.triggerPolicy.triggerCooldownMs, 3000);
  assert.equal(reset.data.config.intentMatchingEngine, 'local');
  const h2 = await call('GET', '/api/admin/history', { token });
  assert.equal(h2.data.history[0].summary, 'Reset to defaults');
});
await check('POST /api/intent with the local engine does not call OpenAI', async () => {
  upstream.length = 0;
  const r = await call('POST', '/api/intent', { json: { text: 'abracadabra' } });
  assert.deepEqual(r.data, { intents: [], engine: 'local', available: false });
  assert.equal(upstream.length, 0);
});
await check('GET /api/admin/status reports booleans, never values', async () => {
  const r = await call('GET', '/api/admin/status', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.twilio, true);
  assert.equal(r.data.openai, true);
  assert.equal(r.data.sms, false);
  assert.equal(r.data.storage, 'file');
  assert.equal(r.data.adminConfigured, true);
  assert.ok(!r.text.includes('sk-fake') && !r.text.includes('correct horse'));
});
await check('unknown admin route 404, wrong method 405', async () => {
  assert.equal((await call('GET', '/api/admin/nope', { token })).status, 404);
  assert.equal((await call('DELETE', '/api/admin/config', { token })).status, 405);
});

// ------------------------------------------------------------------ sms
await check('POST /api/sms validates and refuses when not configured', async () => {
  assert.equal((await call('POST', '/api/sms', { json: { message: '' } })).status, 400);
  assert.equal((await call('POST', '/api/sms', { json: { message: 'hi', to: 'not-a-number' } })).status, 400);
  assert.equal((await call('POST', '/api/sms', { json: { message: 'hi', to: '+447700900999' } })).status, 403, 'open relay closed');
  const r = await call('POST', '/api/sms', { json: { message: 'Hello Cheer Bear' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'not_configured');
});
await check('POST /api/sms platform rate limit (10/min, emulated locally) -> 429', async () => {
  let limited = 0;
  for (let i = 0; i < 12; i += 1) if ((await call('POST', '/api/sms', { json: { message: 'x' } })).status === 429) limited += 1;
  assert.ok(limited >= 2, `expected 429s, got ${limited}`);
});

api.close();
fakeOpenAI.close();
rmSync(storeDir, { recursive: true, force: true });
console.log(`functions: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
