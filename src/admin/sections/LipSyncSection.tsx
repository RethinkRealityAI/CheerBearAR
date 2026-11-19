import { ExternalLink } from 'lucide-react';
import { useAdmin } from '../AdminContext';
import { AutoFields, Group, Section } from '../ui';
import type { FieldMeta } from '../ui/AutoFields';

/**
 * Friendly words for lip sync fields the panel knows about. Every other field in `AppConfig.lipSync` (new tuning values
 * added by the lip sync owner) still shows, labelled from its name, with a slider when a range is given here.
 */
export const LIPSYNC_META: Record<string, FieldMeta> = {
  showControlsPanel: { label: 'Tuning panel on the lab page', hint: 'Shows the live sliders on /lab/lipsync.' },
  showDebugHud: { label: 'Debug overlay on the lab page', hint: 'Shows the current mouth shape, loudness meter and weights.' },
  intensity: { label: 'Mouth size', hint: '1 is the tuned default. Lower is subtler, higher opens wider.', min: 0.3, max: 1.5, step: 0.05 },
  attackMs: { label: 'Reaction time (ms)', hint: 'How fast the mouth reaches a new shape. Lower is snappier.', min: 15, max: 200, step: 5 },
  releaseMs: { label: 'Relax time (ms)', hint: 'How fast the mouth relaxes out of a shape.', min: 20, max: 300, step: 5 },
  // Old fields with no effect in the new build (the model and backdrop are static files); hidden if an old config has them.
  backgroundImageUrl: { hidden: true },
  modelUrl: { hidden: true },
  smoothing: { label: 'Smoothing', hint: 'Higher blends mouth shapes more softly; lower reacts faster.', min: 0, max: 1, step: 0.01 },
  gain: { label: 'Mouth gain', hint: 'How wide the mouth opens for the same loudness.', min: 0, max: 3, step: 0.05 },
  jawWeight: { label: 'Jaw movement', hint: 'How much the jaw drops on loud sounds.', min: 0, max: 1, step: 0.01 },
  threshold: { label: 'Silence threshold', hint: 'Below this loudness the mouth stays closed.', min: 0, max: 1, step: 0.01 },
  latencyMs: { label: 'Audio delay', hint: 'Shift the mouth to line up with the voice.', unit: 'ms', min: -300, max: 300, step: 10 },
};

export function LipSyncSection() {
  const { draft, setPath, errors } = useAdmin();
  const ls = (draft.lipSync ?? {}) as unknown as Record<string, unknown>;
  return (
    <Section title="Lip sync" description="How Cheer Bear's mouth follows her voice."
      actions={<a className="adm-btn" href="/lab/lipsync" target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden /> Open the lip sync lab</a>}>
      <Group description="Try changes in the lab first: it plays sample lines through the bear. Values saved here apply to everyone.">
        <AutoFields value={ls} path="lipSync" onChange={setPath} errors={errors} meta={LIPSYNC_META} />
      </Group>
    </Section>
  );
}
