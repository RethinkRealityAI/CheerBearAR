// Voice-4: every way hold-to-talk can fail to hear, reproduced with a fake SpeechRecognition that behaves like the
// browsers do (Android ending early, no interim results, late finals, each error code, a second mic stream making the
// recogniser deaf), and the message + recovery each one gets. Run in Node:
//   npx tsx scripts/check-voice-hold.ts   (also run by `npm run test:server` via check-voice-commands.ts)
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/shared/config';
import { HoldListener, foldRepeat, type HoldResult, type MeterLike, type MicPermission } from '../src/voice/holdToTalk';
import { VoiceMode } from '../src/voice/voiceMode';
import { problemHelp, voicePlatform, type HoldProblem } from '../src/voice/voiceHelp';
import { clearVoiceLog, formatVoiceLog, voiceLogEntries } from '../src/voice/voiceLog';
import type { RecognitionLike } from '../src/voice/speechInput';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shared "hardware": is a getUserMedia stream open right now (the level meter)? */
const mic = { open: 0, gum: 0 };

interface SimOpts {
  /** ms from start() to onstart/onaudiostart (a permission prompt makes this long). */
  startDelay: number;
  /** Only finals, and only after stop() (some Android recognisers). */
  noInterim: boolean;
  /** ms from stop() to the final result + end. */
  finalDelay: number;
  /** Android: while another capture holds the mic the recogniser hears silence. */
  deafWhenMicOpen: boolean;
  /** start() throws this (InvalidStateError...). */
  startThrows: string;
  /** Error code fired right after the start (then end, like Chrome). */
  errorOnStart: string;
}
const DEFAULT: SimOpts = { startDelay: 5, noInterim: false, finalDelay: 20, deafWhenMicOpen: true, startThrows: '', errorOnStart: '' };

class SimRec implements RecognitionLike {
  static all: SimRec[] = [];
  static opts: SimOpts = { ...DEFAULT };
  continuous = false; interimResults = false; lang = ''; maxAlternatives = 1;
  onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null; onstart: RecognitionLike['onstart'] = null;
  onaudiostart: (() => void) | null = null; onsoundstart: (() => void) | null = null; onspeechstart: (() => void) | null = null;
  started = false; stopped = false; aborted = false; text = ''; ended = false;
  opts = { ...SimRec.opts };
  constructor() { SimRec.all.push(this); }
  start() {
    if (this.opts.startThrows) { const e = new Error('already started'); e.name = this.opts.startThrows; throw e; }
    this.started = true;
    setTimeout(() => {
      if (this.aborted) return;
      this.onstart?.(); this.onaudiostart?.();
      if (this.opts.errorOnStart) { this.onerror?.({ error: this.opts.errorOnStart }); this.end(); }
    }, this.opts.startDelay);
  }
  stop() { this.stopped = true; setTimeout(() => { if (this.aborted) return; if (this.text) this.emit(true); this.end(); }, this.opts.finalDelay); }
  abort() { this.aborted = true; }
  /** The child says something. */
  say(text: string) {
    if (this.opts.deafWhenMicOpen && mic.open > 0) return; // the recogniser gets silence
    this.onsoundstart?.(); this.onspeechstart?.();
    this.text = text;
    if (!this.opts.noInterim) this.emit(false);
  }
  /** The browser ends recognition by itself (Android after a pause). */
  end() { if (this.ended) return; this.ended = true; this.onend?.(); }
  fail(code: string) { this.onerror?.({ error: code }); this.end(); }
  emit(final: boolean) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: this.text } }] }); }
}
const last = () => SimRec.all[SimRec.all.length - 1];

/** The round-3 level meter: a second getUserMedia stream for as long as it runs. */
class SimMeter implements MeterLike {
  live = false;
  async start() { mic.gum += 1; mic.open += 1; this.live = true; return true; }
  stop() { if (this.live) mic.open -= 1; this.live = false; }
}

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  SimRec.all = []; SimRec.opts = { ...DEFAULT }; mic.open = 0; mic.gum = 0;
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`); process.exitCode = 1;
  }
}

const cfg = defaultConfig();
const ANDROID = voicePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36' });
const IOS = voicePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' });

function vmode(o: { perm?: MicPermission; meter?: MeterLike | null; platform?: typeof ANDROID } = {}) {
  const calls: string[] = [];
  const done: Array<HoldResult & { matched: number; help: ReturnType<typeof problemHelp> | null }> = [];
  const fired: string[] = [];
  let permCb: (p: MicPermission) => void = () => undefined;
  const vm = new VoiceMode({
    getConfig: () => cfg,
    fireTrigger: (k) => fired.push(k),
    say: () => undefined,
    hush: () => calls.push('hush'),
    unlock: () => calls.push('unlock'),
    factory: () => { calls.push('new'); return new SimRec(); },
    meter: o.meter ?? null,
    permission: async () => o.perm ?? 'granted',
    watchPermission: (cb) => { permCb = cb; cb(o.perm ?? 'granted'); return () => undefined; },
    platform: o.platform ?? ANDROID,
  });
  vm.on('commands', ({ matches }) => { for (const m of matches) if (m.command.kind === 'trigger') vm.fireTrigger(m.command.keyword); });
  vm.on('done', (r) => done.push(r));
  return { vm, calls, done, fired, setPerm: (p: MicPermission) => permCb(p) };
}

console.log('voice hold-to-talk: listening failure modes');

await check('start() runs synchronously inside press(); her voice is hushed first; the speech unlock waits for the release', () => {
  const t = vmode();
  assert.equal(t.vm.press(), true);
  assert.equal(last().started, true, 'start() already called when press() returns (iOS gesture rule)');
  assert.deepEqual(t.calls, ['hush', 'new'], 'hush before the recogniser, no speechSynthesis unlock in the press');
  t.vm.release();
  assert.ok(t.calls.indexOf('unlock') > t.calls.indexOf('new'), 'unlock in the release');
});

await check('no second microphone stream by default (Node has no ?voicemeter): getUserMedia is never called while listening', async () => {
  let gum = 0;
  const g = globalThis as { navigator?: unknown };
  const nav = g.navigator as Record<string, unknown> | undefined;
  const md = { getUserMedia: async () => { gum += 1; throw new Error('should not be called'); } };
  try { Object.defineProperty(nav ?? {}, 'mediaDevices', { value: md, configurable: true }); } catch { /* ignore */ }
  const got: HoldResult[] = [];
  const h = new HoldListener({ onText: () => undefined, onState: () => undefined, onDone: (r) => got.push(r), onLevel: () => undefined }, () => new SimRec());
  h.press();
  await sleep(20);
  last().say('make a rainbow');
  h.release();
  await sleep(60);
  assert.equal(gum, 0, 'getUserMedia calls during a hold');
  assert.equal(got[0].text, 'make a rainbow');
});

await check('REPRODUCES Dapo: with the old level meter (2nd mic stream) Android hears nothing -> "didn\'t hear"; without it the words come through', async () => {
  const old = vmode({ meter: new SimMeter() });
  old.vm.press();
  await sleep(20);
  assert.equal(mic.open, 1, 'the meter holds the mic');
  last().say('rainbow');
  await sleep(10);
  old.vm.release();
  await sleep(60);
  assert.equal(old.done[0].text, '');
  assert.equal(old.done[0].problem, 'no-speech');
  assert.match(old.done[0].help!.text, /didn’t hear/);
  assert.deepEqual(old.fired, []);
  SimRec.all = []; mic.open = 0;
  const now = vmode(); // the fixed default: no meter
  now.vm.press();
  await sleep(20);
  last().say('rainbow');
  now.vm.release();
  await sleep(60);
  assert.equal(now.done[0].text, 'rainbow');
  assert.deepEqual(now.fired, ['Rainbow']);
  assert.equal(now.done[0].help, null);
});

await check('Android ends recognition after a pause while still held: a fresh recogniser restarts, the words after the pause count', async () => {
  const t = vmode();
  t.vm.press();
  await sleep(20);
  const first = last();
  first.fail('no-speech'); // the child thinks before speaking; Android gives up after ~1.5 s
  await sleep(20);
  assert.equal(t.done.length, 0, 'no "didn\'t hear you" while still holding');
  assert.equal(SimRec.all.length, 2, 'a NEW recogniser, not the stale one');
  assert.equal(first.onresult, null, 'the old one is unhooked');
  last().say('dance');
  t.vm.release();
  await sleep(60);
  assert.equal(t.done[0].text, 'dance');
  assert.equal(t.done[0].restarts, 1);
  assert.deepEqual(t.fired, ['Dance']);
});

await check('words before an early end are kept across the restart ("make a" ... "rainbow")', async () => {
  const t = vmode();
  t.vm.press();
  await sleep(20);
  last().say('make a');
  last().stop(); // the browser finalises and ends on its own (released=false)
  await sleep(40);
  last().say('rainbow');
  t.vm.release();
  await sleep(60);
  assert.equal(t.done[0].text, 'make a rainbow');
});

await check('no interim results, final arrives 2.5 s after the release: still heard (waits for `end`, up to 4 s with no words)', async () => {
  SimRec.opts = { ...DEFAULT, noInterim: true, finalDelay: 2500 };
  const t = vmode();
  t.vm.press();
  await sleep(20);
  last().say('rainbow');
  t.vm.release();
  await sleep(2600);
  assert.equal(t.done.length, 1);
  assert.equal(t.done[0].text, 'rainbow');
  assert.deepEqual(t.fired, ['Rainbow']);
});

await check('let go during the permission prompt: the recogniser is NOT stopped mid-prompt; after Allow it is dropped quietly -> "permission-pending"', async () => {
  SimRec.opts = { ...DEFAULT, startDelay: 1800 }; // the prompt is up for 1.8 s
  const t = vmode({ perm: 'prompt' });
  t.vm.press();
  await sleep(100);
  t.vm.release(); // the child lets go to tap Allow
  assert.equal(last().stopped, false, 'stop() would kill the prompt');
  assert.equal(last().aborted, false);
  await sleep(1800);
  assert.equal(last().aborted, true, 'dropped once the mic opened');
  assert.equal(t.done[0].problem, 'permission-pending');
  assert.equal(t.done[0].audio, true, 'the mic did open: the app says "Now hold me and talk"');
  assert.match(t.done[0].help!.text, /Allow/);
});

await check('let go very early with permission already granted -> "too-short" (keep holding), never a scary error', async () => {
  SimRec.opts = { ...DEFAULT, startDelay: 300 };
  const t = vmode({ perm: 'granted' });
  t.vm.press();
  await sleep(50);
  t.vm.release();
  await sleep(320);
  assert.equal(t.done[0].problem, 'too-short');
  assert.match(t.done[0].help!.text, /Keep holding/);
  assert.equal(t.done[0].help!.block, false);
});

const errorCases: Array<[string, HoldProblem, RegExp, boolean, MicPermission, typeof ANDROID]> = [
  ['not-allowed', 'not-allowed', /microphone is off/i, true, 'denied', ANDROID],
  ['not-allowed', 'not-allowed-soft', /Tap Allow/i, false, 'prompt', ANDROID],
  ['service-not-allowed', 'service-not-allowed', /Siri & Dictation/, true, 'granted', IOS],
  ['service-not-allowed', 'service-not-allowed', /can’t listen in this browser/, true, 'granted', ANDROID],
  ['network', 'network', /internet/, false, 'granted', ANDROID],
  ['audio-capture', 'audio-capture', /Another app has the mic/, false, 'granted', ANDROID],
  ['language-not-supported', 'unsupported', /can’t hear you/, true, 'granted', ANDROID],
];
for (const [code, problem, msg, block, perm, plat] of errorCases) {
  await check(`error "${code}" (${plat.ios ? 'iOS' : 'Android'}, permission ${perm}) -> ${problem}: ${msg} ${block ? '(blocked)' : '(press again works)'}`, async () => {
    SimRec.opts = { ...DEFAULT, errorOnStart: code };
    const t = vmode({ perm, platform: plat });
    t.vm.press();
    await sleep(60);
    assert.equal(t.done.length, 1, 'one done');
    assert.equal(t.done[0].problem, problem);
    assert.match(t.done[0].help!.text, msg);
    assert.equal(t.done[0].help!.block, block);
    assert.ok(t.done[0].help!.chips, 'magic-word chips offered');
    assert.equal(!!t.vm.unavailable, block);
    SimRec.opts = { ...DEFAULT };
    const n = SimRec.all.length;
    assert.equal(t.vm.press(), !block);
    assert.equal(SimRec.all.length, n + (block ? 0 : 1), block ? 'no prompt loop' : 'a fresh recogniser');
    t.vm.cancel();
  });
}

await check('no-speech while held = a child pausing: restarts quietly; only after the release with nothing does it say "didn\'t hear anything"; twice -> chips', async () => {
  const t = vmode();
  t.vm.press();
  await sleep(20);
  last().fail('no-speech');
  await sleep(20);
  assert.equal(t.done.length, 0);
  t.vm.release();
  await sleep(60);
  assert.equal(t.done[0].problem, 'no-speech');
  assert.match(t.done[0].help!.text, /didn’t hear anything/);
  assert.equal(t.done[0].help!.chips, false);
  t.vm.press(); await sleep(20); t.vm.release(); await sleep(60);
  assert.match(t.done[1].help!.text, /still can’t hear/);
  assert.equal(t.done[1].help!.chips, true, 'second time: magic words to tap');
});

await check('"aborted" by the browser while held -> restart (not an error); recogniser ending instantly twice -> stops, no loop', async () => {
  const t = vmode();
  t.vm.press();
  await sleep(20);
  last().fail('aborted');
  await sleep(20);
  assert.equal(SimRec.all.length, 2);
  assert.equal(t.done.length, 0);
  // now it ends instantly, every time
  SimRec.opts = { ...DEFAULT, errorOnStart: 'aborted', startDelay: 1 };
  last().fail('aborted');
  await sleep(80);
  assert.ok(SimRec.all.length <= 5, `bounded restarts (${SimRec.all.length})`);
  assert.equal(t.done.length, 1);
  assert.equal(t.done[0].problem, 'no-speech');
});

await check('start() throws (InvalidStateError) -> press() false, problem start-failed, NOT blocked (next press works)', () => {
  SimRec.opts = { ...DEFAULT, startThrows: 'InvalidStateError' };
  const t = vmode();
  assert.equal(t.vm.press(), false);
  assert.equal(t.vm.lastProblem, 'start-failed');
  assert.equal(t.vm.unavailable, null);
  assert.match(t.vm.help('start-failed').text, /try again/);
  SimRec.opts = { ...DEFAULT };
  assert.equal(t.vm.press(), true);
  t.vm.cancel();
});

await check('mic turned back on in Settings (permission change -> granted) unblocks the button without a reload', async () => {
  SimRec.opts = { ...DEFAULT, errorOnStart: 'not-allowed' };
  const t = vmode({ perm: 'denied' });
  t.vm.press();
  await sleep(60);
  assert.equal(t.vm.unavailable, 'denied');
  t.setPerm('granted');
  assert.equal(t.vm.unavailable, null);
  SimRec.opts = { ...DEFAULT };
  assert.equal(t.vm.press(), true);
  t.vm.cancel();
});

await check('a fresh recogniser per hold (never a stale one reused after end)', async () => {
  const t = vmode();
  t.vm.press(); await sleep(20); last().say('dance'); t.vm.release(); await sleep(60);
  const a = SimRec.all[0];
  t.vm.press(); await sleep(20);
  assert.notEqual(last(), a);
  assert.equal(a.onresult, null);
  t.vm.cancel();
});

await check('Android repeats earlier phrases inside later results: folded ("make a" + "make a rainbow" = "make a rainbow")', () => {
  assert.equal(foldRepeat('make a', 'make a rainbow'), 'make a rainbow');
  assert.equal(foldRepeat('make a rainbow', 'rainbow'), 'make a rainbow');
  assert.equal(foldRepeat('hello', 'dance'), 'hello dance');
  const got: string[] = [];
  const h = new HoldListener({ onText: (x) => got.push(x), onState: () => undefined, onDone: () => undefined }, () => new SimRec(), { meter: null });
  h.press();
  last().onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: 'make a' } }, { isFinal: false, 0: { transcript: 'make a rainbow' } }] });
  assert.equal(got.at(-1), 'make a rainbow');
  h.cancel();
});

await check('the ring follows recognition events (no meter): level rises on speech and results, 0 after the release', async () => {
  const levels: number[] = [];
  const h = new HoldListener({ onText: () => undefined, onState: () => undefined, onDone: () => undefined, onLevel: (l) => levels.push(l) }, () => new SimRec(), { meter: null });
  h.press();
  await sleep(60);
  const quiet = Math.max(...levels.slice(-3));
  last().say('rainbow');
  await sleep(70);
  const loud = Math.max(...levels.slice(-3));
  assert.ok(quiet > 0 && quiet < 0.25, `idle breathing ${quiet.toFixed(2)}`);
  assert.ok(loud > quiet + 0.2, `speaking ${loud.toFixed(2)} > idle ${quiet.toFixed(2)}`);
  h.release();
  assert.equal(levels.at(-1), 0);
  h.cancel();
});

await check('the Mic check log records every event of a hold with timestamps', async () => {
  clearVoiceLog();
  const t = vmode();
  t.vm.press(); await sleep(20); last().say('rainbow'); t.vm.release(); await sleep(60);
  const evs = voiceLogEntries().map((e) => e.ev);
  for (const e of ['press', 'start()', 'start', 'audiostart', 'soundstart', 'speechstart', 'result', 'release', 'stop()', 'end', 'done']) assert.ok(evs.includes(e), `log has ${e}: ${evs.join(',')}`);
  const text = formatVoiceLog();
  assert.match(text, /#\d+ \+0\.\d{3}s\s+press/);
  assert.match(text, /result\s+(interim|final) "rainbow"/);
});

await check('every problem has a short kind line (no "error", no blame), chips where there is nothing else to do', () => {
  const all: HoldProblem[] = ['no-speech', 'too-short', 'permission-pending', 'not-allowed', 'not-allowed-soft', 'service-not-allowed', 'network', 'audio-capture', 'aborted', 'start-failed', 'unsupported', 'error'];
  for (const p of all) for (const plat of [ANDROID, IOS]) {
    const h = problemHelp(p, plat);
    assert.ok(h.text.split(/\s+/).length <= 10, `${p}: "${h.text}" is short`);
    assert.doesNotMatch(h.text, /error|fail|invalid|wrong/i);
    if (h.block) assert.ok(h.chips, `${p}: blocked -> chips`);
  }
  assert.match(problemHelp('not-allowed', IOS).help!, /aA/);
  assert.match(problemHelp('not-allowed', ANDROID).help!, /Permissions/);
  assert.equal(IOS.ios, true); assert.equal(ANDROID.android, true);
  assert.equal(voicePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36' }).samsung, true);
  assert.equal(voicePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36' }).inApp, true);
  assert.equal(voicePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0' }).inApp, true);
});

console.log(`voice hold: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);

// voice-5: the demo call's turn taking (half duplex, Android ends, iOS restarts, barge-in, commands)
await import('./check-voice-call');
