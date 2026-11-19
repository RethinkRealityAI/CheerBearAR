// The ONLY place src/voice touches Web Audio: the demo call's "Cheer Bear" voice. It uses the app's shared
// AudioContext (src/audio/context.ts, owned by bear-lipsync) and never creates one.
// A bundled speech sample (public/media/voice/mock-cheer-bear.wav) is looped for each scripted line into a
// MediaStreamDestination; that stream is what the app gets as `remoteStream`, so lip sync runs exactly as on a call.
import { getAudioContext } from '../audio/context';

export const MOCK_SAMPLE_URL = '/media/voice/mock-cheer-bear.wav';

export interface MockVoiceAudio {
  readonly stream: MediaStream;
  /** Play speech for `ms` milliseconds. */
  speak(ms: number): void;
  silence(): void;
  dispose(): void;
}

let bufferPromise: Promise<AudioBuffer> | null = null;

export async function createMockVoiceAudio(opts: { audible: boolean; url?: string }): Promise<MockVoiceAudio | null> {
  let ctx: AudioContext;
  try {
    ctx = getAudioContext();
  } catch (err) {
    console.warn('[voice] demo call: no Web Audio, transcripts only:', err);
    return null;
  }
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  try {
    bufferPromise ||= fetch(opts.url || MOCK_SAMPLE_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`sample ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data));
    const buffer = await bufferPromise;
    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(dest);
    if (opts.audible) gain.connect(ctx.destination);
    let current: AudioBufferSourceNode | null = null;
    const stopCurrent = () => {
      try {
        current?.stop();
        current?.disconnect();
      } catch {
        /* ignore */
      }
      current = null;
    };
    return {
      stream: dest.stream,
      speak(ms: number) {
        stopCurrent();
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        src.stop(ctx.currentTime + ms / 1000);
        current = src;
      },
      silence: stopCurrent,
      dispose() {
        stopCurrent();
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
        dest.stream.getTracks().forEach((t) => t.stop());
      },
    };
  } catch (err) {
    bufferPromise = null;
    console.warn('[voice] demo call: could not load the sample voice, transcripts only:', err);
    return null;
  }
}
