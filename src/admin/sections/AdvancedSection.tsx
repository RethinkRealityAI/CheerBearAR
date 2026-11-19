import { useAdmin } from '../AdminContext';
import { AutoFields, Group, Section } from '../ui';

/** Settings the server has that this panel has no page for yet. Shown generically so nothing is out of reach. */
export function AdvancedSection() {
  const { draft, setPath, errors, extraKeys } = useAdmin();
  const value = Object.fromEntries(extraKeys.map((k) => [k, (draft as unknown as Record<string, unknown>)[k]]));
  return (
    <Section title="Other settings" description="Settings added recently that don't have their own page yet. Change them only if you know what they do.">
      <Group>
        <AutoFields value={value} path="" onChange={setPath} errors={errors} />
      </Group>
    </Section>
  );
}
