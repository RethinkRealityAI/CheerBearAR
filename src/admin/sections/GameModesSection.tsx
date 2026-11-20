import { useState } from 'react';
import { Copy, Plus, Star, Trash2 } from 'lucide-react';
import type { GameMode } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { Group, Section, Select, TagInput, TextArea, TextField, Toggle, useConfirm, type Option } from '../ui';

function newId(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function GameModesSection() {
  const { draft, edit, errors } = useAdmin();
  const confirm = useConfirm();
  const modes = draft.gameModes;
  const [selectedId, setSelectedId] = useState<string | null>(draft.activeGameMode ?? modes[0]?.id ?? null);
  const index = modes.findIndex((g) => g.id === selectedId);
  const gm = index >= 0 ? modes[index] : null;

  const activeOptions: Option<string>[] = [
    { value: '', label: 'None (no game, just chat)' },
    ...modes.map((g) => ({ value: g.id, label: g.enabled ? g.name : `${g.name} (switched off)`, disabled: !g.enabled })),
  ];

  const create = (from?: GameMode) => {
    const name = from ? `${from.name} copy` : 'New game mode';
    const id = newId(name, modes.map((g) => g.id));
    const mode: GameMode = from
      ? { ...structuredClone(from), id, name, enabled: false }
      : { id, name, description: '', enabled: false, triggerWords: [], hints: { general: [], specific: {} }, objective: '', instructions: '' };
    edit((d) => { d.gameModes.push(mode); });
    pick(id);
  };

  const remove = async (g: GameMode) => {
    const ok = await confirm({
      title: `Delete "${g.name}"?`,
      danger: true,
      confirmText: 'Delete game mode',
      message: <p>Its words and hints are deleted too.{draft.activeGameMode === g.id ? ' It is the active mode, so no game will be active.' : ''} Nothing is saved until you press Save.</p>,
    });
    if (!ok) return;
    edit((d) => {
      d.gameModes = d.gameModes.filter((x) => x.id !== g.id);
      if (d.activeGameMode === g.id) d.activeGameMode = null;
    });
    setSelectedId(null);
  };

  // On narrow screens the editor sits under the list: bring it into view after picking.
  const pick = (id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 1100) requestAnimationFrame(() => document.querySelector('.adm-game-editor')?.scrollIntoView({ block: 'start' }));
  };

  const update = (recipe: (g: GameMode) => void) => edit((d) => { const g = d.gameModes.find((x) => x.id === selectedId); if (g) recipe(g); });

  return (
    <Section title="Game modes" description="Word games: visitors ask Happi questions and try to get her to say the trigger words."
      actions={<button type="button" className="adm-btn primary" onClick={() => create()}><Plus size={16} aria-hidden /> New game mode</button>}>
      <Group>
        <Select<string> path="activeGameMode" label="Game visitors start with" options={activeOptions} value={draft.activeGameMode ?? ''}
          error={errors['activeGameMode']} onChange={(v) => edit((d) => { d.activeGameMode = v || null; })}
          hint="Visitors can still switch games themselves. Only switched-on games can be picked." />
      </Group>

      <div className="adm-games">
        <ul className="adm-game-list" aria-label="Game modes" data-path="gameModes">
          {modes.map((g, i) => {
            const bad = Object.keys(errors).some((p) => p.startsWith(`gameModes.${i}.`));
            return (
              <li key={g.id}>
                <button type="button" className={`adm-game-card${g.id === selectedId ? ' is-on' : ''}${g.enabled ? '' : ' is-off'}${bad ? ' has-error' : ''}`}
                  aria-pressed={g.id === selectedId} onClick={() => pick(g.id)}>
                  <span className="adm-game-name">
                    {g.name || 'Untitled'}
                    {draft.activeGameMode === g.id && <span className="adm-tag-soft active"><Star size={12} aria-hidden /> Active</span>}
                  </span>
                  <span className="adm-game-meta">
                    {g.enabled ? 'On' : 'Off'} · {g.triggerWords.length ? `${g.triggerWords.length} words` : 'all keywords'}
                    {bad && ' · needs a fix'}
                  </span>
                </button>
              </li>
            );
          })}
          {!modes.length && <li className="adm-empty">No game modes yet.</li>}
        </ul>

        {gm ? (
          <Group className="adm-game-editor" title={gm.name || 'Untitled'} actions={(
            <>
              <button type="button" className="adm-btn ghost small" onClick={() => create(gm)}><Copy size={16} aria-hidden /> Duplicate</button>
              <button type="button" className="adm-btn ghost danger small" onClick={() => remove(gm)}><Trash2 size={16} aria-hidden /> Delete</button>
            </>
          )}>
            <Toggle label="Switched on" checked={gm.enabled} onChange={(v) => update((g) => { g.enabled = v; })}
              hint="Switched-off games are hidden from visitors." />
            {gm.enabled && draft.activeGameMode !== gm.id && (
              <button type="button" className="adm-btn small" onClick={() => edit((d) => { d.activeGameMode = gm.id; })}>
                <Star size={16} aria-hidden /> Make this the game visitors start with
              </button>
            )}
            <TextField path={`gameModes.${index}.name`} label="Name" value={gm.name} error={errors[`gameModes.${index}.name`]}
              onChange={(v) => update((g) => { g.name = v; })} />
            <TextField path={`gameModes.${index}.description`} label="Short description" value={gm.description}
              error={errors[`gameModes.${index}.description`]} onChange={(v) => update((g) => { g.description = v; })}
              hint="One line shown in the game picker." />
            <TextArea path={`gameModes.${index}.objective`} label="Goal" value={gm.objective} rows={2}
              error={errors[`gameModes.${index}.objective`]} onChange={(v) => update((g) => { g.objective = v; })}
              hint="What the visitor is trying to do, shown when the game starts." />
            <TextArea path={`gameModes.${index}.instructions`} label="How to play (optional)" value={gm.instructions ?? ''} rows={2}
              error={errors[`gameModes.${index}.instructions`]} onChange={(v) => update((g) => { g.instructions = v; })} />

            <WordPicker mode={gm} onChange={(words) => update((g) => { g.triggerWords = words; })} />

            <TagInput variant="sentence" label="Hints for any word" noun="hint" values={gm.hints.general}
              placeholder="e.g. What makes you happy?" emptyText="No general hints."
              onChange={(v) => update((g) => { g.hints.general = v; })}
              hint="Questions suggested to the visitor when they are stuck. Never say the word itself." />

            {gm.triggerWords.length > 0 && (
              <fieldset className="adm-subgroup">
                <legend>Hints for each word</legend>
                <p className="adm-hint">Targeted questions that lead Happi towards one word.</p>
                {gm.triggerWords.map((w) => {
                  const k = w.toLowerCase();
                  return (
                    <TagInput key={k} variant="sentence" label={w} noun={`hint for ${w}`} values={gm.hints.specific[k] ?? []}
                      placeholder={`A question that leads to "${w}"`} emptyText="No hints for this word."
                      onChange={(v) => update((g) => { g.hints.specific[k] = v; })} />
                  );
                })}
              </fieldset>
            )}
          </Group>
        ) : (
          <Group><p className="adm-empty">Pick a game mode to edit it, or create a new one.</p></Group>
        )}
      </div>
    </Section>
  );
}

function WordPicker({ mode, onChange }: { mode: GameMode; onChange: (w: string[]) => void }) {
  const { draft } = useAdmin();
  const keywords = draft.localClassifier.keywords;
  const on = new Set(mode.triggerWords.map((w) => w.toLowerCase()));
  const toggle = (k: string) => {
    if (on.has(k.toLowerCase())) onChange(mode.triggerWords.filter((w) => w.toLowerCase() !== k.toLowerCase()));
    else onChange([...mode.triggerWords, k]);
  };
  const missing = mode.triggerWords.filter((w) => !keywords.some((k) => k.toLowerCase() === w.toLowerCase()));
  return (
    <fieldset className="adm-field adm-fieldset">
      <legend className="adm-label">Trigger words ({mode.triggerWords.length || 'all'})</legend>
      <p className="adm-hint adm-hint-top">
        {mode.triggerWords.length ? 'The words visitors need to get Happi to say.' : 'None picked: every keyword counts in this game.'}
      </p>
      <div className="adm-pick">
        {keywords.map((k) => (
          <label key={k} className={`adm-pick-chip${on.has(k.toLowerCase()) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={on.has(k.toLowerCase())} onChange={() => toggle(k)} />
            <span>{k}</span>
          </label>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="adm-note">
          {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not a keyword any more, so {missing.length === 1 ? 'it' : 'they'} can't trigger anything.{' '}
          <button type="button" className="adm-link-btn" onClick={() => onChange(mode.triggerWords.filter((w) => !missing.includes(w)))}>Remove</button>
        </p>
      )}
    </fieldset>
  );
}
