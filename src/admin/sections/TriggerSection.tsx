import type { TriggerDispatchMode } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { Group, NumberField, Section, Select, Toggle, type Option } from '../ui';
import { LIMITS } from '../lib/validate';

const DISPATCH: Option<TriggerDispatchMode>[] = [
  { value: 'first_only', label: 'First word only', description: 'If one sentence has several keywords, only the first one plays. Calmer, fewer surprises.' },
  { value: 'queue_all', label: 'Play them all in turn', description: 'Every keyword in a sentence plays, one after another, with the gap below between them.' },
];

export function TriggerSection() {
  const { draft, edit, errors } = useAdmin();
  const tp = draft.triggerPolicy;
  return (
    <Section title="Trigger policy" description="How eagerly the scene reacts when a keyword is heard. The same word only fires once per sentence.">
      <Group title="Timing">
        <NumberField path="triggerPolicy.triggerCooldownMs" label="Cooldown" unit="ms" min={0} max={LIMITS.msMax} step={250} slider
          value={tp.triggerCooldownMs} error={errors['triggerPolicy.triggerCooldownMs']}
          onChange={(v) => edit((d) => { d.triggerPolicy.triggerCooldownMs = v; })}
          hint="The shortest gap between two reactions. Longer feels calmer; 0 lets reactions fire back to back." />
        <Select<TriggerDispatchMode> asCards path="triggerPolicy.dispatchMode" label="When a sentence has several keywords" options={DISPATCH}
          value={tp.dispatchMode} onChange={(v) => edit((d) => { d.triggerPolicy.dispatchMode = v; })} />
        <NumberField path="triggerPolicy.dispatchIntervalMs" label="Gap between queued reactions" unit="ms" min={0} max={LIMITS.msMax} step={100} slider
          value={tp.dispatchIntervalMs} error={errors['triggerPolicy.dispatchIntervalMs']}
          onChange={(v) => edit((d) => { d.triggerPolicy.dispatchIntervalMs = v; })}
          hint={tp.dispatchMode === 'queue_all' ? 'How long to wait before playing the next keyword in the queue.' : 'Only used with "Play them all in turn".'} />
      </Group>
      <Group title="Sensitivity">
        <Toggle label="React before the sentence ends" checked={tp.partialTriggerEnabled}
          onChange={(v) => edit((d) => { d.triggerPolicy.partialTriggerEnabled = v; })}
          hint="Faster reactions, but the transcriber's early guesses can be wrong, so expect more false alarms. Off is recommended." />
        <Toggle label="Typed messages can trigger reactions" checked={draft.allowUserTriggers}
          onChange={(v) => edit((d) => { d.allowUserTriggers = v; })}
          hint="When on, a visitor typing a keyword in the chat plays its reaction. When off, only Cheer Bear's own words do." />
      </Group>
    </Section>
  );
}
