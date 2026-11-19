// POST /api/sms { message } -> { success, sid }
// The SMS bridge (port of the old /send-sms): texts the user's message to Cheer Bear's number.
// Changed for safety: the destination is ALWAYS CHEER_BEAR_NUMBER (or one of ALLOWED_DIAL_TARGETS); the old server
// texted any `to` the browser sent, which made it an open SMS relay.
import type { Config } from '@netlify/functions';
import twilio from 'twilio';
import { allowedDialTargets, cheerBearNumber, missingTwilioForSms, twilioEnv } from '../lib/env';
import { assertSameOrigin, cleanText, clientIp, E164, error, handle, HttpError, json, rateLimit, readJson, requireMethod } from '../lib/http';

export default handle(async (req, context) => {
  requireMethod(req, 'POST');
  assertSameOrigin(req);
  rateLimit(`sms:${clientIp(req, context)}`, 10, 60_000);
  const body = await readJson<{ message?: unknown; to?: unknown }>(req, 8192);

  const message = cleanText(body.message, 1600);
  if (!message) throw new HttpError(400, 'bad_message', 'message is required (1-1600 characters).');

  const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : cheerBearNumber();
  if (!E164.test(to)) throw new HttpError(400, 'bad_number', 'Invalid phone number format.');
  if (!allowedDialTargets().includes(to)) throw new HttpError(403, 'number_not_allowed', 'Messages can only go to Cheer Bear.');

  const t = twilioEnv();
  const missing = missingTwilioForSms(t);
  if (missing.length) {
    console.warn('[sms] Twilio SMS is not configured; missing:', missing.join(', '));
    return error(503, 'not_configured', 'Text messages are not set up on this site yet.');
  }
  try {
    const client = twilio(t.accountSid, t.authToken);
    const sent = await client.messages.create({ body: message, from: t.smsFrom, to });
    return json({ success: true, sid: sent.sid });
  } catch (err) {
    console.error('[sms] Twilio send failed:', err instanceof Error ? err.message : err);
    return error(502, 'upstream_error', 'The message could not be sent. Please try again.');
  }
});

export const config: Config = {
  path: '/api/sms',
  method: 'POST',
  // Platform rate limit (Netlify, across instances): SMS costs money per message.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
