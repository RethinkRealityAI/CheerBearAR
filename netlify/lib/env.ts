// Reads server-side settings from environment variables (Netlify site settings, or .env locally).
// Values never leave the server; only the booleans from `services()` are ever returned to a browser.

const env = (name: string): string => (process.env[name] || '').trim();

export interface TwilioEnv {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  authToken: string;
  callerId: string;
  smsFrom: string;
}

export function twilioEnv(): TwilioEnv {
  return {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    apiKeySid: env('TWILIO_API_KEY_SID'),
    apiKeySecret: env('TWILIO_API_KEY_SECRET'),
    twimlAppSid: env('TWILIO_TWIML_APP_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    callerId: env('TWILIO_PHONE_NUMBER'),
    smsFrom: env('TWILIO_SMS_FROM') || env('TWILIO_PHONE_NUMBER'),
  };
}

/** Happi's real phone number: the default (and normally only) number the TwiML app may dial and text. */
export function cheerBearNumber(): string {
  return env('CHEER_BEAR_NUMBER') || env('DEFAULT_CALL_TARGET');
}

/** Numbers / client identities the TwiML webhook may dial. Always includes CHEER_BEAR_NUMBER. */
export function allowedDialTargets(): string[] {
  const list = env('ALLOWED_DIAL_TARGETS').split(',').map((s) => s.trim()).filter(Boolean);
  const main = cheerBearNumber();
  return main ? [main, ...list.filter((n) => n !== main)] : list;
}

export function missingTwilioForToken(t = twilioEnv()): string[] {
  const missing: string[] = [];
  if (!t.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!t.apiKeySid) missing.push('TWILIO_API_KEY_SID');
  if (!t.apiKeySecret) missing.push('TWILIO_API_KEY_SECRET');
  if (!t.twimlAppSid) missing.push('TWILIO_TWIML_APP_SID');
  return missing;
}

export function missingTwilioForVoice(t = twilioEnv()): string[] {
  const missing: string[] = [];
  if (!t.callerId) missing.push('TWILIO_PHONE_NUMBER');
  if (!cheerBearNumber()) missing.push('CHEER_BEAR_NUMBER');
  return missing;
}

export function missingTwilioForSms(t = twilioEnv()): string[] {
  const missing: string[] = [];
  if (!t.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!t.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!t.smsFrom) missing.push('TWILIO_PHONE_NUMBER');
  if (!cheerBearNumber()) missing.push('CHEER_BEAR_NUMBER');
  return missing;
}

export const openaiEnv = () => ({
  apiKey: env('OPENAI_API_KEY'),
  /** Realtime transcription model. gpt-4o-mini-transcribe works with server VAD (the old default). */
  transcribeModel: env('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe',
  intentModel: env('OPENAI_INTENT_MODEL') || 'gpt-4o-mini',
  /** Happi's AI chat brain (/api/chat): a small, fast chat model. */
  chatModel: env('OPENAI_CHAT_MODEL') || 'gpt-4o-mini',
  moderationModel: env('OPENAI_MODERATION_MODEL') || 'omni-moderation-latest',
  baseUrl: env('OPENAI_BASE_URL') || 'https://api.openai.com/v1',
});

export function services() {
  const t = twilioEnv();
  const o = openaiEnv();
  return {
    calls: missingTwilioForToken(t).length === 0 && missingTwilioForVoice(t).length === 0,
    transcription: !!o.apiKey,
    sms: missingTwilioForSms(t).length === 0,
    intentAi: !!o.apiKey,
    chatAi: !!o.apiKey,
  };
}
