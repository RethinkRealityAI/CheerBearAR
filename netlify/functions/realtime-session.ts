// POST /api/realtime-session { speaker: 'cheer_bear' | 'user' }
// Mints a short-lived OpenAI Realtime client secret for a transcription session, so the browser can stream call
// audio straight to OpenAI over WebRTC. The API key never leaves the server; the secret only works for ~2 minutes to
// open a session. The user's own microphone is only allowed when the admin turned on allowUserAudioToOpenAI.
import type { Config } from '@netlify/functions';
import { getConfig } from '../lib/store';
import { mintTranscriptionSecret } from '../lib/openai';
import { assertSameOrigin, clientIp, handle, HttpError, json, rateLimit, readJson, requireMethod } from '../lib/http';

export default handle(async (req, context) => {
  requireMethod(req, 'POST');
  assertSameOrigin(req);
  rateLimit(`rt:${clientIp(req, context)}`, 20, 60_000);
  const body = await readJson<{ speaker?: unknown }>(req, 1024);
  const speaker = body.speaker === 'user' ? 'user' : body.speaker === 'cheer_bear' || body.speaker === undefined ? 'cheer_bear' : null;
  if (!speaker) throw new HttpError(400, 'bad_speaker', 'speaker must be "cheer_bear" or "user".');

  const { config } = await getConfig();
  if (speaker === 'user' && !config.allowUserAudioToOpenAI) {
    throw new HttpError(403, 'user_audio_disabled', 'Sending the user\'s audio to OpenAI is turned off in admin.');
  }
  const secret = await mintTranscriptionSecret({ speaker, keywords: config.localClassifier.keywords });
  return json(secret);
});

export const config: Config = {
  path: '/api/realtime-session',
  method: 'POST',
  // Platform rate limit (enforced by Netlify across all instances). One call opens 1-2 sessions plus reconnects.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
