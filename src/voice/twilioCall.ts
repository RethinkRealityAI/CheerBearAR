// Twilio Voice SDK wrapper: one Device per page, one Call at a time. Ports the iOS-safe patterns from the old
// src/services/twilioService.ts:
//   - the remote MediaStream is built once per call and cached (no new wrapper per poll: GC pressure on iOS);
//   - no AudioContext of our own. The SDK keeps ONE static AudioContext for its sounds; we hand it the app's shared
//     context (src/audio/context.ts) before the first Device is created, so the page has one context, not two;
//   - on disconnect, stop and close the call's peer connection explicitly (iOS does not always reclaim it);
//   - microphone permission is asked once before connecting (avoids double prompts on iOS);
//   - pagehide / backgrounding with a live call are handled by the session (session.ts).
// The SDK is loaded lazily (dynamic import) so it is not in the first page load.
import type { Call, Device } from '@twilio/voice-sdk';
import { api } from './api';

type SdkModule = typeof import('@twilio/voice-sdk');
let sdkPromise: Promise<SdkModule> | null = null;
const loadSdk = () => (sdkPromise ||= import('@twilio/voice-sdk'));

export interface TwilioCallEvents {
  ringing(): void;
  accepted(): void;
  disconnected(reason: string): void;
  error(message: string, code?: number): void;
  muted(muted: boolean): void;
}

/** Hands the SDK the app's shared AudioContext (its own is a private static, created lazily on first use). */
function shareAudioContext(DeviceClass: unknown, getCtx?: () => AudioContext) {
  if (!getCtx) return;
  try {
    const D = DeviceClass as { _audioContext?: AudioContext };
    if (!D._audioContext) D._audioContext = getCtx();
  } catch (err) {
    console.warn('[voice] could not share the AudioContext with the Twilio SDK (it will create its own):', err);
  }
}

export class TwilioCaller {
  private device: Device | null = null;
  private call: Call | null = null;
  private remote: MediaStream | null = null;

  constructor(private getAudioContext?: () => AudioContext) {}

  get active(): Call | null {
    return this.call;
  }

  private async fetchToken(): Promise<string> {
    const { token } = await api<{ token: string }>('/api/token', { timeoutMs: 10_000 });
    return token;
  }

  /** Creates (once) and returns the Device. Throws ApiError('not_configured') when Twilio is not set up. */
  async ensureDevice(): Promise<Device> {
    const token = await this.fetchToken();
    const sdk = await loadSdk();
    if (this.device) {
      this.device.updateToken(token);
      return this.device;
    }
    shareAudioContext(sdk.Device, this.getAudioContext);
    const device = new sdk.Device(token, {
      logLevel: 'warn',
      codecPreferences: [sdk.Call.Codec.Opus, sdk.Call.Codec.PCMU],
      closeProtection: false,
      tokenRefreshMs: 60_000,
    });
    device.on('tokenWillExpire', async () => {
      try {
        device.updateToken(await this.fetchToken());
      } catch (err) {
        console.warn('[voice] token refresh failed:', err);
      }
    });
    device.on('error', (err: { message?: string; code?: number }) => console.warn('[voice] Twilio device error:', err?.code, err?.message));
    // Outgoing calls do not need device.register() (that is only for receiving calls).
    this.device = device;
    return device;
  }

  async connect(to: string | undefined, on: TwilioCallEvents): Promise<void> {
    const device = await this.ensureDevice();
    const call = await device.connect({ params: to ? { To: to } : {} });
    this.call = call;
    this.remote = null;
    call.on('ringing', () => on.ringing());
    call.on('accept', () => on.accepted());
    call.on('mute', (m: boolean) => on.muted(m));
    const ended = (reason: string) => {
      if (this.call !== call) return;
      this.releaseCallResources();
      on.disconnected(reason);
    };
    call.on('disconnect', () => ended('disconnected'));
    call.on('cancel', () => ended('cancelled'));
    call.on('reject', () => ended('rejected'));
    call.on('error', (err: { message?: string; code?: number }) => {
      on.error(err?.message || 'Call error', err?.code);
    });
  }

  /** Cheer Bear's side of the call, cached for the life of the call. */
  getRemoteStream(): MediaStream | null {
    const call = this.call;
    if (!call) return null;
    if (this.remote && this.remote.getAudioTracks().some((t) => t.readyState === 'live')) return this.remote;
    let stream: MediaStream | null = call.getRemoteStream?.() ?? null;
    if (!stream || !stream.getAudioTracks().length) {
      const pc = peerConnection(call);
      if (pc) {
        const tracks = pc.getReceivers().map((r) => r.track).filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
        stream = tracks.length ? new MediaStream(tracks) : null;
      }
    }
    this.remote = stream && stream.getAudioTracks().length ? stream : null;
    return this.remote;
  }

  /** The user's microphone as sent on the call (for optional user transcription). */
  getLocalStream(): MediaStream | null {
    return this.call?.getLocalStream?.() ?? null;
  }

  setMuted(muted: boolean) {
    this.call?.mute(muted);
  }

  isMuted(): boolean {
    return !!this.call?.isMuted();
  }

  disconnect() {
    const call = this.call;
    if (!call) return;
    try {
      call.disconnect();
    } catch (err) {
      console.warn('[voice] disconnect failed:', err);
    }
    this.releaseCallResources();
  }

  private releaseCallResources() {
    const call = this.call;
    this.call = null;
    this.remote = null;
    if (!call) return;
    try {
      const pc = peerConnection(call);
      if (pc && pc.signalingState !== 'closed') {
        pc.getSenders().forEach((s) => {
          try {
            s.track?.stop();
          } catch {
            /* ignore */
          }
        });
        pc.getReceivers().forEach((r) => {
          try {
            r.track?.stop();
          } catch {
            /* ignore */
          }
        });
        pc.close();
      }
    } catch (err) {
      console.warn('[voice] closing the call peer connection failed:', err);
    }
  }

  destroy() {
    this.disconnect();
    try {
      this.device?.destroy();
    } catch {
      /* ignore */
    }
    this.device = null;
  }
}

/** The SDK does not expose the RTCPeerConnection publicly; these are the internal names it has used. */
function peerConnection(call: Call): RTCPeerConnection | null {
  const c = call as unknown as { _mediaHandler?: { version?: { pc?: RTCPeerConnection } }; _peerConnection?: RTCPeerConnection; peerConnection?: RTCPeerConnection };
  return c._mediaHandler?.version?.pc ?? c._peerConnection ?? c.peerConnection ?? null;
}
