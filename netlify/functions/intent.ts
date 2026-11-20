// POST /api/intent { text, keywords? } -> { intents: string[], engine, available }
// The OpenAI intent fallback for the `hybrid` / `openai` engines (port of the old classifyIntentsWithAI). The browser
// does local keyword matching itself and only calls this when the engine asks for AI.
//
// Behaviour change from the old server: the old code dropped any AI answer whose keyword was not literally in the
// text, which made the AI fallback a no-op (local matching had already found those). Here an AI answer only has to
// be one of the configured keywords.
import type { Config } from '@netlify/functions';
import { getConfig } from '../lib/store';
import { classifyIntentsWithAI } from '../lib/openai';
import { openaiEnv } from '../lib/env';
import { assertSameOrigin, cleanText, clientIp, handle, HttpError, json, rateLimit, readJson, requireMethod } from '../lib/http';
import { canonicalKeyword, sanitizeEnglishText, sanitizeKeywords } from '../../src/shared/classifier';
import { LIMITS } from '../../src/shared/config';

export default handle(async (req, context) => {
  requireMethod(req, 'POST');
  assertSameOrigin(req);
  rateLimit(`intent:${clientIp(req, context)}`, 60, 60_000);
  const body = await readJson<{ text?: unknown; keywords?: unknown }>(req, 16_384);
  const { config } = await getConfig();
  const engine = config.intentMatchingEngine;

  let text = cleanText(body.text, 2000);
  if (config.englishOnlyTranscripts) text = sanitizeEnglishText(text);
  if (!text) throw new HttpError(400, 'bad_text', 'text is required (max 2000 characters).');

  // The app may narrow or extend the keyword list (user-added keywords), within bounds.
  const requested = sanitizeKeywords(body.keywords).filter((k) => k.length <= LIMITS.keywordLength && /^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u.test(k));
  const keywords = (requested.length ? requested : config.localClassifier.keywords).slice(0, LIMITS.keywords);

  if (engine === 'local' || !openaiEnv().apiKey) return json({ intents: [], engine, available: false });

  const raw = await classifyIntentsWithAI(text, keywords, config.localClassifier.examples);
  const intents = [...new Set(raw.map((r) => canonicalKeyword(r, keywords)).filter((k): k is string => !!k))];
  return json({ intents, engine, available: true });
});

export const config: Config = { path: '/api/intent', method: 'POST' };
