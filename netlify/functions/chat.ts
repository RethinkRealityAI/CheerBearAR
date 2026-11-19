// POST /api/chat { text, history?, name? } -> { reply, flagged, source: 'ai' }
// Happi's optional AI brain for the demo call and typed chat (src/voice/brain.ts). Same-origin only, per-IP limit,
// 8 KB body. The child's text is redacted (emails, links, digit runs) and run through OpenAI moderation first; a
// flagged message gets a fixed kind answer and never reaches the chat model. The reply is moderated too.
// 503 not_configured without OPENAI_API_KEY; 403 disabled when the admin turned the AI brain off. The browser uses
// its local brain whenever this does not answer 200.
import type { Config } from '@netlify/functions';
import { getConfig } from '../lib/store';
import { openaiEnv } from '../lib/env';
import { chatReply, isFlagged, redactPersonal, SAFE_REPLY, type ChatTurn } from '../lib/chat';
import { assertSameOrigin, cleanText, clientIp, handle, HttpError, json, rateLimit, readJson, requireMethod } from '../lib/http';
import { sanitizeEnglishText } from '../../src/shared/classifier';

const NAME_RE = /^[\p{L}][\p{L}'-]{0,19}$/u;

export default handle(async (req, context) => {
  requireMethod(req, 'POST');
  assertSameOrigin(req);
  rateLimit(`chat:${clientIp(req, context)}`, 20, 60_000);
  const body = await readJson<{ text?: unknown; history?: unknown; name?: unknown }>(req, 8192);

  if (!openaiEnv().apiKey) throw new HttpError(503, 'not_configured', 'The AI chat brain is not set up on this site.');
  const { config } = await getConfig();
  if (!config.demoVoice.useAiBrain) throw new HttpError(403, 'disabled', 'The AI chat brain is turned off.');

  const clean = (v: unknown, max: number) => {
    const t = cleanText(v, max);
    return config.englishOnlyTranscripts ? sanitizeEnglishText(t) : t;
  };
  const text = redactPersonal(clean(body.text, 500));
  if (!text) throw new HttpError(400, 'bad_text', 'text is required (max 500 characters).');

  const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
    .slice(-8)
    .map((h) => (h && typeof h === 'object' ? (h as Record<string, unknown>) : {}))
    .filter((h) => h.role === 'user' || h.role === 'cheer_bear')
    .map((h) => ({ role: h.role as ChatTurn['role'], text: redactPersonal(clean(h.text, 300)) }))
    .filter((h) => h.text);
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = NAME_RE.test(rawName) ? rawName : null;

  if (await isFlagged(text)) return json({ reply: SAFE_REPLY, flagged: true, source: 'ai' });
  const reply = await chatReply({ text, history, name, keywords: config.localClassifier.keywords });
  if (await isFlagged(reply)) return json({ reply: SAFE_REPLY, flagged: true, source: 'ai' });
  return json({ reply, flagged: false, source: 'ai' });
});

export const config: Config = { path: '/api/chat', method: 'POST' };
