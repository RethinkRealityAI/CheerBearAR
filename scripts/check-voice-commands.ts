// Checks for voice mode's command matcher (src/voice/commands.ts), run in Node:
//   npx tsx scripts/check-voice-commands.ts   (also run by `npm run test:server` through check-voice-logic.ts)
import assert from 'node:assert/strict';
import { applyConfigPatch, defaultConfig } from '../src/shared/config';
import { CommandTracker, exampleCommands, matchVoiceCommands, normalizeSpeech, resolveCapture, type VoiceMatch } from '../src/voice/commands';
import { pickReply, REPLY_LINES } from '../src/voice/voiceReplies';
import { extractKeywordMatches } from '../src/shared/classifier';
import { HoldListener, type HoldResult } from '../src/voice/holdToTalk';
import { VoiceMode } from '../src/voice/voiceMode';
import type { RecognitionLike } from '../src/voice/speechInput';

/** A fake SpeechRecognition: `say(text, final)` grows the current utterance; stop() delivers the final then end. */
class FakeRec implements RecognitionLike {
  static all: FakeRec[] = [];
  continuous = false; interimResults = false; lang = ''; maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null; onstart: RecognitionLike['onstart'] = null; onaudiostart: (() => void) | null = null;
  started = false; stopped = false; aborted = false; text = '';
  constructor() { FakeRec.all.push(this); }
  start() { this.started = true; queueMicrotask(() => { this.onstart?.(); this.onaudiostart?.(); }); }
  stop() { this.stopped = true; setTimeout(() => { if (this.text) this.emit(true); this.onend?.(); }, 20); }
  abort() { this.aborted = true; }
  say(text: string) { this.text = text; this.emit(false); }
  private emit(final: boolean) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: this.text } }] }); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

const cfg = defaultConfig();
const lc = cfg.localClassifier;
const ids = (text: string, c = lc) => matchVoiceCommands(text, c).map((m) => m.id);
const desc = (m: VoiceMatch) => m.id;

console.log('voice mode commands');
check('normalises recognition noise', () => {
  assert.deepEqual(normalizeSpeech('Go to 3-D!'), ['go', 'to', '3d']);
  assert.deepEqual(normalizeSpeech('three D'), ['3d']);
  assert.deepEqual(normalizeSpeech('A.R. please'), ['ar', 'please']);
  assert.deepEqual(normalizeSpeech('go to a r'), ['go', 'to', 'ar']);
  assert.deepEqual(normalizeSpeech('Hi Share Bear'), ['hi', 'cheer', 'bear']);
  assert.deepEqual(normalizeSpeech('hello cheer bare'), ['hello', 'cheer', 'bear']);
  assert.deepEqual(normalizeSpeech("Don't  dance."), ['dont', 'dance']);
  assert.deepEqual(normalizeSpeech('rain bow'), ['rainbow']);
});
check('every default trigger word and its synonyms', () => {
  assert.deepEqual(ids('rainbow'), ['trigger:rainbow']);
  assert.deepEqual(ids('Make a RAINBOW!'), ['trigger:rainbow']);
  assert.deepEqual(ids('rainbows'), ['trigger:rainbow']);
  assert.deepEqual(ids('can you dance'), ['trigger:dance']);
  assert.deepEqual(ids('show me your home'), ['trigger:house']);
  assert.deepEqual(ids('wake up'), ['trigger:wakeup']);
  assert.deepEqual(ids('time to sleep'), ['trigger:sleep']);
  assert.deepEqual(ids('do the care bear stare'), ['trigger:stare']);
  assert.deepEqual(ids('cheer bear stare'), ['trigger:stare']);
  assert.deepEqual(ids("it's freezing"), ['trigger:cold']);
  assert.deepEqual(ids('party and sparkle'), ['trigger:party', 'trigger:sparkle']);
  for (const k of lc.keywords) assert.ok(ids(k).includes(`trigger:${k.toLowerCase()}`), k);
});
check('whole words only: no partial words, no lookalikes', () => {
  assert.deepEqual(ids('rain'), []);
  assert.deepEqual(ids('dancer'), []);
  assert.deepEqual(ids('the magician'), []);
  assert.deepEqual(ids('housework'), []);
  assert.deepEqual(ids('are you there'), []);
  assert.deepEqual(ids('i like art'), []);
  assert.deepEqual(ids('highway'), []);
});
check("negation: don't dance / stop dancing / no rainbow fire nothing", () => {
  assert.deepEqual(ids("don't dance"), []);
  assert.deepEqual(ids('do not dance'), []);
  assert.deepEqual(ids('stop dancing'), []);
  assert.deepEqual(ids('no more rainbow'), []);
  assert.deepEqual(ids("don't dance, do a rainbow"), ['trigger:rainbow']);
});
check('modes', () => {
  assert.deepEqual(ids('3D'), ['mode:showcase']);
  assert.deepEqual(ids('go to three d'), ['mode:showcase']);
  assert.deepEqual(ids('back to the 3d view'), ['mode:showcase']);
  assert.deepEqual(ids('go to AR'), ['mode:ar']);
  assert.deepEqual(ids('a r'), ['mode:ar']);
  assert.deepEqual(ids('augmented reality'), ['mode:ar']);
  assert.deepEqual(ids('put her in my room'), ['mode:ar']);
  assert.deepEqual(ids('bring cheer bear into my bedroom'), ['mode:ar']);
  assert.deepEqual(ids('selfie'), ['mode:face']);
  assert.deepEqual(ids('selfie mode please'), ['mode:face']);
  assert.deepEqual(ids('3D photo'), ['mode:photo']);
  assert.deepEqual(ids('photo mode'), ['mode:photo']);
  assert.deepEqual(ids('go to photo'), ['mode:photo']);
  assert.deepEqual(ids('switch to picture mode'), ['mode:photo']);
  assert.deepEqual(ids('three d photo please'), ['mode:photo']);
  const sel = matchVoiceCommands('take a selfie', lc)[0];
  assert.equal(sel.id, 'mode:face');
  assert.deepEqual(sel.command, { kind: 'mode', mode: 'face', orCapture: true });
  assert.deepEqual(matchVoiceCommands('take a 3d photo', lc)[0].command, { kind: 'mode', mode: 'photo', orCapture: true });
});
check('bare "photo" / "picture": shutter where there is one, else 3D Photo', () => {
  for (const said of ['photo', 'Picture!', 'a photo please', 'pic', 'another picture']) {
    const ms = matchVoiceCommands(said, lc);
    assert.equal(ms.length, 1, said);
    assert.deepEqual(ms[0].command, { kind: 'command', name: 'capture', orMode: 'photo' }, said);
  }
  // with a shutter on screen it is the shutter
  assert.deepEqual(resolveCapture('face', 'photo'), { capture: true });
  assert.deepEqual(resolveCapture('photo', 'photo'), { capture: true });
  assert.deepEqual(resolveCapture('ar', 'photo', true), { capture: true }, 'AR once it shows a shutter');
  // without one it switches to 3D Photo
  assert.deepEqual(resolveCapture('showcase', 'photo'), { mode: 'photo' });
  assert.deepEqual(resolveCapture('ar', 'photo'), { mode: 'photo' });
  // "take a picture" / "cheese" without a shutter still go to Selfie
  assert.deepEqual(resolveCapture('showcase', undefined), { mode: 'face' });
  // "3D photo" / "photo mode" always switch, even in Selfie (they are mode commands, not capture)
  assert.deepEqual(matchVoiceCommands('3d photo', lc)[0].command, { kind: 'mode', mode: 'photo' });
  assert.deepEqual(matchVoiceCommands('photo mode', lc)[0].command, { kind: 'mode', mode: 'photo' });
  // a hold that grows "photo" -> "photo mode" switches, it does not also press the shutter
  const t = new CommandTracker(() => lc);
  assert.deepEqual(t.update('photo', false).map(desc), [], 'bare photo waits while still talking');
  assert.deepEqual(t.update('photo mode', false).map(desc), ['mode:photo']);
  assert.deepEqual(t.finish().map(desc), []);
  const t2 = new CommandTracker(() => lc);
  assert.deepEqual(t2.update('photo', false).map(desc), []);
  assert.deepEqual(t2.finish().map(desc), ['command:capture'], 'let go after "photo": it counts');
});
check('camera commands: capture, place, move', () => {
  assert.deepEqual(ids('take a picture'), ['command:capture']);
  assert.deepEqual(ids('take a photo'), ['command:capture'], 'a photo is the shutter, not Photo mode');
  assert.deepEqual(ids('take our picture'), ['command:capture']);
  assert.deepEqual(ids('cheese'), ['command:capture']);
  assert.deepEqual(ids('say cheese!'), ['command:capture']);
  assert.deepEqual(ids('place'), ['command:place']);
  assert.deepEqual(ids('put her here'), ['command:place']);
  assert.deepEqual(ids('place cheer bear here'), ['command:place']);
  assert.deepEqual(ids('move'), ['command:move']);
  assert.deepEqual(ids('move her'), ['command:move']);
  assert.deepEqual(ids('can you move your arms'), [], '"move" inside a sentence is not the Move button');
  assert.deepEqual(ids('put on a show'), []);
});
check('games', () => {
  assert.deepEqual(ids('play heart run'), ['play:heart-run']);
  assert.deepEqual(ids("let's play hard run"), ['play:heart-run'], 'mishearing');
  assert.deepEqual(ids('heart run'), ['play:heart-run']);
  assert.deepEqual(ids('play heart hoops'), ['play:heart-hoops']);
  assert.deepEqual(ids('art hoops'), ['play:heart-hoops']);
  assert.deepEqual(ids('stop the game'), ['stopPlay']);
  assert.deepEqual(ids('stop'), ['stopPlay']);
  assert.deepEqual(ids('pause'), ['command:pause']);
  assert.deepEqual(ids('keep going'), ['command:resume']);
  assert.deepEqual(ids('again'), ['command:again']);
  assert.deepEqual(ids('play again'), ['command:again']);
  assert.deepEqual(ids('one more time'), ['command:again']);
  assert.ok(!ids('play heart run').includes('trigger:running'), 'the game, not the Running moment');
});
check('fun: hello at the start waves, I love you hugs', () => {
  assert.deepEqual(ids('hello'), ['trigger:wave']);
  assert.deepEqual(ids('hi cheer bear'), ['trigger:wave']);
  assert.deepEqual(ids('hi share bear, can you dance'), ['trigger:wave', 'trigger:dance']);
  assert.deepEqual(ids('i said hi'), [], 'hi only at the start');
  assert.deepEqual(ids('I love you'), ['command:hug']);
  assert.deepEqual(ids('i love you cheer bear'), ['command:hug']);
  assert.deepEqual(ids('give me a hug'), ['command:hug']);
  assert.deepEqual(ids('i love rainbows'), ['trigger:rainbow']);
});
check('several commands in one breath, in order, each once', () => {
  assert.deepEqual(ids('make a rainbow and then dance'), ['trigger:rainbow', 'trigger:dance']);
  assert.deepEqual(ids('dance dance dance'), ['trigger:dance']);
  assert.deepEqual(ids('go to ar and make it sparkle'), ['mode:ar', 'trigger:sparkle']);
  assert.deepEqual(matchVoiceCommands('dance then rainbow', lc).map(desc), ['trigger:dance', 'trigger:rainbow']);
});
check('admin-edited keywords and synonyms work at once; removed ones stop', () => {
  const c = applyConfigPatch(defaultConfig(), {
    localClassifier: { keywords: [...lc.keywords.filter((k) => k !== 'Dance'), 'Unicorn'], synonyms: { ...lc.synonyms, unicorn: ['pony', 'magic horse'] } },
  }).localClassifier;
  assert.deepEqual(ids('unicorn', c), ['trigger:unicorn']);
  assert.deepEqual(ids('a magic horse', c), ['trigger:unicorn'], 'longest phrase wins over Magic');
  assert.deepEqual(ids('pony', c), ['trigger:unicorn']);
  assert.deepEqual(ids('dance', c), []);
  const morph = applyConfigPatch(defaultConfig(), { localClassifier: { morphologyEnabled: true } }).localClassifier;
  assert.deepEqual(ids('sparkling', morph), ['trigger:sparkle']);
});
check('tracker: interim fires fast, once per hold (dedupe with the final)', () => {
  const t = new CommandTracker(() => lc);
  assert.deepEqual(t.update('make a', false).map(desc), []);
  assert.deepEqual(t.update('make a rainbow', false).map(desc), ['trigger:rainbow'], 'interim fires straight away');
  assert.deepEqual(t.update('make a rainbow', false).map(desc), [], 'same interim again: nothing');
  assert.deepEqual(t.update('make a rainbow and', false).map(desc), []);
  assert.deepEqual(t.update('make a rainbow and dance', true).map(desc), ['trigger:dance'], 'final adds only the new one');
  assert.deepEqual(t.finish().map(desc), []);
});
check('tracker: a short last word waits (hi -> hide, ar -> art) until the next result or the release', () => {
  const t = new CommandTracker(() => lc);
  assert.deepEqual(t.update('hi', false).map(desc), [], '"hi" may still grow');
  assert.deepEqual(t.update('hide and seek', false).map(desc), [], 'it grew: no wave');
  const t2 = new CommandTracker(() => lc);
  assert.deepEqual(t2.update('go to ar', false).map(desc), []);
  assert.deepEqual(t2.finish().map(desc), ['mode:ar'], 'the release accepts it');
  const t3 = new CommandTracker(() => lc);
  assert.deepEqual(t3.update('hi cheer bear', false).map(desc), ['trigger:wave'], 'not the last word: fires');
});
check('replies never contain a trigger word (default config) and fit the command', () => {
  for (const [key, lines] of Object.entries(REPLY_LINES)) {
    for (const line of lines) assert.deepEqual(extractKeywordMatches(line, { ...lc, morphologyEnabled: true }), [], `${key}: "${line}"`);
  }
  const r = pickReply({ kind: 'trigger', keyword: 'House' }, lc);
  assert.ok(r && !/house|home/i.test(r), String(r));
  assert.ok(pickReply({ kind: 'mode', mode: 'ar' }, lc));
});
check('replies: a line that would match an admin keyword is skipped', () => {
  const c = applyConfigPatch(defaultConfig(), { localClassifier: { keywords: [...lc.keywords, 'Look', 'Watch', 'Here', 'Yay', 'Wow', 'Ooh', 'Ta'] } }).localClassifier;
  for (let i = 0; i < 30; i += 1) {
    const r = pickReply({ kind: 'trigger', keyword: 'Rainbow' }, c);
    if (r) assert.deepEqual(extractKeywordMatches(r, c), [], r);
  }
});
check('examples come from the live keywords', () => {
  assert.deepEqual(exampleCommands(lc.keywords).map((e) => e.label), ['Rainbow', 'Dance', 'Go to 3D']);
  assert.deepEqual(exampleCommands(['Unicorn', 'WakeUp']).map((e) => e.say), ['unicorn', 'wake up', 'go to 3d']);
});


// ---- the hold itself (fake recognition, no meter)
async function acheck(name: string, fn: () => Promise<void>) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); } catch (err) {
    failed += 1; console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`); process.exitCode = 1;
  }
}
function voiceMode(factory: (() => RecognitionLike) | null = () => new FakeRec()) {
  const fired: string[] = [];
  const said: string[] = [];
  const phases: Array<[string, string]> = [];
  const done: HoldResult[] = [];
  const states: string[] = [];
  const vm = new VoiceMode({
    getConfig: () => cfg, fireTrigger: (k) => fired.push(k), say: (l) => said.push(l), hush: () => undefined, unlock: () => undefined,
    factory, meter: null,
  });
  vm.on('commands', ({ matches, phase }) => { for (const m of matches) { phases.push([m.id, phase]); if (m.command.kind === 'trigger') vm.fireTrigger(m.command.keyword); } });
  vm.on('done', (r) => done.push(r));
  vm.on('state', ({ state }) => states.push(state));
  return { vm, fired, said, phases, done, states };
}
await acheck('hold: interim "rainbow" fires Rainbow once; the final does not fire it again', async () => {
  FakeRec.all = [];
  const t = voiceMode();
  assert.equal(t.vm.press(), true);
  const r = FakeRec.all[0];
  assert.equal(r.continuous, true); assert.equal(r.interimResults, true);
  await sleep(5);
  assert.equal(t.vm.state, 'listening');
  r.say('make a');
  r.say('make a rainbow');
  r.say('make a rainbow please');
  assert.deepEqual(t.fired, ['Rainbow'], 'fired from the interim, while still held');
  t.vm.release();
  assert.equal(r.stopped, true);
  await sleep(60);
  assert.deepEqual(t.fired, ['Rainbow'], 'final deduped');
  assert.equal(t.done.length, 1);
  assert.equal(t.done[0].text, 'make a rainbow please');
  assert.deepEqual(t.phases, [['trigger:rainbow', 'interim']]);
});
await acheck('hold: a camera mode said on a short last word is handed over IN the release (phase "release")', async () => {
  FakeRec.all = [];
  const t = voiceMode();
  t.vm.press();
  await sleep(5);
  FakeRec.all[0].say('go to ar');
  assert.deepEqual(t.phases, []);
  t.vm.release();
  assert.deepEqual(t.phases, [['mode:ar', 'release']], 'synchronously inside release()');
  await sleep(60);
  assert.deepEqual(t.phases, [['mode:ar', 'release']]);
});
await acheck('hold: words only in the final (after the release) come as phase "final"', async () => {
  FakeRec.all = [];
  const t = voiceMode();
  t.vm.press();
  await sleep(5);
  const r = FakeRec.all[0];
  t.vm.release();
  r.text = 'take a picture';
  await sleep(60);
  assert.deepEqual(t.phases, [['command:capture', 'final']]);
});
await acheck('hold: unsupported browser -> press() is false and says so; denied -> blocked for the session', async () => {
  const t = voiceMode(null);
  assert.equal(t.vm.supported, false);
  assert.equal(t.vm.press(), false);
  assert.equal(t.vm.unavailable, 'unsupported');
  assert.deepEqual(t.states, ['unsupported']);
  FakeRec.all = [];
  const d = voiceMode();
  d.vm.press();
  await sleep(5);
  FakeRec.all[0].onerror?.({ error: 'not-allowed' });
  assert.equal(d.vm.unavailable, 'denied');
  assert.equal(d.states.at(-1), 'denied');
  assert.equal(d.vm.press(), false, 'no second prompt loop');
  assert.equal(FakeRec.all.length, 1);
});
await acheck('hold: cancel() (a quick tap) aborts without a result', async () => {
  FakeRec.all = [];
  const t = voiceMode();
  t.vm.press();
  t.vm.cancel();
  await sleep(30);
  assert.equal(FakeRec.all[0].aborted, true);
  assert.equal(t.done.length, 0);
  assert.equal(t.vm.state, 'idle');
});
await acheck('tap-to-talk: a pause after a finished phrase stops by itself', async () => {
  FakeRec.all = [];
  const got: HoldResult[] = [];
  const h = new HoldListener({ onText: () => undefined, onState: () => undefined, onDone: (r) => got.push(r) }, () => new FakeRec(), { meter: null });
  h.press({ auto: true });
  await sleep(5);
  const r = FakeRec.all[0];
  r.text = 'dance';
  r.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'dance' } }] });
  await sleep(1000);
  assert.equal(r.stopped, true);
  await sleep(60);
  assert.equal(got.length, 1);
  assert.equal(got[0].reason, 'auto');
});
await acheck('reply: one line per command, spoken only when asked', async () => {
  const t = voiceMode();
  const line = t.vm.reply({ kind: 'mode', mode: 'ar' }, true);
  assert.ok(line);
  assert.deepEqual(t.said, [line]);
  t.vm.reply({ kind: 'trigger', keyword: 'Dance' }, false);
  assert.equal(t.said.length, 1);
});

console.log(`voice commands: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
