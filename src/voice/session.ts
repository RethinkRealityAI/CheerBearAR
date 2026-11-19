// createVoiceSession: the call, browser transcription and trigger dispatch behind the VoiceSession contract.
//
//   startCall()  -> GET /api/token -> Twilio Device.connect (our TwiML app dials Cheer Bear's number)
//                -> on answer: emit remoteStream (for lip sync), start OpenAI transcription of Cheer Bear's audio
//                   (and of the user's mic only when allowUserAudioToOpenAI) -> transcript events
//                -> TriggerPipeline -> trigger events (cooldown, dedupe, dispatch interval, AI fallback)
//   demo mode    -> MockCall: rings, Cheer Bear greets once, then answers what the child says (browser speech
//                   recognition) or types; her side is DemoBear (local/AI brain + browser voice + text-driven mouth
//                   shapes on `visemes`). Her words go through the same pipeline, so moments fire from what she says.
//   typed chat with no call live -> DemoBear answers too (config.demoVoice.speakTypedChatOutsideCall).
import type { AppConfig } from '../shared/config';
import type { CallStatus, Speaker, TranscriptEvent, TriggerEvent, VoiceEvents, VoiceSession } from '../shared/contracts';
import { extractKeywordMatches, sanitizeEnglishText } from '../shared/classifier';
import { getAudioContext } from '../audio/context';
import { api, ApiError } from './api';
import { Emitter } from './emitter';
import { DemoBear } from './demoBear';
import { MockCall, mockFlagsFromUrl, type MockFlags } from './mock';
import type { SpeechInputState } from './speechInput';
import { RealtimeTranscriber } from './transcriber';
import { TriggerPipeline } from './triggerPipeline';
import { TwilioCaller } from './twilioCall';
import { VoiceMode, type VoiceModeApi } from './voiceMode';

export type VoiceStatusCode = 'not_configured' | 'mic_denied' | 'token_failed' | 'call_failed' | 'demo';

/** Payload actually emitted on `status` (the contract's fields plus a machine-readable code). */
export interface VoiceStatusEvent {
  status: CallStatus;
  message?: string;
  code?: VoiceStatusCode;
  /** True while the current call is the demo (mock) call. */
  mock?: boolean;
}

export interface CreateVoiceSessionOptions {
  getConfig(): AppConfig;
  /**
   * Demo call:
   *   'url' (default) -> only with ?mockVoice in the page URL or startCall({ mock: true })
   *   'auto'          -> also when the server says Twilio is not configured
   *   'always'        -> every call is the demo; 'never' -> never (ignores ?mockVoice)
   */
  mock?: 'url' | 'auto' | 'always' | 'never';
  /** Old iOS-safe behaviour: end the call when the page is hidden (app switch, lock). Default true. */
  endCallWhenHidden?: boolean;
}

/** VoiceSession plus extras (not in the contract yet; see docs/handoff/server-voice.md). */
export interface VoiceSessionExt extends VoiceSession {
  startCall(opts?: { to?: string; mock?: boolean }): Promise<void>;
  readonly isMock: boolean;
  /** `replied`: the demo Cheer Bear will answer this message out loud (demo call, or no call live). */
  sendText(text: string): Promise<{ triggers: string[]; smsSent: boolean; replied: boolean }>;
  readonly transcriptionState: Record<Speaker, VoiceEvents['transcription']['state']>;
  /** Voice mode (hold to talk, no call): created on first use. See voiceMode.ts and docs/handoff/voice-3.md. */
  readonly voiceMode: VoiceModeApi;
  // `status` payloads are VoiceStatusEvent at runtime (extra `code` and `mock`): `(e as VoiceStatusEvent).code`.
}

const MAX_TEXT = 1600;

export function createVoiceSession(options: CreateVoiceSessionOptions): VoiceSessionExt {
  return new VoiceSessionImpl(options);
}

class VoiceSessionImpl implements VoiceSessionExt {
  private events = new Emitter<VoiceEvents>();
  private _status: CallStatus = 'idle';
  private _muted = false;
  private caller: TwilioCaller | null = null;
  private mockCall: MockCall | null = null;
  private transcribers: Partial<Record<Speaker, RealtimeTranscriber>> = {};
  private pipeline: TriggerPipeline;
  private remote: MediaStream | null = null;
  private callSeq = 0;
  private disposed = false;
  private mockFlags: MockFlags;
  private bear: DemoBear | null = null;
  /** A "can't listen, type instead" message from before the demo call connected (shown once it has). */
  private listenNotice: string | null = null;
  private _voiceMode: VoiceMode | null = null;
  transcriptionState: Record<Speaker, VoiceEvents['transcription']['state']> = { cheer_bear: 'off', user: 'off' };

  constructor(private opts: CreateVoiceSessionOptions) {
    const url = mockFlagsFromUrl();
    const mode = opts.mock ?? 'url';
    this.mockFlags = { ...url, enabled: mode === 'always' || (mode !== 'never' && url.enabled) };
    this.pipeline = new TriggerPipeline({
      getConfig: () => this.opts.getConfig(),
      classifyWithAI: (text, keywords) => this.classifyWithAI(text, keywords),
      emit: (t: TriggerEvent) => this.events.emit('trigger', t),
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get status(): CallStatus {
    return this._status;
  }
  get muted(): boolean {
    return this._muted;
  }
  get isMock(): boolean {
    return !!this.mockCall;
  }

  on<K extends keyof VoiceEvents>(event: K, cb: (payload: VoiceEvents[K]) => void): () => void {
    return this.events.on(event, cb);
  }

  private setStatus(status: CallStatus, extra: Omit<VoiceStatusEvent, 'status'> = {}) {
    this._status = status;
    this.events.emit('status', { status, ...extra, mock: extra.mock ?? !!this.mockCall } as VoiceEvents['status']);
  }

  private setRemote(stream: MediaStream | null) {
    if (this.remote === stream) return;
    this.remote = stream;
    this.events.emit('remoteStream', stream);
  }

  private setTranscription(speaker: Speaker, state: VoiceEvents['transcription']['state'], message?: string) {
    this.transcriptionState[speaker] = state;
    this.events.emit('transcription', { speaker, state, message });
  }

  // ---------------------------------------------------------------- call lifecycle

  async startCall(opts: { to?: string; mock?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (this._status !== 'idle' && this._status !== 'error') return; // double tap
    const seq = ++this.callSeq;
    if (opts.mock || this.mockFlags.enabled) return this.startMock(seq);
    this.bear?.cancel(); // a demo chat answer still playing gives way to the real call

    this.setStatus('connecting', { message: 'Calling Cheer Bear…' });
    // Ask for the microphone once, up front (one prompt on iOS instead of two), then release it: the SDK opens its own.
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
    } catch (err) {
      if (seq !== this.callSeq) return;
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.setStatus('error', { code: 'mic_denied', message: 'Cheer Bear needs your microphone to hear you. Allow it and try again.' });
        return;
      }
      console.warn('[voice] microphone pre-check failed, continuing:', err);
    }
    if (seq !== this.callSeq) return;

    this.caller ||= new TwilioCaller(safeAudioContext);
    try {
      await this.caller.connect(opts.to?.trim() || undefined, {
        ringing: () => seq === this.callSeq && this._status === 'connecting' && this.setStatus('ringing', { message: 'Ringing…' }),
        accepted: () => seq === this.callSeq && this.onAccepted(seq),
        muted: (m) => {
          this._muted = m;
          this.events.emit('muted', m);
        },
        disconnected: () => seq === this.callSeq && this.finishCall('Call ended.'),
        error: (message, code) => {
          console.warn('[voice] call error:', code, message);
          if (seq === this.callSeq && (this._status === 'connecting' || this._status === 'ringing')) {
            this.teardown();
            this.setStatus('error', { code: 'call_failed', message: 'The call could not connect. Please try again.' });
          }
        },
      });
    } catch (err) {
      if (seq !== this.callSeq) return;
      if (err instanceof ApiError && err.code === 'not_configured') {
        if (this.opts.mock === 'auto') return this.startMock(seq, 'Calling is not set up here, so this is a demo call.');
        this.setStatus('error', { code: 'not_configured', message: 'Calling is not set up on this site yet.' });
        return;
      }
      console.error('[voice] could not start the call:', err);
      this.teardown();
      const tokenFailed = err instanceof ApiError;
      this.setStatus('error', {
        code: tokenFailed ? 'token_failed' : 'call_failed',
        message: tokenFailed ? 'Could not reach the call service. Please try again.' : 'The call could not connect. Please try again.',
      });
    }
  }

  private async onAccepted(seq: number) {
    this.setStatus('in-call', { message: 'Connected' });
    // The remote track can appear a moment after `accept`.
    let stream: MediaStream | null = null;
    for (let i = 0; i < 25 && seq === this.callSeq && !stream; i += 1) {
      stream = this.caller?.getRemoteStream() ?? null;
      if (!stream) await sleep(200);
    }
    if (seq !== this.callSeq || this._status !== 'in-call') return;
    this.setRemote(stream);
    const remoteTrack = stream?.getAudioTracks()[0];
    if (remoteTrack) this.startTranscriber('cheer_bear', remoteTrack);
    else this.setTranscription('cheer_bear', 'error', 'No audio from the call.');
    if (this.opts.getConfig().allowUserAudioToOpenAI) {
      const mic = this.caller?.getLocalStream()?.getAudioTracks()[0];
      if (mic) this.startTranscriber('user', mic);
    }
  }

  private startTranscriber(speaker: Speaker, track: MediaStreamTrack) {
    this.transcribers[speaker]?.stop();
    const t = new RealtimeTranscriber({
      speaker,
      track,
      getAudioContext: safeAudioContext,
      onState: (state, message) => this.setTranscription(speaker, state, message),
      onTranscript: (itemId, text, final) => this.onTranscript(speaker, `${speaker}:${itemId}`, text, final),
    });
    this.transcribers[speaker] = t;
    t.start();
  }

  /** Cheer Bear's demo side (brain + browser voice + mouth), shared by the demo call and typed chat. */
  private demoBear(): DemoBear {
    this.bear ||= new DemoBear({
      getConfig: () => this.opts.getConfig(),
      flags: this.mockFlags,
      onTranscript: (id, text, final, chat) => !this.disposed && this.onTranscript('cheer_bear', id, text, final, chat),
      onVisemes: (frame) => !this.disposed && this.events.emit('visemes', frame),
      claim: (id, keywords) => this.pipeline.claim(id, keywords),
    });
    return this.bear;
  }

  /** Keywords the child's own words fire (only when user triggers are allowed). */
  private userKeywords(text: string): string[] {
    const cfg = this.opts.getConfig();
    if (!cfg.allowUserTriggers) return [];
    const clean = cfg.englishOnlyTranscripts ? sanitizeEnglishText(text) : text;
    return extractKeywordMatches(clean, cfg.localClassifier);
  }

  private startMock(seq: number, message?: string) {
    this.setStatus('connecting', { message: message ?? 'Calling Cheer Bear (demo)…', code: 'demo', mock: true });
    this.listenNotice = null;
    const bear = this.demoBear();
    bear.cancel(); // a chat answer still playing gives way to the call
    const call = new MockCall(this.mockFlags, bear, {
      ringing: () => seq === this.callSeq && this.setStatus('ringing', { message: 'Ringing…', code: 'demo', mock: true }),
      accepted: () => {
        if (seq !== this.callSeq) return;
        this.setStatus('in-call', { message: 'Connected (demo call)', code: 'demo', mock: true });
        this.setTranscription('cheer_bear', 'live', bear.voice.supported ? 'Demo: browser voice' : 'Demo: no browser voice, words only');
        if (this.listenNotice) this.setStatus('in-call', { message: this.listenNotice, code: 'demo', mock: true });
        this.listenNotice = null;
      },
      userTranscript: (id, text, final) => seq === this.callSeq && this.onTranscript('user', id, text, final),
      userKeywords: (text) => this.userKeywords(text),
      listening: (state, msg) => seq === this.callSeq && this.onListening(state, msg),
    });
    this.mockCall = call;
    call.start(); // synchronous part runs inside the tap (speech + recognition unlock)
  }

  /** The demo call's speech recognition state -> transcription state (debug view) and a status message. */
  private onListening(state: SpeechInputState, message?: string) {
    const map: Record<SpeechInputState, VoiceEvents['transcription']['state']> = {
      off: 'off', starting: 'connecting', live: 'live', paused: 'off', unsupported: 'error', denied: 'error', error: 'error',
    };
    this.setTranscription('user', map[state], message ?? (state === 'live' ? 'Demo: browser speech recognition' : undefined));
    if (message && (state === 'unsupported' || state === 'denied' || state === 'error') && this.mockCall) {
      // The call goes on (type instead); the app shows the message once the call is connected.
      if (this._status === 'in-call') this.setStatus('in-call', { message, code: 'demo', mock: true });
      else this.listenNotice = message;
    }
  }

  private onTranscript(speaker: Speaker, id: string, raw: string, final: boolean, chat = false) {
    const config = this.opts.getConfig();
    const text = config.englishOnlyTranscripts ? sanitizeEnglishText(raw) : raw.trim();
    const evt: TranscriptEvent = { id, speaker, text, final, at: Date.now() };
    if (chat) evt.chat = true;
    if (text) this.events.emit('transcript', evt);
    void this.pipeline.handleTranscript(evt);
    if (final && text && speaker === 'user' && config.smsPolicy.sendSpeechToSms && !this.mockCall) void this.sendSms(text);
  }

  async endCall(): Promise<void> {
    if (this._status === 'idle' || this._status === 'ending') return;
    this.setStatus('ending');
    this.finishCall('Call ended.');
  }

  /** Stops everything for the current call and goes back to idle. */
  private finishCall(message: string) {
    const wasMock = !!this.mockCall;
    this.callSeq += 1; // late callbacks from the old call are ignored
    this.teardown();
    this.setStatus('idle', { message, mock: wasMock });
  }

  private teardown() {
    for (const t of Object.values(this.transcribers)) t?.stop();
    this.transcribers = {};
    for (const s of ['cheer_bear', 'user'] as const) if (this.transcriptionState[s] !== 'off') this.setTranscription(s, 'off');
    this.mockCall?.stop();
    this.mockCall = null;
    this.caller?.disconnect();
    this.setRemote(null);
    this.pipeline.endOfCall();
    if (this._muted) {
      this._muted = false;
      this.events.emit('muted', false);
    }
  }

  setMuted(muted: boolean): void {
    if (this.mockCall) {
      if (this._muted !== muted) {
        this._muted = muted;
        this.mockCall.setMuted(muted);
        this.events.emit('muted', muted);
      }
      return;
    }
    if (!this.caller?.active) return;
    this.caller.setMuted(muted); // the SDK's 'mute' event updates state and emits
  }

  // ---------------------------------------------------------------- text + manual triggers

  /**
   * Typed chat. Real call: to Cheer Bear by SMS (smsPolicy) as before. Demo call: the demo Cheer Bear answers out
   * loud. No call live: she answers too when config.demoVoice.speakTypedChatOutsideCall. `replied` says she will.
   */
  async sendText(text: string): Promise<{ triggers: string[]; smsSent: boolean; replied: boolean }> {
    const clean = String(text || '').trim().slice(0, MAX_TEXT);
    if (!clean || this.disposed) return { triggers: [], smsSent: false, replied: false };
    const config = this.opts.getConfig();
    const noCall = this._status === 'idle' || this._status === 'error';
    const demoAnswers = !!this.mockCall || (noCall && config.demoVoice.speakTypedChatOutsideCall);
    if (demoAnswers) this.demoBear().unlock(); // still inside the tap/keypress (iOS speech unlock)
    const triggers = await this.pipeline.classifyTyped(clean);
    let smsSent = false;
    let replied = false;
    if (this.mockCall) {
      this.mockCall.userTyped(clean, triggers);
      replied = true;
    } else if (this._status === 'in-call') {
      if (config.smsPolicy.sendTypedChatToSms) smsSent = await this.sendSms(clean);
    } else if (demoAnswers && (this._status === 'idle' || this._status === 'error')) {
      void this.demoBear().answer(clean, { chat: true, claimed: triggers });
      replied = true;
    }
    return { triggers, smsSent, replied };
  }

  fireTrigger(keyword: string, speaker: TriggerEvent['speaker'] = 'quick-action'): void {
    this.pipeline.fire(keyword, speaker);
  }

  /**
   * Voice mode: what the child says while holding the talk button. Trigger words go through the same pipeline as a
   * call (speaker 'user', via 'local': cooldown, dispatch spacing, the app's game rules). Her canned answers are
   * DemoBear lines that claim every keyword, so they never fire a moment.
   */
  get voiceMode(): VoiceModeApi {
    this._voiceMode ||= new VoiceMode({
      getConfig: () => this.opts.getConfig(),
      fireTrigger: (keyword) => !this.disposed && this.pipeline.fire(keyword, 'user', 'local'),
      say: (line) => {
        if (this.disposed || (this._status !== 'idle' && this._status !== 'error')) return; // a call owns her voice
        void this.demoBear().say(line, { chat: true, claimed: [...this.opts.getConfig().localClassifier.keywords] });
      },
      hush: () => this.bear?.cancel(),
      unlock: () => this.demoBear().unlock(),
    });
    return this._voiceMode;
  }

  private async sendSms(message: string): Promise<boolean> {
    try {
      await api('/api/sms', { body: { message: message.slice(0, MAX_TEXT) } });
      return true;
    } catch (err) {
      console.warn('[voice] SMS bridge failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async classifyWithAI(text: string, keywords: string[]): Promise<string[]> {
    try {
      const res = await api<{ intents: string[] }>('/api/intent', { body: { text: text.slice(0, 2000), keywords }, timeoutMs: 8000 });
      return Array.isArray(res.intents) ? res.intents : [];
    } catch (err) {
      console.warn('[voice] intent fallback failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // ---------------------------------------------------------------- page lifecycle (iOS)

  private onPageHide = () => this.dispose();

  private onVisibility = () => {
    if (document.visibilityState !== 'hidden') return;
    if ((this.opts.endCallWhenHidden ?? true) && this._status !== 'idle' && this._status !== 'error') {
      console.log('[voice] page hidden during a call: ending it to free audio resources');
      void this.endCall();
    }
  };

  dispose(): void {
    if (this.disposed) return;
    if (this._status !== 'idle' && this._status !== 'error') this.finishCall('Call ended.');
    this.disposed = true;
    this.callSeq += 1;
    this.pipeline.dispose();
    this._voiceMode?.dispose();
    this._voiceMode = null;
    this.bear?.dispose();
    this.bear = null;
    this.caller?.destroy();
    this.caller = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.events.clear();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeAudioContext(): AudioContext {
  return getAudioContext();
}
