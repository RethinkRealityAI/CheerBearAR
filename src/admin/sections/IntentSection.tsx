import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
import { CORE_ACTIONS } from '@/shared/contracts';
import type { IntentMatchingEngine } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { errorText } from '../api';
import { keywordProblem } from '../lib/validate';
import { Group, Section, Select, TagInput, Toggle, useConfirm, type Option } from '../ui';

const ENGINES: Option<IntentMatchingEngine>[] = [
  { value: 'local', label: 'Keywords only', description: 'Recommended. Matches your keywords and their other forms exactly. Fast, predictable, no AI.' },
  { value: 'hybrid', label: 'Keywords, then AI', description: 'Tries your keywords first; if none match, asks OpenAI to guess. Catches more, with some false alarms.' },
  { value: 'openai', label: 'AI only', description: 'OpenAI decides every time. Slower and less predictable; for experiments.' },
];

const CORE = new Set(CORE_ACTIONS.map((a) => a.toLowerCase()));

export function IntentSection() {
  const { draft, edit, errors } = useAdmin();
  const confirm = useConfirm();
  const lc = draft.localClassifier;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(lc.keywords[0] ?? null);
  const [newWord, setNewWord] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lc.keywords;
    return lc.keywords.filter((k) => k.toLowerCase().includes(q)
      || (lc.synonyms[k.toLowerCase()] ?? []).some((s) => s.toLowerCase().includes(q)));
  }, [query, lc]);

  const sel = selected && lc.keywords.includes(selected) ? selected : null;
  const key = sel?.toLowerCase() ?? '';
  const usedIn = sel ? draft.gameModes.filter((g) => g.triggerWords.some((w) => w.toLowerCase() === key)) : [];

  const addKeyword = () => {
    const w = newWord.trim();
    const problem = keywordProblem(w, lc.keywords);
    if (problem) { setAddError(problem); return; }
    edit((d) => { d.localClassifier.keywords.push(w); });
    setSelected(w);
    setNewWord('');
    setAddError(null);
    setQuery('');
  };

  const removeKeyword = async (kw: string) => {
    const k = kw.toLowerCase();
    const ok = await confirm({
      title: `Remove "${kw}"?`,
      danger: true,
      confirmText: 'Remove keyword',
      message: (
        <>
          <p>Cheer Bear will stop reacting to "{kw}" and its other forms.</p>
          {usedIn.length > 0 && <p>It is also removed from {usedIn.length === 1 ? 'the game mode' : 'these game modes'}: {usedIn.map((g) => g.name).join(', ')}.</p>}
          <p>Nothing is saved until you press Save.</p>
        </>
      ),
    });
    if (!ok) return;
    edit((d) => {
      const c = d.localClassifier;
      c.keywords = c.keywords.filter((x) => x !== kw);
      delete c.synonyms[k];
      delete c.examples[k];
      for (const g of d.gameModes) {
        g.triggerWords = g.triggerWords.filter((w) => w.toLowerCase() !== k);
        delete g.hints.specific[k];
      }
    });
    setSelected(null);
  };

  return (
    <Section title="Keywords & intent" description="The words that make things happen in the scene when Cheer Bear says them.">
      <PhraseTester />

      <Group title="How words are matched">
        <Select<IntentMatchingEngine> asCards path="intentMatchingEngine" label="Matching" options={ENGINES} value={draft.intentMatchingEngine}
          onChange={(v) => edit((d) => { d.intentMatchingEngine = v; })} />
        <Toggle label="Match word endings automatically" checked={lc.morphologyEnabled}
          onChange={(v) => edit((d) => { d.localClassifier.morphologyEnabled = v; })}
          hint="Also matches forms like dancing and danced for dance. Off is safer: add the forms you want as other words instead." />
      </Group>

      <Group title={`Keywords (${lc.keywords.length})`} description="Pick a keyword to edit the other words and phrases that count as it.">
        <div className="adm-kw-tools" data-path="localClassifier.keywords">
          <div className="adm-search">
            <Search size={16} aria-hidden />
            <label htmlFor="kw-search" className="adm-sr">Find a keyword</label>
            <input id="kw-search" className="adm-input" type="search" placeholder="Find a keyword or word…" value={query}
              onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </div>
          <form className="adm-kw-add" onSubmit={(e) => { e.preventDefault(); addKeyword(); }}>
            <label htmlFor="kw-new" className="adm-sr">New keyword</label>
            <input id="kw-new" className="adm-input" placeholder="New keyword, e.g. Pizza" value={newWord}
              aria-invalid={addError ? true : undefined} aria-describedby={addError ? 'kw-new-err' : undefined}
              onChange={(e) => { setNewWord(e.target.value); setAddError(null); }} />
            <button type="submit" className="adm-btn" disabled={!newWord.trim()}><Plus size={16} aria-hidden /> Add</button>
          </form>
        </div>
        {(addError || errors['localClassifier.keywords']) && (
          <p className="adm-error" id="kw-new-err" role="alert">{addError ?? errors['localClassifier.keywords']}</p>
        )}

        <div className="adm-kw">
          <ul className="adm-kw-list" aria-label="Keywords">
            {filtered.map((k) => {
              const n = (lc.synonyms[k.toLowerCase()] ?? []).length + (lc.examples[k.toLowerCase()] ?? []).length;
              return (
                <li key={k}>
                  <button type="button" className={`adm-kw-item${sel === k ? ' is-on' : ''}`} aria-pressed={sel === k} onClick={() => setSelected(k)}>
                    <span className="adm-kw-name">{k}</span>
                    {!CORE.has(k.toLowerCase()) && <span className="adm-tag-soft" title="No reaction of its own yet: plays a general cheer">general</span>}
                    <span className="adm-kw-n" aria-label={`${n} other words`}>{n}</span>
                  </button>
                </li>
              );
            })}
            {!filtered.length && <li className="adm-empty">No keyword matches "{query}".</li>}
          </ul>

          <div className="adm-kw-editor">
            {sel ? (
              <>
                <div className="adm-kw-editor-head">
                  <h4>{sel}</h4>
                  <button type="button" className="adm-btn ghost danger small" onClick={() => removeKeyword(sel)}>
                    <Trash2 size={16} aria-hidden /> Remove
                  </button>
                </div>
                {!CORE.has(key) && (
                  <p className="adm-note">"{sel}" has no reaction of its own yet, so it plays a general cheer.</p>
                )}
                <TagInput label="Other words that count" noun="word" values={lc.synonyms[key] ?? []}
                  placeholder="e.g. partying, celebrate" emptyText="Only the keyword itself."
                  check={(w) => (w.length > 50 ? 'Keep it under 50 characters.' : null)}
                  onChange={(v) => edit((d) => { d.localClassifier.synonyms[key] = v; })}
                  hint="Other forms or words that should also trigger it. Separate several with commas." />
                <TagInput variant="sentence" label="Example phrases" noun="phrase" values={lc.examples[key] ?? []}
                  placeholder="e.g. let's have a party" emptyText="No example phrases."
                  check={(w) => (w.length > 200 ? 'Keep it under 200 characters.' : null)}
                  onChange={(v) => edit((d) => { d.localClassifier.examples[key] = v; })}
                  hint={draft.intentMatchingEngine === 'local'
                    ? 'Sentences that mean this keyword. Only the AI uses them, so they have no effect with "Keywords only".'
                    : 'Sentences that mean this keyword. They help the AI recognise it when the exact word is not said.'} />
                <p className="adm-hint">
                  {usedIn.length ? `Used in: ${usedIn.map((g) => g.name).join(', ')}.` : 'Not used in any game mode.'}
                </p>
              </>
            ) : (
              <p className="adm-empty">Pick a keyword on the left to edit it.</p>
            )}
          </div>
        </div>
      </Group>
    </Section>
  );
}

/** Live "test a phrase" box: runs the classifier with the unsaved draft, so you can try edits before saving. */
function PhraseTester() {
  const { draft, call, dirtySections } = useAdmin();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ busy: boolean; matches?: string[]; engine?: string; error?: string }>({ busy: false });
  const seq = useRef(0);
  const usingDraft = dirtySections.has('intent');
  const lcJson = JSON.stringify(draft.localClassifier);
  const engine = draft.intentMatchingEngine;

  useEffect(() => {
    const lc = JSON.parse(lcJson);
    const phrase = text.trim();
    if (!phrase) { setState({ busy: false }); return; }
    const n = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      call((a) => a.testPhrase(phrase, { intentMatchingEngine: engine, localClassifier: lc }))
        .then((r) => { if (n === seq.current) setState({ busy: false, matches: r.matches, engine: r.engine }); })
        .catch((e) => { if (n === seq.current) setState({ busy: false, error: errorText(e) }); });
    }, 350);
    return () => clearTimeout(t);
  }, [text, lcJson, engine, call]);

  return (
    <Group title="Test a phrase" description={usingDraft ? 'Uses your unsaved keyword changes.' : 'Type something Cheer Bear might say.'} className="adm-tester">
      <label htmlFor="phrase" className="adm-sr">Phrase to test</label>
      <input id="phrase" className="adm-input adm-input-lg" placeholder="e.g. Let's go to my house and have a party!"
        value={text} onChange={(e) => setText(e.target.value)} aria-describedby="phrase-result" autoComplete="off" />
      <div id="phrase-result" className="adm-test-result" aria-live="polite">
        {state.busy && <span className="adm-muted"><LoaderCircle size={14} className="adm-spin" aria-hidden /> Checking…</span>}
        {!state.busy && state.error && <span className="adm-error">{state.error}</span>}
        {!state.busy && state.matches && (
          state.matches.length ? (
            <>
              <span>Triggers:</span>
              {state.matches.map((m) => <span key={m} className="adm-chip success">{m}</span>)}
            </>
          ) : <span className="adm-muted">No keyword found. Nothing would happen.</span>
        )}
        {!state.busy && state.engine && <span className="adm-muted adm-engine">Engine: {state.engine}</span>}
      </div>
    </Group>
  );
}
