// @ts-nocheck -- test runner: Playwright is a global, untyped install here; run with tsx (no typecheck).
// Headless Chromium checks for src/voice (no Twilio / OpenAI accounts):
//   1. Demo call (?mockVoice): status flow, transcripts (partials + finals), triggers in script order, a remote
//      stream that carries audio (what lip sync uses), sendText / fireTrigger / mute / endCall.
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
const fakeOpenAI = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/realtime/client_secrets') return res.end(JSON.stringify({ value: 'ek_browser_test', expires_at: 1900000000 }));
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

const EXPECTED = ['House', 'Rainbow', 'Sparkle', 'Dance', 'Party', 'Wave', 'Cold', 'Magic', 'Running', 'Sleep', 'WakeUp'];

await check('demo call: status flow, transcripts and all 11 core triggers in order, with audio for lip sync', async () => {
  const { page, context, errors, getLog } = await openHarness('?mockVoice=fast,silent');
  await page.click('#start');
  await page.waitForFunction((n) => ((window as any).__log as Entry[]).filter((e) => e.t === 'trigger').length >= n, EXPECTED.length, { timeout: 60_000 });
  const log = await getLog();
  const statuses = log.filter((e) => e.t === 'status').map((e) => e.status);
  assert.deepEqual(statuses.slice(0, 3), ['connecting', 'ringing', 'in-call']);
  assert.ok(log.filter((e) => e.t === 'status').every((e) => e.mock === true), 'status says mock');
  const remote = log.find((e) => e.t === 'remoteStream');
  assert.ok(remote?.present && remote.tracks === 1, 'remote stream with one audio track');

  const transcripts = log.filter((e) => e.t === 'transcript');
  const first = transcripts.filter((e) => e.id === 'mock-1');
  assert.ok(first.length > 3 && first.slice(0, -1).every((e) => !e.final) && first[first.length - 1].final, 'partials then a final');
  assert.match(first[first.length - 1].text, /welcome to my house/i);

  const triggers = log.filter((e) => e.t === 'trigger');
  assert.deepEqual(triggers.slice(0, EXPECTED.length).map((e) => e.keyword), EXPECTED);
  for (const trig of triggers) {
    assert.equal(trig.speaker, 'cheer_bear');
    assert.equal(trig.via, 'local');
    const fin = transcripts.find((e) => e.id === trig.transcriptId && e.final);
    assert.ok(fin, `trigger ${trig.keyword} has a final transcript`);
    assert.ok(trig.at >= fin!.at, `trigger ${trig.keyword} comes after its transcript`);
  }
  // Two triggers from one line are spaced by dispatchIntervalMs (1000 ms default).
  const rainbow = triggers.find((e) => e.keyword === 'Rainbow')!;
  const sparkle = triggers.find((e) => e.keyword === 'Sparkle')!;
  assert.ok(sparkle.at - rainbow.at >= 900, `spacing ${sparkle.at - rainbow.at} ms`);

  const levels = await page.evaluate(() => (window as any).__levels as number[]);
  const loud = levels.filter((l) => l > 0.01).length;
  assert.ok(loud > 10, `remote stream carries sound (${loud} loud samples of ${levels.length}, max ${Math.max(...levels).toFixed(3)})`);
  assert.ok(levels.some((l) => l < 0.002), 'and silence between lines');
  assert.deepEqual(errors, []);
  (globalThis as any).__demo = { page, context, getLog, errors };
});

await check('demo call: sendText, fireTrigger, mute and endCall', async () => {
  const { page, context, getLog, errors } = (globalThis as any).__demo;
  const sent = await page.evaluate(() => (window as any).__session.sendText('Hello Cheer Bear, do you like rainbows?'));
  assert.deepEqual(sent, { triggers: [], smsSent: false }, 'user triggers are off by default; no SMS in demo');
  await page.evaluate(() => (window as any).__session.fireTrigger('Fireworks'));
  await page.evaluate(() => (window as any).__session.setMuted(true));
  await page.waitForTimeout(1200);
  let log: Entry[] = await getLog();
  const manual = log.filter((e) => e.t === 'trigger' && e.via === 'manual');
  assert.deepEqual(manual.map((e) => [e.keyword, e.speaker]), [['Fireworks', 'quick-action']]);
  assert.ok(log.some((e) => e.t === 'muted' && e.muted === true));
  await page.evaluate(() => (window as any).__session.endCall());
  await page.waitForTimeout(300);
  log = await getLog();
  const tail = log.filter((e) => e.t === 'status').slice(-2).map((e) => e.status);
  assert.deepEqual(tail, ['ending', 'idle']);
  assert.equal(log.filter((e) => e.t === 'remoteStream').pop()?.present, false, 'remoteStream null after the call');
  assert.equal(log.filter((e) => e.t === 'transcription').pop()?.state, 'off');
  assert.ok(log.some((e) => e.t === 'muted' && e.muted === false), 'unmuted on hang up');
  const count = log.filter((e) => e.t === 'transcript').length;
  await page.waitForTimeout(1500);
  assert.equal((await getLog()).filter((e: Entry) => e.t === 'transcript').length, count, 'no transcripts after hang up');
  assert.deepEqual(errors, []);
  await context.close();
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
