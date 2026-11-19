// Unit-style checks for the keyword classifier (src/shared/classifier.ts). Run: npx tsx scripts/check-classifier.ts
import assert from 'node:assert/strict';
import {
  canonicalKeyword,
  extractKeywordMatches,
  normalizeToken,
  resolveIntents,
  sanitizeEnglishText,
  testPhrase,
  tokenizeForMatching,
} from '../src/shared/classifier';
import { DEFAULT_CONFIG, type LocalClassifier } from '../src/shared/config';

const cls: LocalClassifier = DEFAULT_CONFIG.localClassifier;
let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

console.log('classifier');
await check('normalizeToken strips punctuation and case', () => {
  assert.equal(normalizeToken('Wake-Up!'), 'wakeup');
  assert.equal(normalizeToken('  Rain bow '), 'rainbow');
});
await check('tokenize gives words, bigrams and the whole phrase', () => {
  const t = tokenizeForMatching('Time to wake up');
  for (const x of ['time', 'to', 'wake', 'up', 'wakeup', 'timetowakeup']) assert.ok(t.includes(x), x);
});
await check('every core keyword matches itself, case-insensitively', () => {
  for (const k of cls.keywords) assert.deepEqual(extractKeywordMatches(`I love ${k.toLowerCase()} so much`, cls), [k], k);
});
await check('synonyms map to their keyword', () => {
  assert.deepEqual(extractKeywordMatches("Let's go home now", cls), ['House']);
  assert.deepEqual(extractKeywordMatches('It is freezing outside', cls), ['Cold']);
  assert.deepEqual(extractKeywordMatches('we should celebrate!', cls), ['Party']);
  assert.deepEqual(extractKeywordMatches('so much glitter', cls), ['Sparkle']);
});
await check('two-word synonyms match through bigrams ("wake up")', () => {
  assert.deepEqual(extractKeywordMatches('Time to wake up, sleepyhead', cls), ['WakeUp']);
  assert.deepEqual(extractKeywordMatches('time to WAKE-UP', cls), ['WakeUp']);
});
await check('several keywords in one sentence, each once', () => {
  const m = extractKeywordMatches('Dance at the party, then dance under the rainbow!', cls);
  assert.deepEqual(new Set(m), new Set(['Dance', 'Party', 'Rainbow']));
  assert.equal(m.length, 3);
});
await check('punctuation does not hide a keyword', () => {
  assert.deepEqual(extractKeywordMatches('Magic! Magic? magic.', cls), ['Magic']);
});
await check('no false positive on substrings (housework, waveform, coldplay)', () => {
  assert.deepEqual(extractKeywordMatches('housework and a waveform from coldplay', cls), []);
});
await check('morphology off: "danced" only matches via the synonym list; "partying" via synonyms', () => {
  assert.deepEqual(extractKeywordMatches('she danced', cls), ['Dance']);
  assert.deepEqual(extractKeywordMatches('we were partying', cls), ['Party']);
  assert.deepEqual(extractKeywordMatches('it was magicked', cls), []);
});
await check('morphology on adds inflections (magicked is not one; sparkled is)', () => {
  const morph = { ...cls, morphologyEnabled: true };
  assert.deepEqual(extractKeywordMatches('it sparkled', morph), ['Sparkle']);
  assert.deepEqual(extractKeywordMatches('she was waving and they partied', morph), ['Wave', 'Party']);
});
await check('admin-defined keyword with its own synonyms', () => {
  const custom = { ...cls, keywords: [...cls.keywords, 'Unicorn'], synonyms: { ...cls.synonyms, unicorn: ['unicorns', 'pegasus'] } };
  assert.deepEqual(extractKeywordMatches('look, a pegasus!', custom), ['Unicorn']);
});
await check('multi-word admin keyword ("Shooting Star") matches as a phrase', () => {
  const custom = { ...cls, keywords: ['Shooting Star'], synonyms: {} };
  assert.deepEqual(extractKeywordMatches('I saw a shooting star tonight', custom), ['Shooting Star']);
  assert.deepEqual(extractKeywordMatches('I saw a star', custom), []);
});
await check('matcher cache refreshes when keywords change', () => {
  assert.deepEqual(extractKeywordMatches('pizza', { ...cls, keywords: ['Pizza'], synonyms: {} }), ['Pizza']);
  assert.deepEqual(extractKeywordMatches('pizza', cls), []);
});
await check('testPhrase reports token details', () => {
  const r = testPhrase('a rainbow party', cls);
  assert.deepEqual(new Set(r.matches), new Set(['Rainbow', 'Party']));
  assert.ok(r.details.some((d) => d.token === 'rainbow' && d.matchedKeyword === 'Rainbow'));
});
await check('sanitizeEnglishText strips non-ASCII', () => {
  assert.equal(sanitizeEnglishText('Hello 你好 rainbow  ✨'), 'Hello rainbow');
});
await check('canonicalKeyword maps AI answers back to configured keywords', () => {
  assert.equal(canonicalKeyword('rainbow', cls.keywords), 'Rainbow');
  assert.equal(canonicalKeyword('Wake Up', cls.keywords), 'WakeUp');
  assert.equal(canonicalKeyword('Rainbows', cls.keywords), 'Rainbow');
  assert.equal(canonicalKeyword('Unicorn', cls.keywords), null);
});
await check('engine local never calls the AI', async () => {
  let called = false;
  const r = await resolveIntents('nothing here', cls, 'local', async () => ((called = true), ['Magic']));
  assert.deepEqual(r, []);
  assert.equal(called, false);
});
await check('engine hybrid: local first, AI only when local finds nothing', async () => {
  let calls = 0;
  const ai = async () => ((calls += 1), ['Magic']);
  assert.deepEqual(await resolveIntents('a rainbow', cls, 'hybrid', ai), [{ keyword: 'Rainbow', via: 'local' }]);
  assert.equal(calls, 0);
  assert.deepEqual(await resolveIntents('abracadabra', cls, 'hybrid', ai), [{ keyword: 'Magic', via: 'openai' }]);
  assert.equal(calls, 1);
});
await check('engine openai: AI first, then extra local matches, deduped', async () => {
  const r = await resolveIntents('rainbow party time', cls, 'openai', async () => ['Rainbow']);
  assert.deepEqual(r, [{ keyword: 'Rainbow', via: 'openai' }, { keyword: 'Party', via: 'local' }]);
  const empty = await resolveIntents('rainbow', cls, 'openai', async () => []);
  assert.deepEqual(empty, [{ keyword: 'Rainbow', via: 'local' }]);
});
await check('a failing AI falls back to nothing (hybrid) / local (openai) instead of throwing', async () => {
  const boom = async () => { throw new Error('network'); };
  assert.deepEqual(await resolveIntents('abracadabra', cls, 'hybrid', boom), []);
  assert.deepEqual(await resolveIntents('magic', cls, 'openai', boom), [{ keyword: 'Magic', via: 'local' }]);
});

console.log(`classifier: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
