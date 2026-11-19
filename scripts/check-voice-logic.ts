// Checks for the browser trigger pipeline (src/voice/triggerPipeline.ts), run in Node. npx tsx scripts/check-voice-logic.ts
import assert from 'node:assert/strict';
import { TriggerPipeline } from '../src/voice/triggerPipeline';
import { applyConfigPatch, defaultConfig, type AppConfig } from '../src/shared/config';
import type { TriggerEvent } from '../src/shared/contracts';

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
await check("Cheer Bear's final transcript fires its keywords, spaced by dispatchIntervalMs", async () => {
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

console.log(`voice logic: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
