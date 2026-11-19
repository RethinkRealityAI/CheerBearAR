import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

interface TagInputProps {
  label: ReactNode;
  hint?: ReactNode;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** Return a plain-words problem with a new value, or null when it is fine. Duplicates are rejected for you. */
  check?: (v: string, current: string[]) => string | null;
  /** Error about the list as a whole (from the panel's validation). */
  error?: string | null;
  /** Suggestions offered while typing. */
  suggestions?: string[];
  emptyText?: string;
  /** "word" for short chips, "sentence" for a stacked list of longer lines. */
  variant?: 'word' | 'sentence';
  /** Text for the remove buttons, e.g. "synonym". */
  noun?: string;
  path?: string;
}

/**
 * A list of words or sentences. Type and press Enter (or the Add button) to add; commas also split words.
 * Each item has its own remove button so it works with keyboard and screen readers.
 */
export function TagInput({
  label, hint, values, onChange, placeholder, check, error, suggestions, emptyText = 'None yet.', variant = 'word', noun = 'item', path,
}: TagInputProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const parts = (variant === 'word' ? text.split(',') : [text]).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    let next = [...values];
    for (const p of parts) {
      if (next.some((v) => v.toLowerCase() === p.toLowerCase())) { setProblem(`"${p}" is already in the list.`); return; }
      const msg = check?.(p, next);
      if (msg) { setProblem(msg); return; }
      next = [...next, p];
    }
    onChange(next);
    setText('');
    setProblem(null);
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
    else if (e.key === ',' && variant === 'word') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !text && values.length && variant === 'word') remove(values.length - 1);
  };

  const shownError = problem ?? error;
  const errId = shownError ? `${id}-err` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const listId = suggestions?.length ? `${id}-list` : undefined;

  return (
    <div className={`adm-field adm-tags ${variant}${shownError ? ' has-error' : ''}`} data-path={path}>
      <div className="adm-field-head">
        <label className="adm-label" htmlFor={id}>{label}</label>
        <span className="adm-count">{values.length}</span>
      </div>
      {values.length ? (
        <ul className={variant === 'word' ? 'adm-chips' : 'adm-lines'} aria-label={typeof label === 'string' ? label : undefined}>
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className={variant === 'word' ? 'adm-chip' : 'adm-line'}>
              <span>{v}</span>
              <button type="button" className="adm-chip-x" aria-label={`Remove ${noun} "${v}"`} onClick={() => remove(i)}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-empty">{emptyText}</p>
      )}
      <div className="adm-tag-add">
        <input
          id={id}
          className="adm-input"
          value={text}
          placeholder={placeholder}
          list={listId}
          aria-describedby={[errId, hintId].filter(Boolean).join(' ') || undefined}
          aria-invalid={shownError ? true : undefined}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setProblem(null); }}
          onKeyDown={onKey}
        />
        <button type="button" className="adm-btn" onClick={add} disabled={!text.trim()}>
          <Plus size={16} aria-hidden /> Add
        </button>
        {listId && (
          <datalist id={listId}>
            {suggestions!.filter((s) => !values.includes(s)).map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </div>
      {shownError && <p className="adm-error" id={errId} role={problem ? 'alert' : undefined}>{shownError}</p>}
      {hint && <p className="adm-hint" id={hintId}>{hint}</p>}
    </div>
  );
}
