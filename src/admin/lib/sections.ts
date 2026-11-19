import type { LucideIcon } from 'lucide-react';
import {
  AudioLines, Eye, FileJson, Gamepad2, History, LayoutDashboard, MessageSquare, Palette, ShieldCheck,
  SlidersHorizontal, Tags, Zap,
} from 'lucide-react';
import { pathIn } from './configDiff';

export type SectionId =
  | 'overview' | 'mode' | 'privacy' | 'intent' | 'triggers' | 'sms' | 'games' | 'ui' | 'lipsync' | 'advanced'
  | 'history' | 'backup';

export interface SectionDef {
  id: SectionId;
  title: string;
  /** One line under the title in the nav (desktop) and the page header. */
  blurb: string;
  icon: LucideIcon;
  /** Config paths this section edits (for dirty dots and error counts). */
  paths: string[];
  group: 'start' | 'behaviour' | 'content' | 'tools';
}

/** Top-level config keys the panel knows. Anything else the server adds shows up under "Other settings". */
export const KNOWN_KEYS = [
  'modeDefault', 'allowUserTriggers', 'allowUserAudioToOpenAI', 'intentMatchingEngine', 'localClassifier',
  'transcriptVisibility', 'smsPolicy', 'englishOnlyTranscripts', 'triggerPolicy', 'ui', 'gameModes',
  'activeGameMode', 'lipSync',
];
/** Fields from the old architecture that no longer do anything; never shown. */
export const OBSOLETE_KEYS = ['arIframeUrl', 'twilioPhoneNumber'];

export const SECTIONS: SectionDef[] = [
  { id: 'overview', title: 'Overview', blurb: 'Service status and quick links', icon: LayoutDashboard, paths: [], group: 'start' },
  { id: 'mode', title: 'Mode & visibility', blurb: 'What visitors see when they arrive', icon: Eye, group: 'behaviour',
    paths: ['modeDefault', 'transcriptVisibility', 'ui.useCallMode', 'ui.isCommandMode'] },
  { id: 'privacy', title: 'Privacy', blurb: 'What audio leaves the device', icon: ShieldCheck, group: 'behaviour',
    paths: ['allowUserAudioToOpenAI', 'englishOnlyTranscripts'] },
  { id: 'intent', title: 'Keywords & intent', blurb: 'Words that make things happen', icon: Tags, group: 'behaviour',
    paths: ['intentMatchingEngine', 'localClassifier'] },
  { id: 'triggers', title: 'Trigger policy', blurb: 'How often reactions can fire', icon: Zap, group: 'behaviour',
    paths: ['triggerPolicy', 'allowUserTriggers'] },
  { id: 'sms', title: 'SMS', blurb: 'Forwarding chat by text message', icon: MessageSquare, group: 'behaviour',
    paths: ['smsPolicy'] },
  { id: 'games', title: 'Game modes', blurb: 'Word games and hints', icon: Gamepad2, group: 'content',
    paths: ['gameModes', 'activeGameMode'] },
  { id: 'ui', title: 'Look & text', blurb: 'Colours, labels, welcome screen', icon: Palette, group: 'content',
    paths: ['ui.customization'] },
  { id: 'lipsync', title: 'Lip sync', blurb: 'Mouth movement tuning', icon: AudioLines, group: 'content', paths: ['lipSync'] },
  { id: 'advanced', title: 'Other settings', blurb: 'New settings without their own page yet', icon: SlidersHorizontal,
    group: 'content', paths: [] },
  { id: 'history', title: 'History', blurb: 'Earlier versions, restore', icon: History, paths: [], group: 'tools' },
  { id: 'backup', title: 'Import, export & reset', blurb: 'Back up or start over', icon: FileJson, paths: [], group: 'tools' },
];

export function sectionForPath(path: string, extraKeys: string[]): SectionId | null {
  for (const s of SECTIONS) if (s.paths.some((p) => pathIn(path, p))) return s.id;
  if (extraKeys.some((k) => pathIn(path, k))) return 'advanced';
  return null;
}

export function sectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
