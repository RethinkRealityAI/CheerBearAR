import { useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export interface FieldA11y {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** What the setting does to the experience, in plain words. */
  hint?: ReactNode;
  error?: string | null;
  /** Shown to the right of the label (e.g. "Changed"). */
  aside?: ReactNode;
  className?: string;
  /** Dotted config path; lets "fix first" jump straight to this field. */
  path?: string;
  children: (a11y: FieldA11y) => ReactNode;
}

/** Label + control + helper text + inline error, wired together for screen readers. */
export function Field({ label, hint, error, aside, className, path, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`adm-field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`} data-path={path}>
      <div className="adm-field-head">
        <label className="adm-label" htmlFor={id}>{label}</label>
        {aside}
      </div>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p className="adm-error" id={errId}>
          <CircleAlert size={14} aria-hidden /> {error}
        </p>
      )}
      {hint && <p className="adm-hint" id={hintId}>{hint}</p>}
    </div>
  );
}

interface TextProps extends Omit<FieldProps, 'children'> {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'tel' | 'search';
  maxLength?: number;
  autoComplete?: string;
  inputMode?: 'text' | 'url' | 'tel' | 'numeric';
}

export function TextField({ value, onChange, placeholder, type = 'text', maxLength, autoComplete, inputMode, ...field }: TextProps) {
  return (
    <Field {...field}>
      {(a) => (
        <input
          {...a}
          className="adm-input"
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete ?? 'off'}
          inputMode={inputMode}
          spellCheck={type === 'text'}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, maxLength, ...field }: Omit<TextProps, 'type'> & { rows?: number }) {
  return (
    <Field {...field}>
      {(a) => (
        <textarea
          {...a}
          className="adm-input adm-textarea"
          rows={rows}
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
