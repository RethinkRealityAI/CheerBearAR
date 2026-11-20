// voice-5: the demo call's turn taking, end to end through the real session (createVoiceSession, MockCall,
// CallListener, DemoBear, BrowserVoice, TriggerPipeline), in Node with a fake speechSynthesis that RECORDS every
// utterance with its timing and a fake SpeechRecognition that can echo her voice, end by itself (Android), refuse a
// restart (iOS), and repeat finals. Run: npx tsx scripts/check-voice-call.ts (also via npm run test:server).
import assert from 'node:assert/strict';
import { applyConfigPatch, defaultConfig, type AppConfig } from '../src/shared/config';
import type { TranscriptEvent, TriggerEvent } from '../src/shared/contracts';

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : err}`);
    process.exitCode = 1;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const now = () => Date.now() - t0;

// ------------------------------------------------------------------ fake speech synthesis (records with timing)
interface Utter { text: string; start: number; end: number; cancelled: boolean }
const synthLog: Utter[] = [];
let wordMs = 60;
let sendEnd = true;
class FakeUtterance {
  text: string; pitch = 1; rate = 1; volume = 1; voice: unknown = null; lang = '';
  onstart: ((e: unknown) => void) | null = null; onend: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null; onboundary: ((e: unknown) => void) | null = null;
  constructor(text: string) { this.text = text; }
}
const synth = {
  speaking: false, pending: false, cur: null as FakeUtterance | null, rec: null as Utter | null,
  getVoices: () => [{ name: 'Samantha', lang: 'en-US', localService: true, default: true }],
  speak(u: FakeUtterance) {
    if (!u.text.trim()) return;
    const rec: Utter = { text: u.text, start: now(), end: -1, cancelled: false };
    synthLog.push(rec);
    this.cur = u; this.rec = rec; this.speaking = true;
    const words = [...u.text.matchAll(/[A-Za-z0-9']+/g)];
    let i = 0;
    setTimeout(() => {
      if (this.cur !== u) return;
      u.onstart?.({});
      const next = () => {
        if (this.cur !== u) return;
        echo(words.slice(0, i + 1).map((w) => w[0]).join(' '));
        if (i < words.length) { u.onboundary?.({ name: 'word', charIndex: words[i].index }); i += 1; setTimeout(next, wordMs); }
        else { this.cur = null; this.speaking = false; rec.end = now(); if (sendEnd) u.onend?.({}); }
      };
      next();
    }, 20);
  },
  cancel() { const u = this.cur; if (this.rec && this.rec.end < 0) { this.rec.end = now(); this.rec.cancelled = true; } this.cur = null; this.speaking = false; u?.onerror?.({ error: 'interrupted' }); },
  resume() {}, addEventListener() {}, removeEventListener() {},
};

// ------------------------------------------------------------------ fake speech recognition
interface RecInfo { start: number; stop: number; aborted: boolean; results: string[] }
const recLog: RecInfo[] = [];
let openRec: FakeRec | null = null;
let endAfterSilenceMs = 0; // Android: ends by itself after this long without speech (0: never)
let refuseRestart = false; // iOS: a start outside a tap -> not-allowed
let duplicateFinals = false;
class FakeRec {
  continuous = false; interimResults = false; lang = ''; maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null; onstart: (() => void) | null = null; onaudiostart: (() => void) | null = null;
  info: RecInfo = { start: -1, stop: -1, aborted: false, results: [] };
  results: Array<{ isFinal: boolean; 0: { transcript: string } }> = [];
  silence: ReturnType<typeof setTimeout> | null = null;
  start() {
    this.info.start = now();
    recLog.push(this.info);
    if (refuseRestart && recLog.length > 1) {
      setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.end(); }, 5);
      return;
    }
    openRec = this;
    setTimeout(() => this.onstart?.(), 10);
    this.armSilence();
  }
  armSilence() {
    if (this.silence) clearTimeout(this.silence);
    if (endAfterSilenceMs) this.silence = setTimeout(() => { this.onerror?.({ error: 'no-speech' }); this.end(); }, endAfterSilenceMs);
  }
  end() { if (this.silence) clearTimeout(this.silence); if (openRec === this) openRec = null; this.info.stop = now(); this.onend?.(); }
  stop() { this.end(); }
  abort() { if (this.silence) clearTimeout(this.silence); this.info.aborted = true; this.info.stop = now(); if (openRec === this) openRec = null; }
  say(text: string, finalDelayMs = 120) {
    const words = text.split(' ');
    const idx = this.results.length;
    words.forEach((_, i) => setTimeout(() => {
      if (openRec !== this) return;
      this.results[idx] = { isFinal: false, 0: { transcript: words.slice(0, i + 1).join(' ') } };
      this.onresult?.({ resultIndex: idx, results: this.results });
    }, i * 80));
    setTimeout(() => {
      if (openRec !== this) return;
      this.results[idx] = { isFinal: true, 0: { transcript: text } };
      this.info.results.push(text);
      this.onresult?.({ resultIndex: idx, results: this.results });
      if (duplicateFinals) { this.results[idx + 1] = { isFinal: true, 0: { transcript: text } }; this.onresult?.({ resultIndex: idx + 1, results: this.results }); }
      this.armSilence();
    }, words.length * 80 + finalDelayMs);
  }
}
/** The microphone hears the speaker: whatever she says while a recogniser is open becomes a result. */
let echoed = 0;
function echo(text: string) {
  const r = openRec;
  if (!r || !text) return;
  echoed += 1;
  r.results[0] = { isFinal: false, 0: { transcript: text } };
  r.onresult?.({ resultIndex: 0, results: r.results });
}
/** The child says something into whichever recogniser is open now. */
function childSays(text: string): boolean {
  if (!openRec) return false;
  openRec.say(text);
  return true;
}

// ------------------------------------------------------------------ Node "browser"
const g = globalThis as unknown as Record<string, unknown>;
g.window = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance, webkitSpeechRecognition: FakeRec, addEventListener() {}, removeEventListener() {} };
g.speechSynthesis = synth;
g.SpeechSynthesisUtterance = FakeUtterance;
g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
// no server: the AI brain is never asked (services.chatAi is false until a config load)

const { createVoiceSession } = await import('../src/voice/session');

function newCall(patch: unknown = {}) {
  const cfg: AppConfig = applyConfigPatch(applyConfigPatch(defaultConfig(), { triggerPolicy: { triggerCooldownMs: 300, dispatchIntervalMs: 50 } }), patch);
  const session = createVoiceSession({ getConfig: () => cfg, mock: 'always' });
  const turns: Array<{ at: number; phase: string; text?: string }> = [];
  const transcripts: TranscriptEvent[] = [];
  const triggers: TriggerEvent[] = [];
  const statuses: Array<{ status: string; message?: string }> = [];
  session.onCallTurn((t) => turns.push({ at: now(), ...t }));
  session.on('transcript', (t) => transcripts.push(t));
  session.on('trigger', (t) => triggers.push(t));
  session.on('status', (s) => statuses.push(s));
  const bearFinals = () => transcripts.filter((t) => t.speaker === 'cheer_bear' && t.final);
  const waitFor = async (fn: () => boolean, ms = 8000, what = 'condition') => {
    const end = Date.now() + ms;
    while (!fn()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
  };
  const waitListening = () => waitFor(() => !!openRec && turns.at(-1)?.phase === 'listening', 8000, 'her to listen');
  return { session, turns, transcripts, triggers, statuses, bearFinals, waitFor, waitListening };
}

function reset() {
  synthLog.length = 0; recLog.length = 0; openRec = null; echoed = 0;
  endAfterSilenceMs = 0; refuseRestart = false; duplicateFinals = false; wordMs = 60; sendEnd = true;
}

/** Recognition open while she was audibly speaking (half duplex broken). Warm-up before the greeting excluded. */
function overlaps(): string[] {
  const bad: string[] = [];
  for (const u of synthLog) {
    for (const r of recLog) {
      const rEnd = r.stop < 0 ? Infinity : r.stop;
      const uEnd = u.end < 0 ? Infinity : u.end;
      if (r.start < uEnd - 5 && rEnd > u.start + 25) bad.push(`rec ${r.start}-${r.stop} vs "${u.text.slice(0, 30)}" ${u.start}-${u.end}`);
    }
  }
  return bad;
}

await check('half duplex: the mic is never open while she talks, so her own voice is never answered (echo)', async () => {
  reset();
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitListening();
  assert.equal(c.bearFinals().length, 1, 'greeted once');
  assert.ok(childSays('hello how are you'));
  await c.waitFor(() => c.bearFinals().length >= 2, 8000, 'her answer');
  await c.waitListening();
  assert.ok(childSays('can you dance'));
  await c.waitFor(() => c.bearFinals().length >= 3, 8000, 'her answer');
  await c.waitListening();
  await sleep(400);
  assert.deepEqual(overlaps(), [], 'no recogniser open while she spoke');
  assert.equal(echoed, 0, 'nothing of her voice reached a recogniser');
  const users = c.transcripts.filter((t) => t.speaker === 'user' && t.final).map((t) => t.text);
  assert.deepEqual(users, ['hello how are you', 'can you dance'], 'only the child was heard');
  assert.deepEqual(c.triggers.map((t) => [t.keyword, t.speaker]), [['Dance', 'cheer_bear']], 'Dance once, from her words');
  assert.ok(recLog.every((r) => r.aborted || r.stop >= 0 || r === recLog.at(-1)), 'every old recogniser was closed');
  await c.session.endCall();
  c.session.dispose();
});

await check('quick turns: from the end of your words to her voice < 1.2 s; "thinking" shows in between; whose turn is always known', async () => {
  reset();
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitListening();
  const before = synthLog.length;
  const said = now();
  childSays('tell me a joke'); // 3 words: final at ~360 ms
  await c.waitFor(() => synthLog.length > before, 5000, 'her answer to start');
  const finalAt = said + 3 * 80 + 120;
  const gap = synthLog.at(-1)!.start - finalAt;
  assert.ok(gap < 1200, `gap ${gap} ms`);
  const phases = c.turns.map((t) => t.phase);
  const iHearing = phases.lastIndexOf('hearing');
  assert.ok(iHearing > 0 && phases.slice(iHearing).includes('thinking') && phases.slice(iHearing).includes('bear'), phases.join(' > '));
  assert.ok(c.turns.some((t) => t.phase === 'hearing' && t.text === 'tell me a joke'), 'your words live');
  console.log(`       (your words end -> her voice: ${gap} ms)`);
  await c.session.endCall();
  assert.equal(c.session.callTurn.phase, 'off');
  c.session.dispose();
});

await check('Android: the recogniser ends after 1.2 s of silence -> no "can\'t hear you" lock-out; one "still there?" then a tap to talk; bounded restarts', async () => {
  reset();
  endAfterSilenceMs = 1200;
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitListening();
  const startRecs = recLog.length;
  await c.waitFor(() => c.turns.at(-1)?.phase === 'paused', 40_000, 'paused after two quiet windows');
  const lines = synthLog.map((u) => u.text);
  assert.equal(lines.filter((l) => /still here|still there/i.test(l)).length, 1, `one nudge: ${lines.join(' | ')}`);
  assert.ok(!c.statuses.some((s) => /can't hear you/i.test(s.message ?? '')), 'never locked out');
  const quietRecs = recLog.length - startRecs;
  assert.ok(quietRecs <= 26, `restarts bounded (${quietRecs} recognisers in ~30 s)`);
  await sleep(2000);
  assert.equal(recLog.length - startRecs, quietRecs, 'no more recognisers while paused (no endless beeps)');
  // a tap on the mic resumes, and the child is heard
  assert.equal(c.session.listenNow(), true);
  await c.waitListening();
  childSays('make a rainbow');
  await c.waitFor(() => c.triggers.some((t) => t.keyword === 'Rainbow'), 8000, 'Rainbow');
  assert.deepEqual(overlaps(), []);
  await c.session.endCall();
  c.session.dispose();
});

await check('barge-in by touch: listenNow() while she talks stops her at once and opens the mic in the same tap', async () => {
  reset();
  wordMs = 200; // a slow, long line
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitFor(() => synth.speaking, 8000, 'greeting');
  await sleep(300);
  const recsBefore = recLog.length;
  assert.equal(c.session.listenNow(), true);
  assert.equal(synth.speaking, false, 'her voice stopped');
  assert.equal(recLog.length, recsBefore + 1, 'a recogniser started synchronously (inside the tap)');
  assert.ok(synthLog[0].cancelled);
  await c.waitListening();
  wordMs = 60;
  childSays('what is your name');
  await c.waitFor(() => c.bearFinals().length >= 1, 8000, 'her answer');
  assert.match(c.bearFinals().at(-1)!.text, /Cheer Bear/);
  await c.session.endCall();
  c.session.dispose();
});

await check('iOS: a restart outside a tap is refused (not-allowed after the mic worked) -> paused, NOT blocked; a tap resumes', async () => {
  reset();
  refuseRestart = true;
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitFor(() => c.turns.at(-1)?.phase === 'paused', 10_000, 'paused');
  assert.ok(!c.statuses.some((s) => /blocked/i.test(s.message ?? '')), 'no "microphone blocked" message');
  refuseRestart = false;
  assert.equal(c.session.listenNow(), true);
  await c.waitListening();
  childSays('hello');
  await c.waitFor(() => c.bearFinals().length >= 2, 8000, 'answer');
  await c.session.endCall();
  c.session.dispose();
});

await check('a voice that never sends `end` (Chrome Android): her turn ends within ~1 s of the words, not after the 10 s watchdog', async () => {
  reset();
  sendEnd = false;
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitFor(() => synthLog.length >= 1 && !synth.speaking, 8000, 'greeting spoken');
  const spokenAt = now();
  await c.waitListening();
  const wait = now() - spokenAt;
  assert.ok(wait < 1500, `listening ${wait} ms after her last word`);
  await c.session.endCall();
  c.session.dispose();
});

await check('Android repeated finals and an utterance in two parts: one turn, one answer', async () => {
  reset();
  duplicateFinals = true;
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitListening();
  childSays('can you dance');
  await c.waitFor(() => c.bearFinals().length >= 2, 8000, 'answer');
  await sleep(1500);
  assert.equal(c.bearFinals().length, 2, 'one answer');
  assert.equal(c.triggers.filter((t) => t.keyword === 'Dance').length, 1);
  await c.session.endCall();
  c.session.dispose();
});

await check('voice commands in the call: the app handler runs "go to AR" and she says its line (no brain answer); else the brain', async () => {
  reset();
  const c = newCall();
  const handled: string[] = [];
  c.session.setCallCommandHandler((text) => { handled.push(text); return /\bar\b/.test(text) ? 'Let me visit your room!' : false; });
  await c.session.startCall({ mock: true });
  await c.waitListening();
  childSays('go to ar');
  await c.waitFor(() => c.bearFinals().length >= 2, 8000, 'her line');
  assert.equal(c.bearFinals().at(-1)!.text, 'Let me visit your room!');
  await c.waitListening();
  childSays('how old are you');
  await c.waitFor(() => c.bearFinals().length >= 3, 8000, 'brain answer');
  assert.deepEqual(handled, ['go to ar', 'how old are you']);
  assert.notEqual(c.bearFinals().at(-1)!.text, 'Let me visit your room!');
  await c.session.endCall();
  c.session.dispose();
});

await check('typing during the call and mute: typed words are answered; muted never listens; unmute listens', async () => {
  reset();
  const c = newCall();
  await c.session.startCall({ mock: true });
  await c.waitListening();
  const r = await c.session.sendText('show me your house');
  assert.equal(r.replied, true);
  await c.waitFor(() => c.triggers.some((t) => t.keyword === 'House'), 8000, 'House');
  await c.waitListening();
  c.session.setMuted(true);
  assert.equal(openRec, null, 'mic closed');
  assert.equal(c.session.callTurn.phase, 'muted');
  await sleep(1200);
  assert.equal(openRec, null, 'still closed');
  c.session.setMuted(false);
  await c.waitListening();
  assert.deepEqual(overlaps(), [], 'no overlap');
  await c.session.endCall();
  assert.equal(openRec, null, 'hang up closes the mic');
  c.session.dispose();
});

await check('no speech recognition at all: the call still connects and greets; typing works; the status says so', async () => {
  reset();
  const w = g.window as Record<string, unknown>;
  const saved = w.webkitSpeechRecognition;
  w.webkitSpeechRecognition = undefined;
  try {
    const c = newCall();
    await c.session.startCall({ mock: true });
    await c.waitFor(() => c.bearFinals().length >= 1, 8000, 'greeting');
    await c.waitFor(() => c.statuses.some((s) => /type/i.test(s.message ?? '')), 3000, 'type-instead message');
    await c.session.sendText('make a rainbow');
    await c.waitFor(() => c.triggers.some((t) => t.keyword === 'Rainbow'), 8000, 'Rainbow');
    await c.session.endCall();
    c.session.dispose();
  } finally {
    w.webkitSpeechRecognition = saved;
  }
});

// ------------------------------------------------------------------ the local brain: real conversation turns
const { CheerBrain } = await import('../src/voice/cheerBrain');
const { extractKeywordMatches } = await import('../src/shared/classifier');
const lc = defaultConfig().localClassifier;

await check('brain: short answers to her own questions get real replies (feelings, colours, "yes" to a joke)', async () => {
  const b = new CheerBrain({ seed: 1 });
  b.greeting(lc);
  assert.match(b.reply('Sam', lc).text, /Sam/);
  const how = b.reply('how are you', lc);
  assert.match(how.text, /\?$/, how.text);
  assert.equal(b.expecting, 'feeling');
  assert.equal(b.reply('good', lc).intent, 'happy');
  b.reply('how are you', lc);
  assert.equal(b.reply('not so good', lc).intent, 'sad');
  let fav = b.reply('what is your favourite colour', lc);
  while (!/\?$/.test(fav.text)) fav = b.reply('what is your favourite colour', lc);
  const pick = b.reply('blue', lc);
  assert.equal(pick.intent, 'colourPicked');
  assert.match(pick.text, /blue/i);
  const sad = b.reply("I'm sad", lc);
  if (/joke/.test(sad.text)) assert.equal(b.reply('yes', lc).intent, 'joke');
  assert.equal(b.reply('yes', lc).intent, 'yes', 'a bare yes with nothing asked');
});

await check('brain: knock knock jokes, songs, stories, pets, ages, "what\'s my name", bored: answers, never a trigger word', async () => {
  const b = new CheerBrain({ seed: 2 });
  assert.equal(b.reply('knock knock', lc).text, "Who's there?");
  assert.equal(b.reply('boo', lc).text, 'Boo who?');
  assert.equal(b.reply("don't cry it's only a joke", lc).intent, 'knockLaugh');
  const asks: Array<[string, string]> = [
    ['can you sing a song', 'song'], ['tell me a story', 'story'], ['what is your favourite animal', 'animal'],
    ['I have a dog', 'pet'], ["I'm six", 'childAge'], ['I am 7 years old', 'childAge'], ['are you real', 'real'],
    ['what are you doing', 'doing'], ["I'm bored", 'bored'], ['can you count', 'count'], ['will you be my friend', 'friends'],
  ];
  for (const [say, intent] of asks) {
    const r = b.reply(say, lc);
    assert.equal(r.intent, intent, `${say} -> ${r.intent}: ${r.text}`);
    assert.deepEqual(extractKeywordMatches(r.text, lc), [], `no trigger word in "${r.text}"`);
    assert.deepEqual(r.actions, []);
  }
  assert.equal(b.name, null, '"I\'m six" is not a name');
  assert.equal(b.reply("what's my name", lc).intent, 'askName', 'asks when it does not know');
  b.reply('my name is Mia', lc);
  assert.match(b.reply("what's my name", lc).text, /Mia/);
});

console.log(`voice call: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
process.exit(process.exitCode ?? 0);
