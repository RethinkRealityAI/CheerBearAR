// What to tell the child (and the grown-up) when listening goes wrong (voice-4). Pure: unit tested in
// scripts/check-voice-hold.ts.
//
// Every way a hold can fail ends in one `HoldProblem`; `problemHelp()` turns it into one short, kind line for the
// child, an optional line for a grown-up saying what to change, whether the magic-word chips should show, and whether
// pressing again can work at all this session (`block`). See docs/handoff/voice-4.md for where each one comes from.

export type HoldProblem =
  /** Recognition ran, heard nothing (no-speech, or no results before the end). */
  | 'no-speech'
  /** Let go before the microphone opened. */
  | 'too-short'
  /** Let go before the microphone opened while the browser was asking for permission. */
  | 'permission-pending'
  /** Mic permission refused (not-allowed and the permission really is denied). */
  | 'not-allowed'
  /** not-allowed although the permission is not denied (prompt dismissed, no gesture): pressing again can work. */
  | 'not-allowed-soft'
  /** service-not-allowed: iOS with Siri & Dictation off; elsewhere the browser's speech service is off. */
  | 'service-not-allowed'
  /** network: the cloud speech service could not be reached (offline, blocked network, Brave, some webviews). */
  | 'network'
  /** audio-capture: no microphone, or another app / tab has it. */
  | 'audio-capture'
  /** aborted by the browser itself (another recognition started, the system took the mic). */
  | 'aborted'
  /** start() threw (InvalidStateError and friends). */
  | 'start-failed'
  /** No SpeechRecognition at all (Firefox, some in-app browsers) or the language is not supported. */
  | 'unsupported'
  /** Anything else the browser reports. */
  | 'error';

export interface VoicePlatform {
  ios: boolean;
  android: boolean;
  samsung: boolean;
  /** Android WebView or an iOS/Android in-app browser (Instagram, Facebook, TikTok, LINE, Gmail on iOS...). */
  inApp: boolean;
  firefox: boolean;
  brave: boolean;
  /** Short name for logs: "Chrome 142 Android", "Safari iOS 18.1"... */
  name: string;
}

export function voicePlatform(nav: { userAgent: string; platform?: string; maxTouchPoints?: number; brave?: unknown } = typeof navigator !== 'undefined' ? navigator as never : { userAgent: '' }): VoicePlatform {
  const ua = nav.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  const android = /Android/i.test(ua);
  const samsung = /SamsungBrowser/i.test(ua);
  const firefox = /Firefox|FxiOS/i.test(ua);
  const brave = !!nav.brave;
  const inApp = /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|GSA\/|Twitter|LinkedInApp|Pinterest/i.test(ua)
    || (ios && !/Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua));
  let name = 'Browser';
  const m = (re: RegExp) => ua.match(re)?.[1];
  if (samsung) name = `Samsung Internet ${m(/SamsungBrowser\/([\d.]+)/) ?? ''}`;
  else if (/EdgA|EdgiOS|Edg\//.test(ua)) name = `Edge ${m(/Edg(?:A|iOS)?\/([\d]+)/) ?? ''}`;
  else if (/CriOS/.test(ua)) name = `Chrome iOS ${m(/CriOS\/([\d]+)/) ?? ''}`;
  else if (firefox) name = `Firefox ${m(/(?:Firefox|FxiOS)\/([\d]+)/) ?? ''}`;
  else if (/Chrome\//.test(ua)) name = `${brave ? 'Brave' : 'Chrome'} ${m(/Chrome\/([\d]+)/) ?? ''}`;
  else if (/Safari\//.test(ua)) name = `Safari ${m(/Version\/([\d.]+)/) ?? ''}`;
  if (inApp) name += ' (in-app)';
  if (android) name += ` Android ${m(/Android ([\d.]+)/) ?? ''}`;
  else if (ios) name += ` iOS ${(m(/OS ([\d_]+) like Mac/) ?? '').replace(/_/g, '.')}`;
  return { ios, android, samsung, inApp, firefox, brave, name: name.replace(/\s+/g, ' ').trim() };
}

export interface ProblemHelp {
  /** For the child: short and kind. */
  text: string;
  /** For a grown-up: what to change on the phone (optional). */
  help?: string;
  /** Show the magic-word chips so there is always something to tap. */
  chips: boolean;
  /** Pressing again will not work this session (the button turns into the magic-words button). */
  block: boolean;
}

/** How to switch the microphone back on, per browser. */
export function allowMicHelp(p: VoicePlatform): string {
  if (p.ios) return 'Grown-ups: tap “aA” in the address bar, then Website Settings, then set Microphone to Allow.';
  if (p.samsung) return 'Grown-ups: tap the lock by the web address, then Permissions, and allow the Microphone.';
  if (p.android) return 'Grown-ups: tap the icon left of the web address, then Permissions, and allow the Microphone.';
  return 'Grown-ups: click the icon left of the web address and allow the Microphone, then reload.';
}

export function problemHelp(problem: HoldProblem, p: VoicePlatform, opts: { repeat?: number } = {}): ProblemHelp {
  const again = (opts.repeat ?? 0) >= 2; // the same problem twice (or more) in a row: say more
  switch (problem) {
    case 'too-short':
      return { text: 'Keep holding me while you talk!', chips: false, block: false };
    case 'permission-pending':
      return { text: 'Tap Allow, then hold me and talk!', help: p.ios ? 'Your iPhone may ask twice: for the microphone and for speech recognition.' : undefined, chips: false, block: false };
    case 'no-speech':
      return again
        ? { text: 'I still can’t hear you. Tap a magic word!', help: p.inApp ? 'Grown-ups: this app’s browser may not pass the microphone on. Open the page in Chrome or Safari.' : 'Grown-ups: speak close to the phone, and check no other app is using the microphone.', chips: true, block: false }
        : { text: 'I didn’t hear anything. Hold me and try again!', chips: false, block: false };
    case 'not-allowed':
      return { text: 'Your microphone is off, so tap a magic word!', help: allowMicHelp(p), chips: true, block: true };
    case 'not-allowed-soft':
      return { text: 'Tap Allow when you’re asked, then hold me again!', chips: true, block: false };
    case 'service-not-allowed':
      if (p.ios) return { text: 'Turn on Siri & Dictation so I can hear you!', help: 'Grown-ups: Settings > General > Keyboard > Enable Dictation (and check Screen Time allows Siri & Dictation), then reload.', chips: true, block: true };
      return { text: 'I can’t listen in this browser. Tap a magic word!', help: p.inApp ? 'Grown-ups: open this page in Chrome or Safari to talk to Happi.' : 'Grown-ups: the browser’s speech service is switched off. Chrome or Safari work best.', chips: true, block: true };
    case 'network':
      return { text: 'I need the internet to hear you!', help: p.brave ? 'Grown-ups: Brave blocks speech recognition. Chrome or Safari work.' : 'Grown-ups: speech recognition runs online. Check Wi-Fi or data, then hold again.', chips: true, block: false };
    case 'audio-capture':
      return { text: 'Another app has the mic. Close it and try again!', help: 'Grown-ups: a call, a voice assistant or a recording app may have the microphone.', chips: true, block: false };
    case 'aborted':
      return { text: 'Oops! Hold me and try again.', help: again ? 'Grown-ups: something else on the phone keeps taking the microphone.' : undefined, chips: again, block: false };
    case 'start-failed':
      return { text: 'Oops! Hold me and try again.', chips: again, block: false };
    case 'unsupported':
      return { text: 'This browser can’t hear you, so tap a magic word!', help: p.firefox ? 'Grown-ups: Firefox has no speech recognition. Chrome or Safari work.' : p.inApp ? 'Grown-ups: open this page in Chrome or Safari to talk to Happi.' : undefined, chips: true, block: true };
    case 'error':
    default:
      return { text: 'Oops! Hold me and try again.', chips: again, block: false };
  }
}

/** Maps a SpeechRecognition `error` code to the problem it means (before the permission check for not-allowed). */
export function problemFromError(code: string): HoldProblem {
  switch (code) {
    case 'no-speech': return 'no-speech';
    case 'not-allowed': return 'not-allowed';
    case 'service-not-allowed': return 'service-not-allowed';
    case 'network': return 'network';
    case 'audio-capture': return 'audio-capture';
    case 'aborted': return 'aborted';
    case 'language-not-supported': return 'unsupported';
    default: return 'error';
  }
}
