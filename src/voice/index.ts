// Voice entry point (see src/shared/contracts.ts):
//   createVoiceSession({ getConfig }) -> VoiceSession   call, transcripts, triggers, Happi's audio stream
//   configClient                      -> ConfigClient   public runtime config (GET /api/config)
//   adminApi                          -> AdminApi       admin endpoints (/api/admin/*)
// Owner: server-voice. Demo call without accounts: add ?mockVoice to the URL (see mock.ts). Typed chat with no call
// live is answered by the demo Happi too (demoBear.ts; config.demoVoice).
export { createVoiceSession } from './session';
export type { CreateVoiceSessionOptions, VoiceSessionExt, VoiceStatusEvent, VoiceStatusCode } from './session';
export { configClient } from './configClient';
export type { ConfigClientExt, Services } from './configClient';
export { adminApi } from './adminApi';
export type { AdminApiExt, AdminStatus, TestPhraseResult } from './adminApi';
export { ApiError } from './api';
export { mockFlagsFromUrl } from './mock';
export { CheerBrain } from './cheerBrain';
export { buildVisemeTimeline, sampleTimeline } from './textVisemes';
export type { VoiceModeApi, VoiceModeEvents, VoiceModePhase } from './voiceMode';
export type { HoldProblem, ProblemHelp, VoicePlatform } from './voiceHelp';
export type { VoiceCommand, VoiceMatch } from './commands';
export { matchVoiceCommands } from './commands';
