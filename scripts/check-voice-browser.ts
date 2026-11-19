// @ts-nocheck -- test runner: Playwright is a global, untyped install here; run with tsx (no typecheck).
// Headless Chromium checks for src/voice (no Twilio / OpenAI accounts):
//   1. Demo call (?mockVoice) with faked speechSynthesis + speech recognition: rings, greets once and waits; typed and
//      spoken turns get spoken answers; her words stream as transcripts with mouth shapes (visemes); "can you dance"
//      fires Dance once from what she says, small talk fires nothing; mute / endCall; typed chat with no call; the AI
//      brain through /api/chat against a fake OpenAI.
//   2. Real mode with Twilio not configured: a clear 'not_configured' error, no crash; mode 'auto' falls back to demo.
//   3. The OpenAI WebRTC transcriber end to end against a fake "OpenAI" peer (a second page answers the SDP offer and
//      sends transcription events on the oai-events data channel), plus the real /api/realtime-session function.
// Run: npx tsx scripts/check-voice-browser.ts   (uses the pre-installed Playwright + Chromium)
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Playwright is pre-installed globally (not a project dependency), so it is loaded untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require('playwright') as { chromium: any };

// ---- fake OpenAI REST (client_secrets) for the /api/realtime-session function
const chatLog: string[] = [];
const fakeOpenAI = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/realtime/client_secrets') return res.end(JSON.stringify({ value: 'ek_browser_test', expires_at: 1900000000 }));
  if (req.url === '/v1/moderations') {
    chatLog.push(req.url);
    return res.end(JSON.stringify({ results: [{ flagged: false }] }));
  }
  if (req.url === '/v1/chat/completions') {
    chatLog.push(req.url);
    return res.end(JSON.stringify({ choices: [{ message: { content: "Ooh, wiggles! Let's dance!" } }] }));
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise<void>((r) => fakeOpenAI.listen(0, '127.0.0.1', r));
const fakeBase = `http://127.0.0.1:${(fakeOpenAI.address() as AddressInfo).port}/v1`;

// ---- local functions runner (no Twilio; fake OpenAI) and Vite proxying /api to it
const storeDir = mkdtempSync(path.join(os.tmpdir(), 'cb-voice-'));
for (const k of Object.keys(process.env)) if (/^(TWILIO|OPENAI|CHEER_BEAR|ADMIN|JWT)/.test(k)) delete process.env[k];
Object.assign(process.env, { CHEERBEAR_STORE: 'file', CHEERBEAR_STORE_DIR: storeDir, DEV_API_QUIET: '1', OPENAI_API_KEY: 'sk-fake', OPENAI_BASE_URL: fakeBase });
const { createDevApi } = await import('./dev-api');
const apiServer = await createDevApi();
await new Promise<void>((r) => apiServer.listen(0, '127.0.0.1', r));
process.env.API_PROXY = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

const { createServer } = await import('vite');
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
  optimizeDeps: { include: ['@twilio/voice-sdk'] },
  plugins: [
    {
      name: 'voice-harness',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__voice-harness')) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><body><script type="module" src="/scripts/voice-harness.ts"></script></body></html>');
        });
      },
    },
  ],
});
await vite.listen();
const webBase = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message.split('\n').slice(0, 8).join('\n       ') : err}`);
    process.exitCode = 1;
  }
}

type Entry = { t: string; at: number; [k: string]: any };
async function openHarness(query: string) {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${webBase}/__voice-harness${query}`);
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 30_000 });
  const getLog = () => page.evaluate(() => (window as any).__log as Entry[]);
  return { page, context, errors, getLog };
}

console.log('voice in headless Chromium');

// The browser's speech synthesis and recognition, faked (headless Chromium has neither working): the fake voice
// records each utterance, then sends start, a word boundary every 110 ms and end; the fake recognition lets the test
// "speak" as the child. Plain JS strings (see the note on __name in the server-voice handoff).
const FAKE_SPEECH = `
  window.__spoken = [];
  window.__cancels = 0;
  class FakeUtterance { constructor(text) { this.text = text; this.pitch = 1; this.rate = 1; this.volume = 1; this.voice = null; this.lang = ''; } }
  const voices = [
    { name: 'Albert', lang: 'en-US', localService: true, default: false, voiceURI: 'albert' },
    { name: 'Samantha', lang: 'en-US', localService: true, default: true, voiceURI: 'samantha' },
    { name: 'Amelie', lang: 'fr-CA', localService: true, default: false, voiceURI: 'amelie' },
  ];
  const synth = {
    speaking: false, pending: false, cur: null,
    getVoices() { return voices; },
    speak(u) {
      window.__spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, volume: u.volume, voice: u.voice ? u.voice.name : null });
      if (!u.text.trim()) return;
      this.cur = u; this.speaking = true;
      const words = [...u.text.matchAll(/[A-Za-z0-9'’]+/g)];
      let i = 0;
      setTimeout(() => {
        if (this.cur !== u) return;
        u.onstart && u.onstart({});
        const next = () => {
          if (this.cur !== u) return;
          if (i < words.length) { u.onboundary && u.onboundary({ name: 'word', charIndex: words[i].index }); i++; setTimeout(next, 110); }
          else { this.cur = null; this.speaking = false; u.onend && u.onend({}); }
        };
        next();
      }, 40);
    },
    cancel() { const u = this.cur; this.cur = null; this.speaking = false; window.__cancels++; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    resume() {}, pause() {}, addEventListener() {}, removeEventListener() {},
  };
  if (!location.search.includes('nosynth')) {
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = FakeUtterance;
  } else {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  }
  window.__recs = [];
  class FakeRec {
    constructor() { window.__recs.push(this); this.results = []; this.aborted = false; }
    start() { setTimeout(() => this.onstart && this.onstart(), 5); }
    stop() { this.onend && this.onend(); }
    abort() { this.aborted = true; }
  }
  window.__userSays = (text) => {
    const r = window.__recs.filter((x) => !x.aborted).pop();
    if (!r || !r.onresult) return false;
    const words = text.split(' ');
    const idx = r.results.length;
    for (let i = 1; i <= words.length; i++) {
      r.results[idx] = { isFinal: i === words.length, 0: { transcript: words.slice(0, i).join(' ') } };
      r.onresult({ resultIndex: idx, results: r.results });
    }
    return true;
  };
  if (location.search.includes('norec')) { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }
  else { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = FakeRec; }
`;

async function openSpeechHarness(query: string) {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript({ content: FAKE_SPEECH });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${webBase}/__voice-harness${query}`);
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 30_000 });
  const getLog = () => page.evaluate(() => (window as any).__log as Entry[]);
  const bearFinals = async () => (await getLog()).filter((e) => e.t === 'transcript' && e.speaker === 'cheer_bear' && e.final);
  const waitBearFinals = (n: number, timeout = 20_000) =>
    page.waitForFunction((k) => ((window as any).__log as Entry[]).filter((e) => e.t === 'transcript' && e.speaker === 'cheer_bear' && e.final).length >= k, n, { timeout });
  const type = async (text: string) => {
    await page.fill('#chat', text);
    await page.press('#chat', 'Enter');
  };
  return { page, context, errors, getLog, bearFinals, waitBearFinals, type };
}

await check('demo call: rings, Happi greets ONCE out loud with a friendly voice, mouth moves, then she waits (no loop)', async () => {
  const h = await openSpeechHarness('?mockVoice=fast&noai');
  (globalThis as any).__demo = h; // the next checks continue this call
  await h.page.click('#start');
  await h.waitBearFinals(1);
  await h.page.waitForTimeout(4000); // the old demo looped through a script here
  const log = await h.getLog();
  const statuses = log.filter((e) => e.t === 'status').map((e) => e.status);
  assert.deepEqual(statuses.slice(0, 3), ['connecting', 'ringing', 'in-call']);
  assert.ok(log.filter((e) => e.t === 'status').every((e) => e.mock === true), 'status says mock');
  const finals = await h.bearFinals();
  assert.equal(finals.length, 1, `greets once, then waits: ${finals.map((f) => f.text).join(' | ')}`);
  assert.match(finals[0].text, /Happi/);
  const partials = log.filter((e) => e.t === 'transcript' && e.id === finals[0].id && !e.final);
  assert.ok(partials.length >= 4, `her words stream as partials (${partials.length})`);
  assert.ok(partials.every((p, i) => i === 0 || p.text.length > partials[i - 1].text.length), 'partials grow word by word');
  assert.ok(finals[0].text.startsWith(partials[partials.length - 1].text.replace(/\W+$/, '')));
  assert.equal(log.filter((e) => e.t === 'trigger').length, 0, 'small talk fires nothing');
  const spoken = await h.page.evaluate(() => (window as any).__spoken.filter((u: any) => u.text.trim()));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, finals[0].text, 'what she says is what the transcript says');
  assert.equal(spoken[0].voice, 'Samantha', 'friendly English voice (not Albert, not French)');
  assert.ok(spoken[0].pitch > 1 && spoken[0].rate > 1, 'a bit higher and a bit faster');
  const vis = await h.page.evaluate(() => (window as any).__vis);
  // ~45 fps while she talks; under heavy CPU load timers run slower, so only a floor is checked
  assert.ok(vis.frames > 20, `mouth frames while she talks (${vis.frames})`);
  assert.ok(vis.nulls >= 1, 'null when she stops');
  assert.ok(vis.maxTotal <= 1.0001 && vis.maxAmp > 0.4, JSON.stringify(vis));
  assert.ok(Object.keys(vis.visemes).length >= 5, `several mouth shapes: ${JSON.stringify(vis.visemes)}`);
  const lastVis = log.filter((e) => e.t === 'visemes').pop();
  assert.equal(lastVis?.frame, null);
  assert.equal(log.find((e) => e.t === 'remoteStream')?.present ?? false, false, 'no fake audio stream in the demo');
  assert.deepEqual(h.errors, []);
});

await check('demo call: typed small talk -> spoken answer, nothing fires; "can you dance?" -> "...dance..." fires Dance ONCE', async () => {
  const h = (globalThis as any).__demo as Awaited<ReturnType<typeof openSpeechHarness>>;
  await h.type('hi, how are you?');
  await h.waitBearFinals(2);
  await h.page.waitForTimeout(800);
  let log = await h.getLog();
  assert.equal(log.filter((e) => e.t === 'trigger').length, 0, 'small talk fires nothing');
  const sent = log.find((e) => e.t === 'sent');
  assert.deepEqual([sent?.triggers, sent?.smsSent, sent?.replied], [[], false, true]);
  await h.type('Can you dance?');
  await h.waitBearFinals(3);
  await h.page.waitForTimeout(2500);
  log = await h.getLog();
  const finals = await h.bearFinals();
  const answer = finals[2];
  assert.match(answer.text, /dance/i);
  assert.equal(answer.chat, true, 'an answer to a typed message is marked chat');
  const triggers = log.filter((e) => e.t === 'trigger');
  assert.deepEqual(triggers.map((t) => [t.keyword, t.speaker, t.via]), [['Dance', 'cheer_bear', 'local']]);
  assert.equal(triggers[0].transcriptId, answer.id, 'fired from what she said');
  const fin = log.find((e) => e.t === 'transcript' && e.id === answer.id && e.final)!;
  assert.ok(triggers[0].at >= fin.at, 'after her sentence');
  const spoken = await h.page.evaluate(() => (window as any).__spoken.filter((u: any) => u.text.trim()).map((u: any) => u.text));
  assert.deepEqual(spoken, finals.map((f) => f.text), 'every answer was spoken out loud');
  assert.deepEqual(h.errors, []);
});

await check('demo call: the child talks (fake speech recognition) -> user transcripts -> her answer fires Rainbow; mute pauses listening', async () => {
  const h = (globalThis as any).__demo as Awaited<ReturnType<typeof openSpeechHarness>>;
  assert.equal(await h.page.evaluate(() => (window as any).__userSays('please make a rainbow')), true);
  await h.waitBearFinals(4);
  await h.page.waitForTimeout(2200);
  const log = await h.getLog();
  const user = log.filter((e) => e.t === 'transcript' && e.speaker === 'user');
  assert.ok(user.length >= 2 && user.some((u) => !u.final) && user.filter((u) => u.final).length === 1, 'partials then one final');
  assert.equal(user.find((u) => u.final)!.text, 'please make a rainbow');
  const answer = (await h.bearFinals())[3];
  assert.match(answer.text, /rainbow/i);
  assert.ok(!answer.chat, 'a spoken answer is a normal call transcript');
  assert.deepEqual(log.filter((e) => e.t === 'trigger').map((t) => t.keyword), ['Dance', 'Rainbow']);
  assert.ok(log.some((e) => e.t === 'transcription' && e.speaker === 'user' && e.state === 'live'));
  await h.page.evaluate(() => (window as any).__session.setMuted(true));
  const recs = await h.page.evaluate(() => (window as any).__recs.map((r: any) => r.aborted));
  assert.equal(recs[recs.length - 1], true, 'mute stops recognition');
  assert.equal(await h.page.evaluate(() => (window as any).__userSays('can you dance')), false, 'nothing listening while muted');
  await h.page.evaluate(() => (window as any).__session.setMuted(false));
  await h.page.waitForTimeout(100);
  assert.equal(await h.page.evaluate(() => (window as any).__recs.filter((r: any) => !r.aborted).length), 1, 'listening again');
  assert.deepEqual(h.errors, []);
});

await check('demo call: fireTrigger, endCall stops her mid-sentence, nothing after hang up', async () => {
  const h = (globalThis as any).__demo as Awaited<ReturnType<typeof openSpeechHarness>>;
  await h.page.evaluate(() => (window as any).__session.fireTrigger('Fireworks'));
  await h.type('tell me a joke');
  await h.page.waitForFunction(() => ((window as any).__log as Entry[]).filter((e) => e.t === 'transcript' && e.speaker === 'cheer_bear' && !e.final).length > 0 && (window as any).speechSynthesis.speaking, null, { timeout: 10_000 });
  await h.page.evaluate(() => (window as any).__session.endCall());
  await h.page.waitForTimeout(300);
  let log: Entry[] = await h.getLog();
  assert.deepEqual(log.filter((e) => e.t === 'trigger' && e.via === 'manual').map((e) => [e.keyword, e.speaker]), [['Fireworks', 'quick-action']]);
  assert.deepEqual(log.filter((e) => e.t === 'status').slice(-2).map((e) => e.status), ['ending', 'idle']);
  assert.equal(log.filter((e) => e.t === 'visemes').pop()?.frame, null, 'mouth closed');
  assert.ok(await h.page.evaluate(() => (window as any).__cancels > 0 && !(window as any).speechSynthesis.speaking), 'speech cancelled');
  assert.equal(log.filter((e) => e.t === 'transcription').pop()?.state, 'off');
  const count = log.filter((e) => e.t === 'transcript').length;
  await h.page.waitForTimeout(2000);
  log = await h.getLog();
  assert.equal(log.filter((e) => e.t === 'transcript').length, count, 'no transcripts after hang up');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

await check('no call: typed chat gets a spoken answer (chat-marked) and fires from her words; no voice at all still works', async () => {
  const h = await openSpeechHarness('?noai');
  await h.type('can you show me your house?');
  await h.waitBearFinals(1);
  await h.page.waitForTimeout(1500);
  let log = await h.getLog();
  const ans = (await h.bearFinals())[0];
  assert.match(ans.text, /house/i);
  assert.equal(ans.chat, true);
  assert.deepEqual(log.filter((e) => e.t === 'trigger').map((t) => t.keyword), ['House']);
  assert.equal(log.find((e) => e.t === 'sent')?.replied, true);
  assert.equal(log.filter((e) => e.t === 'status').length, 0, 'no call was started');
  assert.deepEqual(h.errors, []);
  await h.context.close();

  const n = await openSpeechHarness('?noai&nosynth');
  await n.type('what is your name?');
  await n.waitBearFinals(1);
  const vis = await n.page.evaluate(() => (window as any).__vis);
  assert.ok(vis.frames > 20, 'mouth still moves on the timed estimate');
  log = await n.getLog();
  assert.ok(log.filter((e) => e.t === 'transcript' && !e.final).length >= 2, 'words still stream');
  assert.deepEqual(n.errors, []);
  await n.context.close();
});

await check("demo call where the browser can't listen: a status message says to type instead, typing works", async () => {
  const h = await openSpeechHarness('?mockVoice=fast&noai&norec');
  await h.page.click('#start');
  await h.waitBearFinals(1);
  const log = await h.getLog();
  const notice = log.find((e) => e.t === 'status' && e.status === 'in-call' && /type/i.test(e.message || ''));
  assert.ok(notice, 'status message about typing');
  assert.ok(log.some((e) => e.t === 'transcription' && e.speaker === 'user' && e.state === 'error'));
  await h.type('make a rainbow');
  await h.waitBearFinals(2);
  await h.page.waitForTimeout(1500);
  assert.deepEqual((await h.getLog()).filter((e) => e.t === 'trigger').map((t) => t.keyword), ['Rainbow']);
  await h.page.evaluate(() => (window as any).__session.endCall());
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

await check('AI brain (fake OpenAI behind /api/chat): used when the server has a key; moderation then chat; answer fires from her words', async () => {
  chatLog.length = 0;
  const h = await openSpeechHarness('');
  assert.equal(await h.page.evaluate(() => (window as any).__services.chatAi), true);
  await h.type('wiggle wiggle');
  await h.waitBearFinals(1);
  await h.page.waitForTimeout(1500);
  const ans = (await h.bearFinals())[0];
  assert.equal(ans.text, "Ooh, wiggles! Let's dance!");
  assert.deepEqual((await h.getLog()).filter((e) => e.t === 'trigger').map((t) => t.keyword), ['Dance']);
  assert.deepEqual(chatLog, ['/v1/moderations', '/v1/chat/completions', '/v1/moderations']);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

await check('real mode without Twilio: clear not_configured error, no crash', async () => {
  const { page, context, errors, getLog } = await openHarness('');
  await page.click('#start');
  await page.waitForFunction(() => ((window as any).__log as Entry[]).some((e) => e.t === 'status' && e.status === 'error'), null, { timeout: 15_000 });
  const err = (await getLog()).filter((e) => e.t === 'status').pop()!;
  assert.equal(err.code, 'not_configured');
  assert.match(err.message, /not set up/);
  assert.equal(await page.evaluate(() => (window as any).__session.status), 'error');
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await context.close();
});

await check("mode 'auto': falls back to the demo call when Twilio is not configured", async () => {
  const { page, context, getLog } = await openHarness('?mode=auto');
  await page.click('#start');
  await page.waitForFunction(() => ((window as any).__log as Entry[]).some((e) => e.t === 'status' && e.status === 'in-call'), null, { timeout: 15_000 });
  const statuses = (await getLog()).filter((e) => e.t === 'status');
  assert.equal(statuses[0].mock, false, 'tries the real call first');
  assert.ok(statuses.some((s) => /demo call/.test(s.message || '') && s.mock), 'then says it is a demo call');
  assert.equal(statuses.pop()!.mock, true);
  await page.evaluate(() => (window as any).__session.dispose());
  await context.close();
});

async function transcriberLoopback(clientCommit: boolean) {
  if (clientCommit) process.env.OPENAI_TRANSCRIBE_MODEL = 'gpt-live-transcribe';
  else delete process.env.OPENAI_TRANSCRIBE_MODEL;
  const { page, context, errors } = await openHarness('');
  // The fake "OpenAI": another page with its own RTCPeerConnection answers the SDP offer.
  const fake = await context.newPage();
  await fake.setContent('<html><body>fake openai</body></html>');
  // Plain JS string: functions passed to page.evaluate from tsx get __name() helpers the browser does not have.
  await fake.addScriptTag({
    content: `
      window.received = { track: false, dcLabel: '', commits: 0 };
      window.answer = async (offer) => {
        const pc = new RTCPeerConnection();
        window.pc = pc;
        pc.ontrack = () => { window.received.track = true; };
        pc.ondatachannel = (e) => {
          const dc = e.channel;
          window.received.dcLabel = dc.label;
          dc.onmessage = (m) => { try { if (JSON.parse(m.data).type === 'input_audio_buffer.commit') window.received.commits++; } catch {} };
          const go = () => setTimeout(() => {
            const send = (o) => dc.send(JSON.stringify(o));
            send({ type: 'session.created' });
            send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', content_index: 0, delta: 'Look at the ' });
            send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', content_index: 0, delta: 'rainbow' });
            send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', content_index: 0, transcript: 'Look at the rainbow!' });
          }, 300);
          // The receiving side's channel is often already open when 'datachannel' fires.
          if (dc.readyState === 'open') go(); else dc.onopen = go;
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: offer });
        await pc.setLocalDescription(await pc.createAnswer());
        await new Promise((r) => {
          if (pc.iceGatheringState === 'complete') return r();
          pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') r(); };
          setTimeout(r, 3000);
        });
        return pc.localDescription.sdp;
      };`,
  });
  let sdpAuth = '';
  await page.route(`${fakeBase}/realtime/calls`, async (route) => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sdpAuth = req.headers()['authorization'] || '';
    const answer = await fake.evaluate((o) => (window as any).answer(o), req.postData() || '');
    await route.fulfill({ status: 201, headers: { ...cors, 'Content-Type': 'application/sdp' }, body: answer });
  });
  await page.evaluate(() => (window as any).__runTranscriber());
  try {
    await page.waitForFunction(() => ((window as any).__transcriber?.out || []).some((o: any) => o.final), null, { timeout: 20_000 });
  } catch (err) {
    const dbg = await page.evaluate(() => ({ states: (window as any).__transcriber?.states, out: (window as any).__transcriber?.out }));
    const fdbg = await fake.evaluate(() => ({ received: (window as any).received, pc: (window as any).pc?.connectionState }));
    throw new Error(`no final transcript; states=${JSON.stringify(dbg)} fake=${JSON.stringify(fdbg)} errors=${JSON.stringify(errors)} sdpAuth=${sdpAuth}`);
  }
  const result = await page.evaluate(() => {
    const t = (window as any).__transcriber;
    return { out: t.out, states: t.states };
  });
  assert.equal(sdpAuth, 'Bearer ek_browser_test', 'SDP posted with the client secret from /api/realtime-session');
  assert.deepEqual(result.out, [
    { itemId: 'item_1', text: 'Look at the ', final: false },
    { itemId: 'item_1', text: 'Look at the rainbow', final: false },
    { itemId: 'item_1', text: 'Look at the rainbow!', final: true },
  ]);
  assert.deepEqual(result.states.slice(0, 2), ['connecting', 'live']);
  const received = await fake.evaluate(() => (window as any).received);
  assert.equal(received.dcLabel, 'oai-events');
  assert.equal(received.track, true, 'the fake OpenAI peer received an audio track');
  if (!clientCommit) assert.equal(received.commits, 0, 'server VAD model: the browser does not commit');
  else {
    // Chromium's fake microphone beeps without a 700 ms gap, so this exercises the 12 s max-turn commit.
    await fake.waitForFunction(() => (window as any).received.commits >= 1, null, { timeout: 16_000 }).catch(() => undefined);
    const r2 = await fake.evaluate(() => (window as any).received);
    assert.ok(r2.commits >= 1, `client-commit model: the browser commits turns itself (${r2.commits} commits)`);
  }
  await page.evaluate(() => (window as any).__transcriber.stop());
  const after = await page.evaluate(() => ({ states: (window as any).__transcriber.states, live: (window as any).__transcriber.track.readyState }));
  assert.equal(after.states[after.states.length - 1], 'off');
  assert.equal(after.live, 'live', "stopping transcription does not stop the call's own track");
  assert.deepEqual(errors, []);
  await context.close();
}

await check('OpenAI WebRTC transcriber against a fake OpenAI peer (SDP, data channel, delta/completed)', () => transcriberLoopback(false));
await check('transcriber with a no-VAD model (gpt-live-transcribe): client-side commits from RTCStats audioLevel', () => transcriberLoopback(true));

await browser.close();
await vite.close();
apiServer.close();
fakeOpenAI.close();
rmSync(storeDir, { recursive: true, force: true });
console.log(`voice browser: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
process.exit(process.exitCode ?? 0);
