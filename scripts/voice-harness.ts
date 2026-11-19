// Browser harness for scripts/check-voice-browser.ts (served by Vite at /__voice-harness). Not part of the app.
// Records every voice event in window.__log and measures the remote stream's loudness (what lip sync would see).
import { configClient, createVoiceSession, type VoiceStatusEvent } from '../src/voice/index';
import { RealtimeTranscriber } from '../src/voice/transcriber';
import { getAudioContext, unlockAudio } from '../src/audio/context';

type Entry = Record<string, unknown> & { t: string; at: number };
const log: Entry[] = [];
const levels: number[] = [];
const w = window as unknown as Record<string, unknown>;
w.__log = log;
w.__levels = levels;
w.__ready = false;

const push = (t: string, data: Record<string, unknown>) => log.push({ t, at: Math.round(performance.now()), ...data });

await configClient.load();
const mode = (new URLSearchParams(location.search).get('mode') || 'url') as 'url' | 'auto' | 'always' | 'never';
const session = createVoiceSession({ getConfig: () => configClient.current, mock: mode, endCallWhenHidden: false });
w.__session = session;
w.__services = configClient.services;

session.on('status', (e) => push('status', { ...(e as VoiceStatusEvent) }));
session.on('transcript', (e) => push('transcript', { ...e }));
session.on('trigger', (e) => push('trigger', { ...e }));
session.on('transcription', (e) => push('transcription', { ...e }));
session.on('muted', (m) => push('muted', { muted: m }));

let meter: ReturnType<typeof setInterval> | null = null;
session.on('remoteStream', (stream) => {
  push('remoteStream', { present: !!stream, tracks: stream?.getAudioTracks().length ?? 0 });
  if (meter) clearInterval(meter);
  meter = null;
  if (!stream) return;
  const ctx = getAudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  meter = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    levels.push(Math.sqrt(sum / buf.length));
  }, 100);
});

const start = document.createElement('button');
start.id = 'start';
start.textContent = 'Call';
start.onclick = () => {
  unlockAudio();
  void session.startCall();
};
document.body.append(start);

/** Loopback test of the OpenAI WebRTC transcriber (the "OpenAI" side is faked by the test runner). */
w.__runTranscriber = async () => {
  unlockAudio();
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const out: Array<{ itemId: string; text: string; final: boolean }> = [];
  const states: string[] = [];
  const t = new RealtimeTranscriber({
    speaker: 'cheer_bear',
    track: mic.getAudioTracks()[0],
    getAudioContext,
    onTranscript: (itemId, text, final) => out.push({ itemId, text, final }),
    onState: (s, m) => states.push(m ? `${s}:${m}` : s),
  });
  t.start();
  w.__transcriber = { out, states, stop: () => t.stop(), track: mic.getAudioTracks()[0] };
};

w.__ready = true;
