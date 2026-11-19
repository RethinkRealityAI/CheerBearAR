// Browser -> OpenAI Realtime transcription over WebRTC (GA API).
//   1. POST /api/realtime-session { speaker } -> short-lived client secret (our function holds the API key).
//   2. RTCPeerConnection with ONE outgoing audio track (Happi's remote call audio, or the user's microphone),
//      data channel "oai-events", SDP offer POSTed to https://api.openai.com/v1/realtime/calls with the secret.
//   3. Events on the data channel:
//        conversation.item.input_audio_transcription.delta     { item_id, delta }      -> partial
//        conversation.item.input_audio_transcription.completed { item_id, transcript } -> final
//   4. Models without server VAD (gpt-live-transcribe): we commit turns ourselves (input_audio_buffer.commit) after a
//      short silence, using the sender's audio level from getStats() (no extra AudioContext).
// Reconnects with backoff while the call is live; stop() tears everything down without stopping the call's track.
import type { Speaker } from '../shared/contracts';
import { api, ApiError } from './api';

export type TranscriberState = 'off' | 'connecting' | 'live' | 'error';

interface SessionSecret {
  clientSecret: string;
  expiresAt: number;
  model: string;
  commit: 'server' | 'client';
  callsUrl: string;
}

export interface TranscriberOptions {
  speaker: Speaker;
  track: MediaStreamTrack;
  onTranscript(itemId: string, text: string, final: boolean): void;
  onState(state: TranscriberState, message?: string): void;
  /** Only used when a browser refuses to send a remote track directly (see `sendableTrack`). */
  getAudioContext?: () => AudioContext;
}

const MAX_ATTEMPTS = 6;
const SPEECH_LEVEL = 0.02; // RTCStats audioLevel (0..1, linear); ~ -34 dBFS
const SILENCE_COMMIT_MS = 700;
const MAX_TURN_MS = 12_000;

export class RealtimeTranscriber {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stopped = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private liveSince = 0;
  private buffers = new Map<string, string>();
  private bridge: { src: MediaStreamAudioSourceNode; dest: MediaStreamAudioDestinationNode } | null = null;
  state: TranscriberState = 'off';

  constructor(private opts: TranscriberOptions) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  private setState(state: TranscriberState, message?: string) {
    this.state = state;
    this.opts.onState(state, message);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.cleanupConnection();
    this.setState('connecting');
    let secret: SessionSecret;
    try {
      secret = await api<SessionSecret>('/api/realtime-session', { body: { speaker: this.opts.speaker }, timeoutMs: 15_000 });
    } catch (err) {
      if (err instanceof ApiError && [403, 503].includes(err.status)) {
        // Not configured / not allowed: no point retrying.
        this.setState(err.code === 'not_configured' ? 'off' : 'error', err.message);
        this.stopped = true;
        return;
      }
      return this.retry(err instanceof Error ? err.message : 'Could not start transcription.');
    }
    if (this.stopped) return;

    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;
      const track = this.sendableTrack(pc);
      if (!track) throw new Error('No audio to transcribe.');
      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onmessage = (e) => this.onEvent(e.data);
      dc.onclose = () => {
        if (!this.stopped && this.dc === dc) this.retry('Transcription connection closed.');
      };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc || this.stopped) return;
        if (pc.connectionState === 'failed') this.retry('Transcription connection failed.');
        else if (pc.connectionState === 'disconnected') {
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => {
            if (this.pc === pc && pc.connectionState !== 'connected') this.retry('Transcription connection lost.');
          }, 4000);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(secret.callsUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${secret.clientSecret}`, 'Content-Type': 'application/sdp' },
      });
      if (!res.ok) throw new Error(`OpenAI refused the connection (${res.status}).`);
      const answer = await res.text();
      if (this.stopped || this.pc !== pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      await waitForOpen(dc, 10_000);
      if (this.stopped || this.pc !== pc) return;
      this.liveSince = Date.now();
      this.setState('live');
      if (secret.commit === 'client') this.startClientCommit(pc, dc);
    } catch (err) {
      this.retry(err instanceof Error ? err.message : 'Transcription failed to connect.');
    }
  }

  /**
   * The track to send. Browsers can forward a remote WebRTC track into another peer connection directly; if one
   * refuses, route it through the shared AudioContext (MediaStreamSource -> MediaStreamDestination).
   */
  private sendableTrack(pc: RTCPeerConnection): MediaStreamTrack | null {
    const { track } = this.opts;
    if (track.readyState !== 'live') return null;
    try {
      pc.addTrack(track, new MediaStream([track]));
      return track;
    } catch (err) {
      if (!this.opts.getAudioContext) throw err;
      const ctx = this.opts.getAudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      this.bridge = { src, dest };
      const t = dest.stream.getAudioTracks()[0];
      pc.addTrack(t, dest.stream);
      return t;
    }
  }

  private onEvent(raw: unknown) {
    if (typeof raw !== 'string') return;
    let ev: { type?: string; item_id?: string; delta?: string; transcript?: string; error?: { message?: string; code?: string } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'conversation.item.input_audio_transcription.delta': {
        if (!ev.item_id || typeof ev.delta !== 'string') return;
        const text = (this.buffers.get(ev.item_id) || '') + ev.delta;
        this.buffers.set(ev.item_id, text);
        this.opts.onTranscript(ev.item_id, text, false);
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        if (!ev.item_id) return;
        const text = typeof ev.transcript === 'string' ? ev.transcript : this.buffers.get(ev.item_id) || '';
        this.buffers.delete(ev.item_id);
        this.opts.onTranscript(ev.item_id, text, true);
        if (this.buffers.size > 50) this.buffers.clear();
        return;
      }
      case 'conversation.item.input_audio_transcription.failed':
        if (ev.item_id) this.buffers.delete(ev.item_id);
        console.warn(`[voice] transcription of one turn failed (${this.opts.speaker}):`, ev.error?.message);
        return;
      case 'error':
        console.warn(`[voice] OpenAI realtime error (${this.opts.speaker}):`, ev.error?.code, ev.error?.message);
        return;
      default:
    }
  }

  /** Client-side turn detection from the sender's audioLevel (RTCStats), for models without server VAD. */
  private startClientCommit(pc: RTCPeerConnection, dc: RTCDataChannel) {
    let speaking = false;
    let turnStart = 0;
    let lastVoice = 0;
    let lastCommit = Date.now();
    let levelSeen = false;
    const commit = () => {
      if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      speaking = false;
      lastCommit = Date.now();
    };
    this.vadTimer = setInterval(async () => {
      if (this.pc !== pc || dc.readyState !== 'open') return;
      let level: number | null = null;
      try {
        const stats = await pc.getStats();
        stats.forEach((r) => {
          const rep = r as { type?: string; kind?: string; audioLevel?: number };
          if (rep.type === 'media-source' && rep.kind === 'audio' && typeof rep.audioLevel === 'number') level = rep.audioLevel;
        });
      } catch {
        /* ignore */
      }
      const now = Date.now();
      if (level === null) {
        if (!levelSeen && now - lastCommit > 5000) commit(); // no level info: commit on a timer
        return;
      }
      levelSeen = true;
      if (level > SPEECH_LEVEL) {
        if (!speaking) turnStart = now;
        speaking = true;
        lastVoice = now;
        if (now - turnStart > MAX_TURN_MS) commit();
      } else if (speaking && now - lastVoice > SILENCE_COMMIT_MS) commit();
    }, 150);
  }

  private retry(message: string) {
    if (this.stopped || this.retryTimer) return;
    this.cleanupConnection();
    if (this.liveSince && Date.now() - this.liveSince > 30_000) this.attempts = 0; // it was working for a while
    this.liveSince = 0;
    this.attempts += 1;
    if (this.attempts > MAX_ATTEMPTS) {
      this.setState('error', message);
      return;
    }
    const delay = Math.min(1000 * 2 ** (this.attempts - 1), 15_000);
    console.warn(`[voice] transcription (${this.opts.speaker}) reconnecting in ${delay} ms: ${message}`);
    this.setState('connecting', message);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private cleanupConnection() {
    if (this.vadTimer) clearInterval(this.vadTimer);
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.vadTimer = null;
    this.disconnectTimer = null;
    const dc = this.dc;
    const pc = this.pc;
    this.dc = null;
    this.pc = null;
    try {
      dc?.close();
    } catch {
      /* ignore */
    }
    try {
      // Never stop the call's own track here; only our peer connection goes.
      pc?.close();
    } catch {
      /* ignore */
    }
    if (this.bridge) {
      try {
        this.bridge.src.disconnect();
        this.bridge.dest.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      this.bridge = null;
    }
    this.buffers.clear();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.cleanupConnection();
    if (this.state !== 'off') this.setState('off');
  }
}

function waitForOpen(dc: RTCDataChannel, timeoutMs: number): Promise<void> {
  if (dc.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Transcription channel did not open.')), timeoutMs);
    dc.addEventListener('open', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
    dc.addEventListener('close', () => {
      clearTimeout(t);
      reject(new Error('Transcription channel closed.'));
    }, { once: true });
  });
}
