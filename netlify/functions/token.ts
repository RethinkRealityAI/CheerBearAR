// GET /api/token: a Twilio Voice access token for the browser (same grants as the old /token: outgoing calls through
// our TwiML app, incoming allowed). Returns 503 { error: 'not_configured' } when Twilio env vars are missing, so the
// app can offer the demo (mock) call instead of crashing.
import type { Config } from '@netlify/functions';
import { randomBytes } from 'node:crypto';
import twilio from 'twilio';
import { missingTwilioForToken, missingTwilioForVoice, twilioEnv } from '../lib/env';
import { assertSameOrigin, clientIp, error, handle, json, rateLimit, requireMethod } from '../lib/http';

const TTL_S = 3600;

export default handle(async (req, context) => {
  requireMethod(req, 'GET');
  assertSameOrigin(req);
  rateLimit(`token:${clientIp(req, context)}`, 30, 60_000);

  const t = twilioEnv();
  const missing = [...missingTwilioForToken(t), ...missingTwilioForVoice(t)];
  if (missing.length) {
    console.warn('[token] Twilio is not configured; missing:', missing.join(', '));
    return error(503, 'not_configured', 'Calling is not set up on this site yet.', { mockAvailable: true });
  }

  const { AccessToken } = twilio.jwt;
  const grant = new AccessToken.VoiceGrant({ outgoingApplicationSid: t.twimlAppSid, incomingAllow: true });
  // A random identity per browser (the old server used 'user' for everyone, which made every open tab ring on an
  // incoming call to client:user). Outgoing calls do not depend on it.
  const identity = `guest-${randomBytes(6).toString('hex')}`;
  const token = new AccessToken(t.accountSid, t.apiKeySid, t.apiKeySecret, { identity, ttl: TTL_S });
  token.addGrant(grant);
  return json({ token: token.toJwt(), identity, ttl: TTL_S });
});

export const config: Config = { path: '/api/token', method: 'GET' };
