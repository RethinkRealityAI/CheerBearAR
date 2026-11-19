// OpenAI calls made by the functions (plain fetch, no SDK: fewer moving parts and a smaller bundle).
import { openaiEnv } from './env';
import { HttpError } from './http';

/** Models that do not support server VAD: the browser must send input_audio_buffer.commit itself. */
const CLIENT_COMMIT_MODELS = new Set(['gpt-live-transcribe', 'gpt-realtime-whisper']);
/** Models that take `languages: [...]` (plural) and `keywords`, per the Realtime transcription docs. */
const PLURAL_LANGUAGE_MODELS = new Set(['gpt-live-transcribe', 'gpt-transcribe']);

export interface TranscriptionSecret {
  clientSecret: string;
  expiresAt: number;
  model: string;
  commit: 'server' | 'client';
  callsUrl: string;
}

/**
 * Mints a short-lived client secret for a Realtime TRANSCRIPTION session (GA API:
 * POST /v1/realtime/client_secrets with session.type = 'transcription'). The browser then connects over WebRTC by
 * POSTing its SDP offer to /v1/realtime/calls with this secret as the bearer token.
 */
export async function mintTranscriptionSecret(opts: { speaker: 'cheer_bear' | 'user'; keywords: string[] }): Promise<TranscriptionSecret> {
  const o = openaiEnv();
  if (!o.apiKey) throw new HttpError(503, 'not_configured', 'Transcription is not set up on this site (OPENAI_API_KEY).');
  const model = o.transcribeModel;
  const commit: 'server' | 'client' = CLIENT_COMMIT_MODELS.has(model) ? 'client' : 'server';
  const vocab = opts.keywords.slice(0, 40);

  const transcription: Record<string, unknown> = { model };
  if (PLURAL_LANGUAGE_MODELS.has(model)) transcription.languages = ['en'];
  else transcription.language = 'en';
  const extras: Record<string, unknown> = {};
  if (PLURAL_LANGUAGE_MODELS.has(model)) extras.keywords = ['Cheer Bear', 'Care-a-Lot', ...vocab];
  else if (model !== 'gpt-realtime-whisper') extras.prompt = `Cheer Bear from the Care Bears talking on a phone call. Words: ${vocab.join(', ')}.`;

  const build = (withExtras: boolean) => ({
    expires_after: { anchor: 'created_at', seconds: 120 },
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: withExtras ? { ...transcription, ...extras } : transcription,
          // Phone audio from the call is already clean; the user's own microphone gets near-field reduction.
          noise_reduction: opts.speaker === 'user' ? { type: 'near_field' } : null,
          turn_detection: commit === 'server' ? { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 } : null,
        },
      },
    },
  });

  let res = await post(`${o.baseUrl}/realtime/client_secrets`, o.apiKey, build(true));
  if (res.status === 400 && Object.keys(extras).length) {
    // An optional hint field was rejected for this model: retry without it rather than failing the call.
    console.warn('[openai] client_secrets rejected the vocabulary hint; retrying without it:', await safeText(res));
    res = await post(`${o.baseUrl}/realtime/client_secrets`, o.apiKey, build(false));
  }
  if (!res.ok) {
    console.error('[openai] client_secrets failed:', res.status, await safeText(res));
    throw new HttpError(502, 'upstream_error', 'Could not start transcription. Please try again.');
  }
  const data = (await res.json()) as { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };
  const value = data.value ?? data.client_secret?.value;
  if (!value) throw new HttpError(502, 'upstream_error', 'Could not start transcription (no client secret returned).');
  return {
    clientSecret: value,
    expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? Math.floor(Date.now() / 1000) + 120,
    model,
    commit,
    callsUrl: `${o.baseUrl}/realtime/calls`,
  };
}

/**
 * Intent fallback (port of the old classifyIntentsWithAI). Returns raw model answers; the caller maps them back to
 * configured keywords. Examples from the classifier config are passed as hints.
 */
export async function classifyIntentsWithAI(text: string, keywords: string[], examples: Record<string, string[]>): Promise<string[]> {
  const o = openaiEnv();
  if (!o.apiKey) return [];
  const exampleLines = keywords
    .map((k) => [k, (examples[k.toLowerCase()] || []).slice(0, 3)] as const)
    .filter(([, ex]) => ex.length)
    .map(([k, ex]) => `${k}: ${ex.map((e) => JSON.stringify(e)).join('; ')}`);
  const system = [
    'You are an intent classifier for animation triggers in a children\'s character app.',
    'Return ONLY valid JSON with shape: {"intents": [<keyword>, ...]}.',
    'Choose zero or more keywords from the provided list that the input clearly refers to.',
    'Consider punctuation, pluralization, misspellings, homophones and close synonyms.',
    'If not confident, return an empty array. Never invent keywords that are not in the list.',
  ].join(' ');
  const user = `Keywords: [${keywords.join(', ')}]\n${exampleLines.length ? `Examples:\n${exampleLines.join('\n')}\n` : ''}Input: ${JSON.stringify(text)}`;
  const res = await post(`${o.baseUrl}/chat/completions`, o.apiKey, {
    model: o.intentModel,
    temperature: 0,
    max_tokens: 100,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }, 8000);
  if (!res.ok) {
    console.error('[openai] intent classification failed:', res.status, await safeText(res));
    return [];
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  try {
    const parsed = JSON.parse(content) as { intents?: unknown };
    return Array.isArray(parsed.intents) ? parsed.intents.map(String).slice(0, 20) : [];
  } catch {
    return content ? [content.slice(0, 50)] : [];
  }
}

async function post(url: string, apiKey: string, body: unknown, timeoutMs = 10_000): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
