import type { TranscriptVisibility, UiMode } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { Group, Section, Select, Toggle, type Option } from '../ui';

const MODES: Option<UiMode>[] = [
  { value: 'calm', label: 'Calm', description: 'Just the call and the scene. No text on screen. Best for events.' },
  { value: 'chat', label: 'Chat', description: 'A chat panel where visitors can also type to Happi.' },
  { value: 'call_debug', label: 'Call debug', description: 'Live transcripts and trigger details, for testing only.' },
];

const TRANSCRIPTS: Option<TranscriptVisibility>[] = [
  { value: 'off', label: 'Never show', description: 'What is said on the call is never written on screen.' },
  { value: 'call_debug_only', label: 'Only in Call debug', description: 'Transcripts appear only while testing in Call debug.' },
  { value: 'chat_only', label: 'Only in Chat', description: 'The chat panel shows what was said on the call.' },
  { value: 'chat_and_call_debug', label: 'In Chat and Call debug', description: 'Transcripts appear in both modes (never in Calm).' },
];

export function ModeSection() {
  const { draft, edit } = useAdmin();
  return (
    <Section title="Mode & visibility" description="What visitors see when they open Happi, before they change anything themselves.">
      <Group title="Starting mode">
        <Select<UiMode> asCards path="modeDefault" label="Mode visitors start in" options={MODES} value={draft.modeDefault}
          onChange={(v) => edit((d) => { d.modeDefault = v; })} />
        <Select<TranscriptVisibility> path="transcriptVisibility" label="Call transcripts on screen" options={TRANSCRIPTS}
          value={draft.transcriptVisibility} onChange={(v) => edit((d) => { d.transcriptVisibility = v; })} />
      </Group>
      <Group title="Talking">
        <Toggle label="Call button first" checked={draft.ui.useCallMode} onChange={(v) => edit((d) => { d.ui.useCallMode = v; })}
          hint="Visitors see the round talk button and call Happi by voice. Off: they see the chat box first." />
        <Toggle label="Command mode" checked={draft.ui.isCommandMode} onChange={(v) => edit((d) => { d.ui.isCommandMode = v; })}
          hint="Typing a keyword plays its reaction straight away instead of chatting. Handy for demos; leave off for visitors." />
      </Group>
    </Section>
  );
}
