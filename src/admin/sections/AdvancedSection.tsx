import { useAdmin } from '../AdminContext';
import { AutoFields, Group, Section } from '../ui';
import type { FieldMeta } from '../ui/AutoFields';

/** Friendlier words for settings that live here (voice-3: voiceMode). */
const META: Record<string, FieldMeta> = {
  voiceMode: { label: 'Voice mode (hold to talk, no call)' },
  'voiceMode.enabled': { label: 'Talk button is a hold-to-talk mic', hint: 'Visitors hold the talk button and say a magic word, a mode ("AR", "selfie") or "take a picture". Uses the browser’s own speech recognition: no call, no AI. Calling moves to a smaller phone button.' },
  'voiceMode.holdToTalk': { label: 'Hold while talking (off: tap to start and stop)', hint: 'Default for new visitors; they can change it in Settings.' },
  'voiceMode.spokenReplies': { label: 'Happi answers out loud', hint: 'A short happy line in the browser’s voice (never a magic word). Visitors can turn it off.' },
};

/** Settings the server has that this panel has no page for yet. Shown generically so nothing is out of reach. */
export function AdvancedSection() {
  const { draft, setPath, errors, extraKeys } = useAdmin();
  const value = Object.fromEntries(extraKeys.map((k) => [k, (draft as unknown as Record<string, unknown>)[k]]));
  return (
    <Section title="Other settings" description="Settings added recently that don't have their own page yet. Change them only if you know what they do.">
      <Group>
        <AutoFields value={value} path="" onChange={setPath} errors={errors} meta={META} />
      </Group>
    </Section>
  );
}
