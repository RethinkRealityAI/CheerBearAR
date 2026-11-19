// POST /api/voice: the TwiML webhook Twilio calls when the browser places a call through our TwiML app.
// Same dial logic and caller ID as the old /voice, WITHOUT <Start><Stream> (no media stream: transcription now runs
// in the browser). Set the TwiML app's Voice URL to https://<site>/api/voice (HTTP POST).
//
// Security:
//   - When TWILIO_AUTH_TOKEN is set, the X-Twilio-Signature header is checked (HMAC over the exact public URL plus
//     the POST params). Netlify hands the function the public URL, but a custom domain, a proxy or a trailing slash
//     changes it, so set TWILIO_WEBHOOK_URL to the exact URL in the Twilio console if validation fails.
//   - The destination must be CHEER_BEAR_NUMBER or listed in ALLOWED_DIAL_TARGETS. The old server dialled any `To`,
//     which let anyone with a token place calls to any number at our cost.
import type { Config } from '@netlify/functions';
import twilio from 'twilio';
import { allowedDialTargets, cheerBearNumber, twilioEnv } from '../lib/env';
import { handle, readText, requireMethod } from '../lib/http';

function twiml(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** URLs Twilio may have signed: an explicit override, the URL we were called on, and the forwarded-host variant. */
export function candidateUrls(req: Request): string[] {
  const out = new Set<string>();
  const override = (process.env.TWILIO_WEBHOOK_URL || '').trim();
  if (override) out.add(override);
  out.add(req.url);
  try {
    const u = new URL(req.url);
    const host = req.headers.get('x-forwarded-host');
    const proto = req.headers.get('x-forwarded-proto');
    if (host || proto) {
      const v = new URL(u.toString());
      if (host) v.host = host;
      if (proto) v.protocol = `${proto.split(',')[0].trim()}:`;
      out.add(v.toString());
    }
    if (u.protocol === 'http:') {
      const v = new URL(u.toString());
      v.protocol = 'https:';
      out.add(v.toString());
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

export default handle(async (req) => {
  requireMethod(req, 'POST', 'GET');
  const t = twilioEnv();
  const VoiceResponse = twilio.twiml.VoiceResponse;

  // Twilio posts application/x-www-form-urlencoded; a GET webhook puts the params in the query.
  const bodyText = req.method === 'POST' ? await readText(req, 32_768) : '';
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(bodyText)) params[k] = v;
  const query = new URL(req.url).searchParams;

  if (t.authToken) {
    const signature = req.headers.get('x-twilio-signature') || '';
    const ok = !!signature && candidateUrls(req).some((url) => twilio.validateRequest(t.authToken, signature, url, params));
    if (!ok) {
      console.warn('[voice] Rejected request: bad or missing X-Twilio-Signature. If this is Twilio, set TWILIO_WEBHOOK_URL to the exact Voice URL.');
      return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
    }
  } else {
    console.warn('[voice] TWILIO_AUTH_TOKEN is not set: webhook signatures are NOT being checked.');
  }

  const response = new VoiceResponse();
  const callerId = t.callerId;
  if (!callerId) {
    console.error('[voice] TWILIO_PHONE_NUMBER is not set.');
    response.say('System configuration error: Missing caller identifier.');
    return twiml(response.toString());
  }

  const requested = (params.To || params.to || query.get('To') || query.get('to') || '').trim();
  const target = requested || cheerBearNumber();
  if (!target) {
    console.warn('[voice] No "To" and no CHEER_BEAR_NUMBER.');
    response.say('Welcome to the AI Voice Assistant. Please wait for a manual connection.');
    return twiml(response.toString());
  }
  if (!allowedDialTargets().includes(target)) {
    console.warn('[voice] Refused to dial a destination that is not allowed.');
    response.say('Sorry, that number cannot be called from here.');
    response.hangup();
    return twiml(response.toString());
  }

  const record = (process.env.TWILIO_RECORD_CALLS || 'true').trim().toLowerCase() !== 'false';
  const dial = response.dial({
    callerId,
    // answerOnBridge keeps the browser call "ringing" until Cheer Bear picks up (so the app can show ringing).
    answerOnBridge: true,
    ...(record ? { record: 'record-from-answer' as const } : {}),
  });
  if (target.startsWith('client:')) dial.client(target.slice('client:'.length));
  else dial.number(target);
  return twiml(response.toString());
});

export const config: Config = { path: '/api/voice', method: ['POST', 'GET'] };
