// Happi's AI chat brain (POST /api/chat): a strict kid-safe persona on a small, fast OpenAI chat model, with
// OpenAI moderation on the child's text before anything else and on the reply after. Plain fetch, no SDK.
// The browser falls back to its local brain (src/voice/cheerBrain.ts) whenever this fails, so errors are thrown,
// never papered over here.
import { openaiEnv } from './env';
import { HttpError } from './http';

export interface ChatTurn {
  role: 'user' | 'cheer_bear';
  text: string;
}

/** What each core trigger word means, so the model can answer an action request with the right word. */
const ACTION_HINTS: Record<string, string> = {
  house: 'show your house (say "house")',
  sparkle: 'sparkle or shine (say "sparkle")',
  running: 'run around (say "running")',
  wakeup: 'wake up (say "wake up")',
  sleep: 'go to sleep or take a nap (say "sleep")',
  dance: 'dance (say "dance")',
  wave: 'wave hello or goodbye (say "wave")',
  magic: 'do magic or a trick (say "magic")',
  cold: 'say if you feel cold or chilly (say "cold")',
  party: 'have a party or celebrate (say "party")',
  rainbow: 'make a rainbow (say "rainbow")',
};

export function personaPrompt(keywords: string[], name: string | null): string {
  const actions = keywords
    .slice(0, 40)
    .map((k) => `- ${k}: ${ACTION_HINTS[k.toLowerCase().replace(/[^a-z]/g, '')] ?? `say "${k}"`}`)
    .join('\n');
  return [
    'You are Happi, the cheerful, kind official mascot of the Japan Parade & Street Fair in New York City (an orange squirrel in a navy happi coat), talking with a young child (about 4 to 10 years old) in a children\'s app.',
    'Rules you always follow:',
    '- Reply in 1 or 2 short sentences (under 30 words), simple happy words a small child understands. No lists, no emoji, no markdown.',
    '- Never ask for personal information. The only thing you may ask is the child\'s first name. Never ask for or repeat surnames, ages, addresses, schools, phone numbers, emails, photos or passwords; if the child shares one, gently say to keep it private for their grown-ups.',
    '- Never give links, websites, apps, products or prices. Never pretend to be a real person. You are a friendly mascot character.',
    '- If the child brings up anything unsafe, scary, violent, grown-up, medical, or says they are hurt or in danger, answer with warmth, say a trusted grown-up can help, and do not go into details.',
    '- Keep facts general and friendly (the parade, Japanese festival fun, New York, friendship). Do not invent dates, places, schedules or facts you are unsure of.',
    '- Be encouraging and positive. Ask a short friendly question back sometimes.',
    'Magic words: when the child ASKS you to do one of these actions, say yes and include that exact word in your reply. In any other reply, do NOT use these words at all (they make things happen on screen):',
    actions,
    name ? `The child's first name is ${name}. Use it now and then.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Removes personal details before the text leaves our server: emails, URLs, long digit runs (phone numbers, addresses). */
export function redactPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[private]')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, '[link]')
    .replace(/(?:\+?\d[\s().-]*){5,}/g, '[private] ');
}

/** Makes a model reply safe to show and speak: plain text, no links/emoji/markdown, at most 2 sentences, 240 chars. */
export function cleanReply(raw: string): string {
  let t = String(raw || '')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/[*_`#>~|[\]{}<>]/g, '')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^cheer bear\s*:/i.test(t)) t = t.replace(/^cheer bear\s*:\s*/i, '');
  const sentences = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  t = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (t.length > 240) t = `${t.slice(0, 237).replace(/\s+\S*$/, '')}...`;
  return t;
}

/** True when OpenAI moderation flags the text. Throws when moderation itself fails (fail closed). */
export async function isFlagged(text: string): Promise<boolean> {
  const o = openaiEnv();
  const res = await post(`${o.baseUrl}/moderations`, o.apiKey, { model: o.moderationModel, input: text }, 6000);
  if (!res.ok) {
    console.error('[chat] moderation failed:', res.status, await safeText(res));
    throw new HttpError(502, 'upstream_error', 'Happi could not answer right now.');
  }
  const data = (await res.json()) as { results?: Array<{ flagged?: boolean }> };
  if (!Array.isArray(data.results)) throw new HttpError(502, 'upstream_error', 'Happi could not answer right now.');
  return data.results.some((r) => r?.flagged === true);
}

export async function chatReply(opts: { text: string; history: ChatTurn[]; name: string | null; keywords: string[] }): Promise<string> {
  const o = openaiEnv();
  const messages = [
    { role: 'system', content: personaPrompt(opts.keywords, opts.name) },
    ...opts.history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: opts.text },
  ];
  const res = await post(`${o.baseUrl}/chat/completions`, o.apiKey, {
    model: o.chatModel,
    temperature: 0.8,
    max_tokens: 90,
    messages,
  }, 9000);
  if (!res.ok) {
    console.error('[chat] completion failed:', res.status, await safeText(res));
    throw new HttpError(502, 'upstream_error', 'Happi could not answer right now.');
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const reply = cleanReply(data.choices?.[0]?.message?.content || '');
  if (!reply) throw new HttpError(502, 'upstream_error', 'Happi could not answer right now.');
  return reply;
}

/** Said when the child's message (or a reply) is flagged. Contains no trigger words. */
export const SAFE_REPLY = "Let's talk about something happy instead! If something is bothering you, a grown-up you trust can help. Want to hear a joke?";

async function post(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error('[chat] OpenAI request failed:', err instanceof Error ? err.message : err);
    throw new HttpError(502, 'upstream_error', 'Happi could not answer right now.');
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
