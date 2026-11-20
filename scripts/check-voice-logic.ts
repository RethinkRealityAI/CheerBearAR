// Checks for the browser trigger pipeline (src/voice/triggerPipeline.ts), run in Node. npx tsx scripts/check-voice-logic.ts
import assert from 'node:assert/strict';
import { TriggerPipeline } from '../src/voice/triggerPipeline';
import { applyConfigPatch, defaultConfig, type AppConfig } from '../src/shared/config';
import type { TriggerEvent } from '../src/shared/contracts';
import { VISEMES } from '../src/shared/contracts';
import { extractKeywordMatches } from '../src/shared/classifier';
import { BRAIN_LINES, CheerBrain } from '../src/voice/cheerBrain';
import { buildVisemeTimeline, sampleTimeline, wordAtChar } from '../src/voice/textVisemes';
import { SpeechInput, type RecognitionLike } from '../src/voice/speechInput';
import { pickVoice } from '../src/voice/browserVoice';

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(patch: unknown = {}, ai: (t: string, k: string[]) => Promise<string[]> = async () => []) {
  let config: AppConfig = applyConfigPatch(defaultConfig(), { triggerPolicy: { triggerCooldownMs: 300, dispatchIntervalMs: 50 } });
  config = applyConfigPatch(config, patch);
  const fired: TriggerEvent[] = [];
  const aiCalls: string[] = [];
  const p = new TriggerPipeline({
    getConfig: () => config,
    classifyWithAI: async (t, k) => {
      aiCalls.push(t);
      return ai(t, k);
    },
    emit: (t) => fired.push(t),
  });
  return { p, fired, aiCalls, set: (x: unknown) => (config = applyConfigPatch(config, x)) };
}
const tr = (id: string, text: string, final = true, speaker: 'cheer_bear' | 'user' = 'cheer_bear') => ({ id, speaker, text, final, at: Date.now() });

console.log('voice trigger pipeline');
await check("Happi's final transcript fires its keywords, spaced by dispatchIntervalMs", async () => {
  const { p, fired } = setup();
  await p.handleTranscript(tr('a', "Let's dance at the party under a rainbow"));
  assert.equal(fired.length, 1, 'first fires immediately');
  await sleep(180);
  assert.deepEqual(fired.map((f) => f.keyword), ['Dance', 'Party', 'Rainbow']);
  assert.ok(fired[1].at - fired[0].at >= 45 && fired[2].at - fired[1].at >= 45, 'spaced');
  assert.equal(fired[0].via, 'local');
  assert.equal(fired[0].speaker, 'cheer_bear');
  assert.equal(fired[0].transcriptId, 'a');
});
await check('cooldown per speaker+keyword; fires again after it', async () => {
  const { p, fired } = setup();
  await p.handleTranscript(tr('a', 'magic'));
  await p.handleTranscript(tr('b', 'more magic'));
  assert.equal(fired.length, 1);
  await sleep(320);
  await p.handleTranscript(tr('c', 'magic again'));
  assert.equal(fired.length, 2);
});
await check("the user's transcripts only trigger when allowUserTriggers", async () => {
  const { p, fired, set } = setup();
  await p.handleTranscript(tr('u1', 'rainbow', true, 'user'));
  assert.equal(fired.length, 0);
  set({ allowUserTriggers: true });
  await p.handleTranscript(tr('u2', 'rainbow', true, 'user'));
  assert.deepEqual(fired.map((f) => [f.keyword, f.speaker]), [['Rainbow', 'user']]);
});
await check('partials are ignored unless partialTriggerEnabled', async () => {
  const { p, fired } = setup();
  await p.handleTranscript(tr('a', 'look a rainbow', false));
  assert.equal(fired.length, 0);
});
await check('partial + final dedupe: a keyword fires once per transcript', async () => {
  const { p, fired } = setup({ triggerPolicy: { partialTriggerEnabled: true, triggerCooldownMs: 0 } });
  await p.handleTranscript(tr('a', 'look a', false));
  await p.handleTranscript(tr('a', 'look a rainbow', false));
  await p.handleTranscript(tr('a', 'look a rainbow and', false));
  await p.handleTranscript(tr('a', 'look a rainbow and sparkles', false));
  await p.handleTranscript(tr('a', 'Look, a rainbow and sparkles!', true));
  await sleep(120);
  assert.deepEqual(fired.map((f) => f.keyword), ['Rainbow', 'Sparkle']);
  // A NEW transcript may fire the same word again (cooldown 0 here).
  await p.handleTranscript(tr('b', 'another rainbow', true));
  await sleep(20);
  assert.equal(fired.filter((f) => f.keyword === 'Rainbow').length, 2);
});
await check('englishOnlyTranscripts strips non-ASCII before matching', async () => {
  const { p, fired } = setup();
  await p.handleTranscript(tr('a', '彩虹 rainbow✨'));
  assert.deepEqual(fired.map((f) => f.keyword), ['Rainbow']);
});
await check('hybrid engine: AI only when local finds nothing; via=openai', async () => {
  const { p, fired, aiCalls } = setup({ intentMatchingEngine: 'hybrid' }, async () => ['Magic']);
  await p.handleTranscript(tr('a', 'a rainbow'));
  assert.equal(aiCalls.length, 0);
  await p.handleTranscript(tr('b', 'abracadabra'));
  assert.equal(aiCalls.length, 1);
  await sleep(80);
  assert.deepEqual(fired.map((f) => [f.keyword, f.via]), [['Rainbow', 'local'], ['Magic', 'openai']]);
});
await check('openai engine: partials stay local, finals ask the AI', async () => {
  const { p, fired, aiCalls } = setup({ intentMatchingEngine: 'openai', triggerPolicy: { partialTriggerEnabled: true } }, async () => ['Party']);
  await p.handleTranscript(tr('a', 'time to', false));
  assert.equal(aiCalls.length, 0);
  await p.handleTranscript(tr('a', 'time to celebrate', true));
  assert.equal(aiCalls.length, 1);
  await sleep(20);
  assert.deepEqual(fired.map((f) => [f.keyword, f.via]), [['Party', 'openai']]);
});
await check('typed text: only with allowUserTriggers; speaker "typed"', async () => {
  const { p, fired, set } = setup();
  assert.deepEqual(await p.classifyTyped('a house'), []);
  set({ allowUserTriggers: true });
  assert.deepEqual(await p.classifyTyped('a house'), ['House']);
  assert.deepEqual(fired.map((f) => [f.keyword, f.speaker, f.via]), [['House', 'typed', 'local']]);
});
await check('fireTrigger: canonical names, unknown names pass through, same cooldown', async () => {
  const { p, fired } = setup();
  p.fire('rainbow');
  p.fire('Rainbow');
  p.fire('Fireworks');
  await sleep(80);
  assert.deepEqual(fired.map((f) => [f.keyword, f.speaker, f.via]), [['Rainbow', 'quick-action', 'manual'], ['Fireworks', 'quick-action', 'manual']]);
});
await check('queued duplicates are refused; dispose stops the queue', async () => {
  const { p, fired } = setup({ triggerPolicy: { dispatchIntervalMs: 100 } });
  p.fire('House');
  p.fire('Sleep');
  p.fire('Sleep', 'typed');
  p.dispose();
  await sleep(250);
  assert.deepEqual(fired.map((f) => f.keyword), ['House']);
});
await check('no keywords configured -> nothing fires from transcripts', async () => {
  const { p, fired } = setup({ localClassifier: { keywords: [] } });
  await p.handleTranscript(tr('a', 'rainbow'));
  assert.equal(fired.length, 0);
});

// ------------------------------------------------------------------ one firing per word per utterance
await check('growing partials of one utterance + its final fire each word once (partials on, real cooldown)', async () => {
  const { p, fired } = setup({ triggerPolicy: { partialTriggerEnabled: true, triggerCooldownMs: 3000 } });
  const words = "Let's dance and dance, it's a dance party!".split(' ');
  for (let i = 1; i <= words.length; i += 1) await p.handleTranscript(tr('u1', words.slice(0, i).join(' '), false));
  await p.handleTranscript(tr('u1', "Let's dance and dance, it's a dance party!", true));
  await sleep(200);
  assert.deepEqual(fired.map((f) => f.keyword), ['Dance', 'Party']);
});
await check('a late partial or a repeated final for a finished utterance never fires again', async () => {
  const { p, fired } = setup({ triggerPolicy: { partialTriggerEnabled: true, triggerCooldownMs: 0 } });
  await p.handleTranscript(tr('x', 'look a rainbow', true));
  await sleep(20);
  await p.handleTranscript(tr('x', 'look a rainbow', false));
  await p.handleTranscript(tr('x', 'look a rainbow!', true));
  await sleep(60);
  assert.deepEqual(fired.map((f) => f.keyword), ['Rainbow']);
});
await check('claim(): keywords the child already fired do not fire again from her answer', async () => {
  const { p, fired } = setup({ triggerPolicy: { triggerCooldownMs: 0 } });
  p.claim('bear-1', ['Dance']);
  await p.handleTranscript(tr('bear-1', "Let's dance under a rainbow!"));
  await sleep(80);
  assert.deepEqual(fired.map((f) => f.keyword), ['Rainbow']);
});

// ------------------------------------------------------------------ the local brain
const cls = (morph: boolean) => ({ ...defaultConfig().localClassifier, morphologyEnabled: morph });
await check('brain: no small-talk line contains a trigger word (morphology on and off); action lines say exactly theirs', async () => {
  for (const morph of [false, true]) {
    const c = cls(morph);
    for (const [intent, lines] of Object.entries(BRAIN_LINES.small)) {
      for (const l of lines) assert.deepEqual(extractKeywordMatches(l.replace('{name}', 'Sam'), c), [], `${intent}: "${l}" (morph ${morph})`);
    }
    for (const l of BRAIN_LINES.greetings) assert.deepEqual(extractKeywordMatches(l.replace('{name}', 'Sam'), c), [], l);
    for (const [k, lines] of Object.entries(BRAIN_LINES.actions)) {
      for (const l of lines) assert.deepEqual(extractKeywordMatches(l, c), [k], `${k}: "${l}" (morph ${morph})`);
    }
  }
});
await check('brain: requests make her SAY the trigger word; small talk says none', async () => {
  const c = cls(false);
  const b = new CheerBrain({ seed: 1 });
  const ask: Array<[string, string]> = [
    ['can you dance?', 'Dance'], ['show me your house', 'House'], ['make a rainbow', 'Rainbow'], ['do magic', 'Magic'],
    ['are you cold?', 'Cold'], ['go to sleep', 'Sleep'], ['wake up!', 'WakeUp'], ["let's have a party", 'Party'],
    ['wave to me', 'Wave'], ['can you run?', 'Running'], ['sparkle please', 'Sparkle'],
    // game-mode hint questions
    ['What do you see in the sky after it rains?', 'Rainbow'], ['How do you greet your friends?', 'Wave'],
    ['What does your home look like?', 'House'], ['Do you like to move to music?', 'Dance'], ['How do you stay warm?', 'Cold'],
    ['Do you like glittery things?', 'Sparkle'], ['Can you do anything magical?', 'Magic'], ['What do you do on birthdays?', 'Party'],
    ['Do you like to exercise?', 'Running'], ['What do you do in the morning?', 'WakeUp'],
  ];
  for (const [q, k] of ask) {
    const r = b.reply(q, c);
    if (k === 'WakeUp' || r.actions.includes('Sleep')) b.reply('wake up', c); // she falls asleep after Sleep
    assert.deepEqual(r.actions, [k], `"${q}" -> ${JSON.stringify(r)}`);
    assert.ok(extractKeywordMatches(r.text, c).includes(k), `"${q}" reply says ${k}: "${r.text}"`);
  }
  const talk = ['hi', 'hello cheer bear', 'how are you?', "what's your name?", 'where do you live?', 'tell me a joke',
    'I love you', 'thank you', 'I feel sad', "I'm happy", 'what is your favorite color?', 'what are care bears?', 'bye',
    'asdf qwerty', 'what is two plus two?', "I can't do it", 'yes', 'no'];
  const b2 = new CheerBrain({ seed: 2 });
  for (const q of talk) {
    const r = b2.reply(q, c);
    assert.deepEqual(r.actions, [], `"${q}" -> ${r.text}`);
    assert.deepEqual(extractKeywordMatches(r.text, c), [], `"${q}" reply fires nothing: "${r.text}"`);
  }
});
await check('brain: asks the first name once, remembers it, never repeats a line twice in a row', async () => {
  const c = cls(false);
  const b = new CheerBrain({ seed: 3 });
  assert.match(b.greeting(c), /what's your name/i);
  const r = b.reply('sam', c);
  assert.equal(b.name, 'Sam');
  assert.match(r.text, /Sam/);
  assert.match(b.reply('hello', c).text, /Sam/);
  const b2 = new CheerBrain({ seed: 4 });
  assert.equal(b2.reply('my name is Lily', c).intent, 'nameLearned');
  assert.equal(b2.name, 'Lily');
  b2.reply("I'm sad", c);
  assert.equal(b2.name, 'Lily', '"I\'m sad" is not a name');
  let prev = '';
  for (let i = 0; i < 12; i += 1) {
    const t = b2.reply('tell me a joke', c).text;
    assert.notEqual(t, prev, 'no immediate repeat');
    prev = t;
  }
  const d1 = b2.reply('dance', c).text;
  const d2 = b2.reply('dance', c).text;
  assert.notEqual(d1, d2);
});
await check('brain: kid-safe answers (unsafe, private details, rude words) fire nothing and never echo', async () => {
  const c = cls(false);
  const b = new CheerBrain({ seed: 5 });
  const s1 = b.reply('someone wants to hurt me', c);
  assert.equal(s1.intent, 'safety');
  assert.match(s1.text, /grown-up/);
  const s2 = b.reply('my phone number is 555 123 4567', c);
  assert.equal(s2.intent, 'private');
  assert.ok(!/555/.test(s2.text));
  const s3 = b.reply('you are stupid, dance', c);
  assert.equal(s3.intent, 'kind');
  assert.deepEqual(s3.actions, []);
  assert.equal(b.reply("don't dance", c).intent, 'stop');
  assert.equal(b.reply('my name is poop123', c).intent !== 'nameLearned' || b.name !== 'Poop123', true);
});
await check('brain: sleep then wake up; custom admin keywords; two requests at once', async () => {
  const c = cls(false);
  const b = new CheerBrain({ seed: 6 });
  assert.deepEqual(b.reply('go to sleep', c).actions, ['Sleep']);
  assert.equal(b.reply('what is your favorite color', c).intent, 'asleep');
  assert.deepEqual(b.reply('wake up', c).actions, ['WakeUp']);
  const custom = { ...c, keywords: [...c.keywords, 'Unicorn'] };
  const u = b.reply('can you show me a unicorn?', custom);
  assert.deepEqual(u.actions, ['Unicorn']);
  assert.deepEqual(extractKeywordMatches(u.text, custom), ['Unicorn']);
  const two = b.reply('dance and make a rainbow', c);
  assert.deepEqual(two.actions, ['Dance', 'Rainbow']);
  const removed = { ...c, keywords: c.keywords.filter((k) => k !== 'Dance') };
  const r = b.reply('can you dance', removed);
  assert.deepEqual(r.actions, [], 'a keyword the admin removed is not an action');
  assert.deepEqual(extractKeywordMatches(r.text, removed), []);
});

// ------------------------------------------------------------------ text -> visemes
await check('text visemes: natural timing, word char ranges, closures close, weights capped', async () => {
  const text = "Hi friend! Let's dance, Bob.";
  const tl = buildVisemeTimeline(text, { rate: 1 });
  assert.equal(tl.words.length, 5);
  const per = tl.duration / tl.words.length;
  assert.ok(per > 0.25 && per < 0.6, `about 100-240 words a minute (${per.toFixed(2)} s per word)`);
  assert.equal(text.slice(tl.words[2].charStart, tl.words[2].charEnd), "Let's");
  assert.equal(wordAtChar(tl, text.indexOf('dance')), 3);
  assert.ok(tl.words[2].t0 - tl.words[1].t1 > 0.25, 'a pause after "!"');
  const fast = buildVisemeTimeline(text, { rate: 2 });
  assert.ok(Math.abs(fast.duration * 2 - tl.duration) < 0.3, 'rate scales the timeline');
  let sawPP = false;
  let maxAmp = 0;
  const seen = new Set<string>();
  for (let t = 0; t <= tl.duration; t += 1 / 60) {
    const f = sampleTimeline(tl, t);
    const total = Object.values(f.weights).reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(total <= 1.0001, `total ${total} at ${t}`);
    for (const [k, v] of Object.entries(f.weights)) {
      assert.ok((VISEMES as readonly string[]).includes(k));
      if ((v ?? 0) > 0.3) seen.add(k);
    }
    if ((f.weights.PP ?? 0) > 0.6) {
      sawPP = true;
      assert.ok((f.weights.aa ?? 0) < 0.3, 'jaw/open vowel gives way during a lip closure');
    }
    maxAmp = Math.max(maxAmp, f.amplitude);
  }
  assert.ok(sawPP, 'Bob closes the lips');
  assert.ok(maxAmp > 0.5 && maxAmp <= 1);
  for (const v of ['aa', 'E', 'I', 'DD', 'nn', 'SS', 'PP', 'FF', 'RR']) assert.ok(seen.has(v), `uses ${v} (${[...seen]})`);
  assert.deepEqual(sampleTimeline(tl, tl.duration + 1).weights, {});
});
await check('voice choice: a friendly English voice, never a novelty or non-English one', async () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService, default: false });
  assert.equal(pickVoice([v('Albert', 'en-US'), v('Samantha', 'en-US'), v('Thomas', 'fr-FR')])?.name, 'Samantha');
  assert.equal(pickVoice([v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US')])?.name, 'Microsoft Zira - English (United States)');
  assert.equal(pickVoice([v('Google Deutsch', 'de-DE'), v('Google US English', 'en-US', false)])?.name, 'Google US English');
  assert.equal(pickVoice([v('Amélie', 'fr-CA')]), null);
});

// ------------------------------------------------------------------ speech recognition wrapper (fake recognition)
class FakeRec implements RecognitionLike {
  static all: FakeRec[] = [];
  continuous = false; interimResults = false; lang = ''; maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null; onstart: RecognitionLike['onstart'] = null;
  started = 0; aborted = 0;
  results: Array<{ isFinal: boolean; 0: { transcript: string } }> = [];
  constructor() { FakeRec.all.push(this); }
  start() { this.started += 1; setTimeout(() => this.onstart?.(), 1); }
  stop() { this.onend?.(); }
  abort() { this.aborted += 1; }
  say(text: string, isFinal: boolean, index = this.results.length - (this.results.at(-1)?.isFinal === false ? 1 : 0)) {
    this.results[index] = { isFinal, 0: { transcript: text } };
    this.onresult?.({ resultIndex: index, results: this.results });
  }
}
await check('speech input: continuous + interim, partials then a final, restart on end, mute pauses', async () => {
  FakeRec.all = [];
  const got: Array<[string, string, boolean]> = [];
  const states: string[] = [];
  const s = new SpeechInput({ onResult: (id, t, f) => got.push([id, t, f]), onState: (st) => states.push(st) }, () => new FakeRec());
  s.start();
  const r = FakeRec.all[0];
  assert.ok(r.continuous && r.interimResults && r.lang === 'en-US' && r.started === 1);
  await sleep(10);
  r.say('can you', false);
  r.say('can you dance', false);
  r.say('can you dance', true);
  assert.deepEqual(got.map((g) => [g[1], g[2]]), [['can you', false], ['can you dance', false], ['can you dance', true]]);
  assert.ok(got.every((g) => g[0] === got[0][0]), 'one id per utterance');
  r.say('hello', true);
  assert.notEqual(got[3][0], got[0][0], 'next utterance, new id');
  r.onend?.(); // the browser stops listening after a pause
  await sleep(300);
  assert.equal(FakeRec.all.length, 2, 'restarted');
  s.setPaused(true);
  assert.equal(FakeRec.all[1].aborted, 1);
  await sleep(300);
  assert.equal(FakeRec.all.length, 2, 'no restart while muted');
  s.setPaused(false);
  assert.equal(FakeRec.all.length, 3);
  assert.deepEqual(states.slice(0, 2), ['starting', 'live']);
  assert.ok(states.includes('paused'));
  s.stop();
  assert.equal(states.at(-1), 'off');
});
await check("speech input: ignores Happi's own voice; denied and unsupported are reported once, no loop", async () => {
  FakeRec.all = [];
  const got: string[] = [];
  const states: Array<[string, string | undefined]> = [];
  const s = new SpeechInput({ onResult: (_id, t) => got.push(t), onState: (st, m) => states.push([st, m]) }, () => new FakeRec());
  s.start();
  const r = FakeRec.all[0];
  s.setBearTalking(true);
  r.say("let's dance", false);
  s.setBearTalking(false);
  r.say("let's dance with me", true); // same utterance, started while she talked
  assert.deepEqual(got, []);
  await sleep(750);
  r.say('hi there', true);
  assert.deepEqual(got, ['hi there']);
  r.onerror?.({ error: 'not-allowed' });
  r.onend?.();
  await sleep(300);
  assert.equal(FakeRec.all.length, 1, 'no restart after a denial');
  assert.equal(states.at(-1)?.[0], 'denied');
  assert.match(states.at(-1)?.[1] || '', /type/);
  const states2: string[] = [];
  const none = new SpeechInput({ onResult: () => undefined, onState: (st) => states2.push(st) }, null);
  none.start();
  assert.deepEqual(states2, ['unsupported']);
  assert.equal(none.supported, false);
});

console.log(`voice logic: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);

// voice mode's command matcher (voice-3)
await import('./check-voice-commands');
