import { useId, type ReactNode } from 'react';
import { Field, type FieldProps } from './Field';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Explains this choice; shown under the control when it is selected. */
  description?: string;
  disabled?: boolean;
}

interface SelectProps<T extends string> extends Omit<FieldProps, 'children' | 'hint'> {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  /** Show the options as a row of big radio cards instead of a dropdown (good for 2-4 choices). */
  asCards?: boolean;
}

export function Select<T extends string>({ value, options, onChange, hint, asCards, ...field }: SelectProps<T>) {
  const name = useId();
  const current = options.find((o) => o.value === value);
  const desc = current?.description;
  const fullHint = desc || hint ? <>{desc}{desc && hint ? ' ' : ''}{hint}</> : undefined;

  if (asCards) {
    return (
      <fieldset className={`adm-field adm-fieldset${field.error ? ' has-error' : ''}`} data-path={field.path}>
        <legend className="adm-label">{field.label}</legend>
        {hint && <p className="adm-hint adm-hint-top">{hint}</p>}
        <div className="adm-cards">
          {options.map((o) => (
            <label key={o.value} className={`adm-card-option${o.value === value ? ' is-on' : ''}${o.disabled ? ' is-disabled' : ''}`}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={o.value === value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              <span className="adm-card-title">{o.label}</span>
              {o.description && <span className="adm-card-desc">{o.description}</span>}
            </label>
          ))}
        </div>
        {field.error && <p className="adm-error" role="alert">{field.error}</p>}
      </fieldset>
    );
  }

  return (
    <Field {...field} hint={fullHint}>
      {(a) => (
        <div className="adm-select-wrap">
          <select {...a} className="adm-input adm-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
    </Field>
  );
}
