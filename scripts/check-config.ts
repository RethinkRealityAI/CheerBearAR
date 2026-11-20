// Checks for config merge / validation (src/shared/config.ts). Run: npx tsx scripts/check-config.ts
import assert from 'node:assert/strict';
import {
  applyConfigPatch,
  coerceConfig,
  ConfigValidationError,
  DEFAULT_CONFIG,
  defaultConfig,
  diffConfigPaths,
  mergeConfig,
  validateConfig,
} from '../src/shared/config';

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
const rejects = (patch: unknown, needle: string) => {
  assert.throws(() => applyConfigPatch(defaultConfig(), patch), (e: unknown) => e instanceof ConfigValidationError && e.errors.some((m) => m.includes(needle)), needle);
};

console.log('config');
await check('defaults are valid', () => assert.deepEqual(validateConfig(DEFAULT_CONFIG), []));
await check('deep merge keeps siblings', () => {
  const c = applyConfigPatch(defaultConfig(), { triggerPolicy: { triggerCooldownMs: 500 } });
  assert.equal(c.triggerPolicy.triggerCooldownMs, 500);
  assert.equal(c.triggerPolicy.dispatchMode, 'first_only');
  const d = applyConfigPatch(c, { ui: { customization: { welcomeModal: { title: 'Hi' } } } });
  assert.equal(d.ui.customization.welcomeModal.title, 'Hi');
  assert.equal(d.ui.customization.welcomeModal.items.length, 3);
  assert.equal(d.triggerPolicy.triggerCooldownMs, 500);
});
await check('unknown and obsolete keys are dropped (arIframeUrl, twilioPhoneNumber, lipSync.modelUrl)', () => {
  const c = applyConfigPatch(defaultConfig(), { arIframeUrl: 'https://webxr.run/x', twilioPhoneNumber: '+1', lipSync: { modelUrl: 'gs://x', showDebugHud: false }, hacker: 1 });
  assert.equal('arIframeUrl' in c, false);
  assert.equal('twilioPhoneNumber' in c, false);
  assert.equal('hacker' in c, false);
  assert.deepEqual(c.lipSync, { showControlsPanel: true, showDebugHud: false, intensity: 1, attackMs: 55, releaseMs: 95 });
});
await check('synonyms are replaced (so a synonym can be deleted), keys lower-cased', () => {
  const c = applyConfigPatch(defaultConfig(), { localClassifier: { synonyms: { House: ['home'] } } });
  assert.deepEqual(c.localClassifier.synonyms, { house: ['home'] });
  assert.equal(c.localClassifier.keywords.length, 12);
});
await check('lists are replaced wholesale; an empty game mode list keeps the old ones', () => {
  const c = applyConfigPatch(defaultConfig(), { localClassifier: { keywords: ['House', 'Unicorn'] } });
  assert.deepEqual(c.localClassifier.keywords, ['House', 'Unicorn']);
  const g = applyConfigPatch(defaultConfig(), { gameModes: [] });
  assert.equal(g.gameModes.length, DEFAULT_CONFIG.gameModes.length);
});
await check('default game modes are always restored; custom ones kept; active must be enabled', () => {
  const custom = { id: 'my-mode', name: 'Mine', description: '', enabled: true, triggerWords: ['Magic'], hints: { general: [], specific: {} }, objective: '' };
  const c = applyConfigPatch(defaultConfig(), { gameModes: [custom], activeGameMode: 'my-mode' });
  assert.equal(c.gameModes.length, DEFAULT_CONFIG.gameModes.length + 1);
  assert.equal(c.activeGameMode, 'my-mode');
  const off = applyConfigPatch(defaultConfig(), { gameModes: DEFAULT_CONFIG.gameModes.map((m) => ({ ...m, enabled: m.id !== 'chat-time' })) });
  assert.equal(off.activeGameMode, 'rainbow-adventure');
});
await check('validation: enums, ranges, types', () => {
  rejects({ intentMatchingEngine: 'gpt' }, 'intentMatchingEngine');
  rejects({ triggerPolicy: { triggerCooldownMs: 99999 } }, 'triggerCooldownMs');
  rejects({ triggerPolicy: { dispatchIntervalMs: -1 } }, 'dispatchIntervalMs');
  rejects({ triggerPolicy: { dispatchMode: 'all' } }, 'dispatchMode');
  rejects({ allowUserTriggers: 'yes' }, 'allowUserTriggers');
  rejects({ ui: { customization: { primaryColor: 'red; background:url(x)' } } }, 'primaryColor');
  rejects({ ui: { customization: { welcomeModal: { heroImageUrl: 'javascript:alert(1)' } } } }, 'heroImageUrl');
  rejects({ activeGameMode: 'nope' }, 'activeGameMode');
});
await check('validation: keyword bounds, characters and duplicates', () => {
  rejects({ localClassifier: { keywords: Array.from({ length: 101 }, (_, i) => `k${i}`) } }, 'at most 100');
  rejects({ localClassifier: { keywords: ['x'.repeat(51)] } }, 'at most 50');
  rejects({ localClassifier: { keywords: ['<script>'] } }, 'letters, numbers');
  rejects({ localClassifier: { keywords: ['Magic', 'magic'] } }, 'duplicate');
  rejects({ localClassifier: { synonyms: { magic: 'spell' } } }, 'must be a list');
});
await check('validation: game modes', () => {
  rejects({ gameModes: [{ id: 'bad id!', name: 'x', description: '', enabled: true, triggerWords: [], hints: { general: [], specific: {} }, objective: '' }] }, 'id');
  rejects({ gameModes: Array.from({ length: 51 }, (_, i) => ({ id: `m${i}`, name: 'x', description: '', enabled: true, triggerWords: [], hints: { general: [], specific: {} }, objective: '' })) }, 'at most 50');
});
await check('settings panel: unknown items dropped, values must be boolean', () => {
  const c = applyConfigPatch(defaultConfig(), { ui: { customization: { settingsPanel: { items: { bogus: true, user_triggers: false } } } } });
  assert.equal(c.ui.customization.settingsPanel.items.user_triggers, false);
  assert.equal('bogus' in c.ui.customization.settingsPanel.items, false);
  rejects({ ui: { customization: { settingsPanel: { items: { user_triggers: 'no' } } } } }, 'user_triggers');
});
await check('non-object patch is rejected', () => rejects([1, 2], 'must be an object'));
await check('coerceConfig repairs a broken stored config section by section', () => {
  const c = coerceConfig({ intentMatchingEngine: 'bogus', triggerPolicy: { triggerCooldownMs: 1234 }, arIframeUrl: 'x' });
  assert.equal(c.intentMatchingEngine, 'local');
  assert.equal(c.triggerPolicy.triggerCooldownMs, 1234);
  assert.deepEqual(validateConfig(c), []);
  assert.deepEqual(coerceConfig(null), defaultConfig());
});
await check('mergeConfig does not mutate its inputs', () => {
  const base = defaultConfig();
  const snapshot = JSON.stringify(base);
  mergeConfig(base, { triggerPolicy: { triggerCooldownMs: 1 } });
  assert.equal(JSON.stringify(base), snapshot);
});
await check('diffConfigPaths summarises changes', () => {
  const c = applyConfigPatch(defaultConfig(), { triggerPolicy: { triggerCooldownMs: 1 }, localClassifier: { synonyms: {} } });
  assert.deepEqual(diffConfigPaths(defaultConfig(), c).sort(), ['localClassifier.synonyms', 'triggerPolicy.triggerCooldownMs']);
});

await check('demoVoice: defaults, validation, an old stored config without it gets the defaults', () => {
  assert.deepEqual(defaultConfig().demoVoice, { speakTypedChatOutsideCall: true, pitch: 1.3, rate: 1.05, useAiBrain: true });
  rejects({ demoVoice: { pitch: 3 } }, 'demoVoice.pitch');
  rejects({ demoVoice: { rate: 0.1 } }, 'demoVoice.rate');
  rejects({ demoVoice: { useAiBrain: 'yes' } }, 'demoVoice.useAiBrain');
  const c = applyConfigPatch(defaultConfig(), { demoVoice: { speakTypedChatOutsideCall: false, pitch: 1.1 } });
  assert.deepEqual(c.demoVoice, { speakTypedChatOutsideCall: false, pitch: 1.1, rate: 1.05, useAiBrain: true });
  const old = defaultConfig() as unknown as Record<string, unknown>;
  delete old.demoVoice;
  assert.deepEqual(coerceConfig(old).demoVoice, defaultConfig().demoVoice);
});
await check('voiceMode: safe defaults, validation, an old stored config without it gets the defaults', () => {
  assert.deepEqual(defaultConfig().voiceMode, { enabled: true, holdToTalk: true, spokenReplies: true });
  rejects({ voiceMode: { enabled: 'yes' } }, 'voiceMode.enabled');
  rejects({ voiceMode: { holdToTalk: 1 } }, 'voiceMode.holdToTalk');
  rejects({ voiceMode: { spokenReplies: null } }, 'voiceMode.spokenReplies');
  const c = applyConfigPatch(defaultConfig(), { voiceMode: { spokenReplies: false } });
  assert.deepEqual(c.voiceMode, { enabled: true, holdToTalk: true, spokenReplies: false });
  const old = defaultConfig() as unknown as Record<string, unknown>;
  delete old.voiceMode;
  assert.deepEqual(coerceConfig(old).voiceMode, defaultConfig().voiceMode);
  const bad = { ...defaultConfig(), voiceMode: { enabled: 'nope' } };
  assert.deepEqual(coerceConfig(bad).voiceMode, defaultConfig().voiceMode, 'a bad stored section falls back alone');
});
console.log(`config: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
