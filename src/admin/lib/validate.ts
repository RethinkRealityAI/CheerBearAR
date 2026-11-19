import { LIMITS as SERVER_LIMITS, validateConfig as serverValidate, type AppConfig } from '@/shared/config';

/** Errors keyed by dotted config path (lists use .0, .1), in plain words. */
export type Errors = Record<string, string>;

// Same rules as the server (src/shared/config.ts), written for people. The server's own validator runs afterwards as
// a backstop, so a save never bounces on something the panel did not flag.
export const KEYWORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const LIMITS = {
  ...SERVER_LIMITS,
  msMax: SERVER_LIMITS.maxMs,
  uiDelayMax: SERVER_LIMITS.maxMs,
};

export function keywordProblem(word: string, existing: string[]): string | null {
  const w = word.trim();
  if (!w) return 'Type a word first.';
  if (w.length > LIMITS.keywordLength) return `Keep it under ${LIMITS.keywordLength} characters.`;
  if (!KEYWORD_RE.test(w)) return 'Use letters, numbers, spaces, dashes or apostrophes only.';
  if (existing.some((k) => k.toLowerCase() === w.toLowerCase())) return `"${w}" is already a keyword.`;
  if (existing.length >= LIMITS.keywords) return `You can have up to ${LIMITS.keywords} keywords.`;
  return null;
}

function ms(errors: Errors, path: string, v: unknown, max: number, what: string) {
  if (typeof v !== 'number' || !Number.isFinite(v)) errors[path] = `Enter a number for ${what}.`;
  else if (!Number.isInteger(v)) errors[path] = 'Use a whole number of milliseconds.';
  else if (v < 0 || v > max) errors[path] = `${what[0].toUpperCase()}${what.slice(1)} must be between 0 and ${max.toLocaleString()} ms (${max / 1000} s).`;
}

function text(errors: Errors, path: string, v: unknown, label: string, opts: { required?: boolean; max?: number } = {}) {
  const s = typeof v === 'string' ? v : '';
  if (opts.required && !s.trim()) errors[path] = `${label} can't be empty.`;
  else if (s.length > (opts.max ?? LIMITS.textShort)) errors[path] = `${label} is too long (max ${opts.max ?? LIMITS.textShort} characters).`;
}

function url(errors: Errors, path: string, v: unknown, label: string) {
  if (typeof v !== 'string' || !v.trim()) return;
  if (v.startsWith('/') && !v.startsWith('//')) return;
  try {
    if (new URL(v).protocol !== 'https:') throw new Error();
  } catch {
    errors[path] = `${label} must start with https:// or be a path on this site starting with /.`;
  }
}

/** "gameModes[0].name: must not be empty" -> ["gameModes.0.name", "Must not be empty."] */
function fromServer(line: string): [string, string] {
  const i = line.indexOf(': ');
  const path = (i > 0 ? line.slice(0, i) : 'config').replace(/\[(\d+)\]/g, '.$1');
  const msg = i > 0 ? line.slice(i + 2) : line;
  return [path, `${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`];
}

export function validateConfig(c: AppConfig): Errors {
  const e: Errors = {};

  // classifier
  const lc = c.localClassifier;
  const kws = lc?.keywords ?? [];
  if (kws.length > LIMITS.keywords) e['localClassifier.keywords'] = `Too many keywords (max ${LIMITS.keywords}).`;
  const bad = kws.find((k) => !KEYWORD_RE.test(k.trim()) || k.length > LIMITS.keywordLength);
  if (bad) e['localClassifier.keywords'] = `"${bad}" has characters keywords can't use.`;
  for (const [k, list] of Object.entries(lc?.synonyms ?? {})) {
    if (list.length > LIMITS.synonymsPerKeyword) e[`localClassifier.synonyms.${k}`] = `Up to ${LIMITS.synonymsPerKeyword} other words per keyword.`;
  }
  for (const [k, list] of Object.entries(lc?.examples ?? {})) {
    if (list.length > LIMITS.examplesPerKeyword) e[`localClassifier.examples.${k}`] = `Up to ${LIMITS.examplesPerKeyword} example phrases per keyword.`;
  }

  // trigger policy
  ms(e, 'triggerPolicy.triggerCooldownMs', c.triggerPolicy?.triggerCooldownMs, LIMITS.msMax, 'the cooldown');
  ms(e, 'triggerPolicy.dispatchIntervalMs', c.triggerPolicy?.dispatchIntervalMs, LIMITS.msMax, 'the gap between queued reactions');

  // game modes
  const gms = c.gameModes ?? [];
  if (gms.length > LIMITS.gameModes) e['gameModes'] = `Too many game modes (max ${LIMITS.gameModes}).`;
  const names = new Map<string, number>();
  gms.forEach((gm, i) => {
    const p = `gameModes.${i}`;
    text(e, `${p}.name`, gm.name, 'The name', { required: true });
    text(e, `${p}.description`, gm.description, 'The description', { max: LIMITS.textLong });
    text(e, `${p}.objective`, gm.objective, 'The goal', { max: LIMITS.textLong });
    text(e, `${p}.instructions`, gm.instructions, 'How to play', { max: LIMITS.textLong });
    const key = gm.name.trim().toLowerCase();
    if (key && names.has(key)) e[`${p}.name`] = 'Another game mode already has this name.';
    names.set(key, i);
  });
  if (c.activeGameMode) {
    const active = gms.find((g) => g.id === c.activeGameMode);
    if (!active) e['activeGameMode'] = 'The starting game no longer exists. Pick another or choose None.';
    else if (!active.enabled) e['activeGameMode'] = `"${active.name}" is switched off, so visitors can't start with it. Switch it on or pick another.`;
  }

  // ui
  const cu = c.ui?.customization;
  if (cu) {
    const p = 'ui.customization';
    for (const k of ['primaryColor', 'secondaryColor', 'accentColor'] as const) {
      if (!HEX_RE.test(cu[k] ?? '')) e[`${p}.${k}`] = 'Use a colour like #ff389b (a # and six digits or letters a–f).';
    }
    text(e, `${p}.experienceName`, cu.experienceName, 'The experience name', { required: true });
    for (const k of ['headerTitle', 'chatPlaceholder', 'commandPlaceholder', 'callButtonText', 'hangupButtonText', 'collapsedChatText'] as const) {
      text(e, `${p}.${k}`, cu[k], 'This text');
    }
    ms(e, `${p}.uiDelayMs`, cu.uiDelayMs, LIMITS.uiDelayMax, 'the wait');
    const wm = cu.welcomeModal;
    if (wm) {
      text(e, `${p}.welcomeModal.title`, wm.title, 'The title', { required: wm.enabled });
      text(e, `${p}.welcomeModal.description`, wm.description, 'The intro text', { max: LIMITS.textLong });
      ms(e, `${p}.welcomeModal.delayMs`, wm.delayMs, LIMITS.uiDelayMax, 'the extra wait');
      if (!Number.isInteger(wm.version) || wm.version < 0) e[`${p}.welcomeModal.version`] = 'The version must be a whole number.';
      url(e, `${p}.welcomeModal.heroImageUrl`, wm.heroImageUrl, 'The picture address');
      if ((wm.items?.length ?? 0) > LIMITS.welcomeItems) e[`${p}.welcomeModal.items`] = `Up to ${LIMITS.welcomeItems} items.`;
      wm.items?.forEach((it, i) => {
        text(e, `${p}.welcomeModal.items.${i}.title`, it.title, 'The title', { required: true });
        text(e, `${p}.welcomeModal.items.${i}.description`, it.description, 'The text', { max: LIMITS.textLong });
        url(e, `${p}.welcomeModal.items.${i}.imageUrl`, it.imageUrl, 'The picture address');
      });
    }
  }

  // Backstop: anything else the server would reject, under the nearest path, unless already explained.
  for (const line of serverValidate(c)) {
    const [path, msg] = fromServer(line);
    const covered = Object.keys(e).some((k) => k === path || path.startsWith(`${k}.`) || k.startsWith(`${path}.`));
    if (!covered) e[path] = msg;
  }
  return e;
}
