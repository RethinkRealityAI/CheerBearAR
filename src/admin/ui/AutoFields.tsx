import { isPlainObject } from '../lib/configDiff';
import { HEX_RE } from '../lib/validate';
import { ColorField } from './ColorField';
import { TextField } from './Field';
import { NumberField } from './NumberField';
import { TagInput } from './TagInput';
import { Toggle } from './Toggle';

export interface FieldMeta {
  label?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  slider?: boolean;
  hidden?: boolean;
}

interface AutoFieldsProps {
  value: Record<string, unknown>;
  /** Dotted path of `value` inside the config (for change callbacks and errors). */
  path: string;
  onChange: (path: string, v: unknown) => void;
  errors?: Record<string, string>;
  /** Labels, helper text and ranges by key name or by full dotted path. */
  meta?: Record<string, FieldMeta>;
  /** Nesting level (internal). */
  depth?: number;
}

/** "triggerCooldownMs" -> "Trigger cooldown ms" */
export function humanize(key: string) {
  const s = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Renders any settings object from the types of its current values: on/off -> switch, number -> number box,
 * text -> text box (colour picker for #rrggbb), word list -> chips, nested object -> sub-group. New fields added to the
 * config later appear here without code changes; give them nicer words through `meta`.
 */
export function AutoFields({ value, path, onChange, errors = {}, meta = {}, depth = 0 }: AutoFieldsProps) {
  const entries = Object.entries(value);
  if (!entries.length) return <p className="adm-empty">No settings here yet.</p>;
  return (
    <div className={`adm-auto depth-${depth}`}>
      {entries.map(([key, v]) => {
        const p = path ? `${path}.${key}` : key;
        const m: FieldMeta = { ...meta[key], ...meta[p] };
        if (m.hidden) return null;
        const label = m.label ?? humanize(key);
        const set = (nv: unknown) => onChange(p, nv);
        const err = errors[p];
        if (typeof v === 'boolean') return <Toggle key={key} label={label} hint={m.hint} checked={v} onChange={set} />;
        if (typeof v === 'number') {
          const unit = m.unit ?? (/Ms$/.test(key) ? 'ms' : undefined);
          return (
            <NumberField key={key} path={p} label={label} hint={m.hint} value={v} onChange={set} error={err}
              min={m.min} max={m.max} step={m.step ?? (Number.isInteger(v) && !(m.max !== undefined && m.max <= 1) ? 1 : 0.01)}
              unit={unit} slider={m.slider ?? (m.min !== undefined && m.max !== undefined)} />
          );
        }
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          return <TagInput key={key} path={p} label={label} hint={m.hint} values={v as string[]} onChange={set} error={err} />;
        }
        if (isPlainObject(v)) {
          return (
            <fieldset key={key} className="adm-subgroup">
              <legend>{label}</legend>
              {m.hint && <p className="adm-hint">{m.hint}</p>}
              <AutoFields value={v} path={p} onChange={onChange} errors={errors} meta={meta} depth={depth + 1} />
            </fieldset>
          );
        }
        if (typeof v === 'string' && HEX_RE.test(v)) {
          return <ColorField key={key} path={p} label={label} hint={m.hint} value={v} onChange={set} error={err} />;
        }
        if (typeof v === 'string' || v === undefined || v === null) {
          return (
            <TextField key={key} path={p} label={label} hint={m.hint} value={(v as string | undefined) ?? ''} error={err}
              onChange={(s) => set(s)} placeholder={v == null ? 'Not set' : undefined}
              type={/url$/i.test(key) ? 'url' : 'text'} />
          );
        }
        return (
          <div key={key} className="adm-field">
            <span className="adm-label">{label}</span>
            <pre className="adm-pre">{JSON.stringify(v, null, 2)}</pre>
            <p className="adm-hint">This kind of setting can only be changed with Import (JSON) for now.</p>
          </div>
        );
      })}
    </div>
  );
}
