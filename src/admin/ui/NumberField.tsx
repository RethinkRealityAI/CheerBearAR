import { useEffect, useState } from 'react';
import { Field, type FieldProps } from './Field';

interface NumberFieldProps extends Omit<FieldProps, 'children'> {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the box, e.g. "ms". Milliseconds also show the value in seconds. */
  unit?: string;
  /** Also show a slider (needs min and max). */
  slider?: boolean;
}

function fmtSeconds(ms: number) {
  if (!Number.isFinite(ms)) return '';
  if (ms === 0) return 'no wait';
  const s = ms / 1000;
  return `${s % 1 === 0 ? s : s.toFixed(s < 1 ? 2 : 1)} second${s === 1 ? '' : 's'}`;
}

/**
 * Number input that keeps what you type (so you can clear the box and type again) and only reports real numbers.
 * Range problems come from the panel's validation, so the message sits under the field like every other error.
 */
export function NumberField({ value, onChange, min, max, step = 1, unit, slider, error, ...field }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setText(value === undefined ? '' : String(value));
  }, [value, typing]);

  const parsed = text.trim() === '' ? NaN : Number(text);
  const localError = Number.isFinite(parsed) || value === undefined ? null : 'Enter a number.';

  const commit = (s: string) => {
    setText(s);
    const n = Number(s);
    if (s.trim() !== '' && Number.isFinite(n)) onChange(n);
  };

  const seconds = unit === 'ms' && typeof value === 'number' ? fmtSeconds(value) : null;

  return (
    <Field {...field} error={localError ?? error}>
      {(a) => (
        <div className="adm-number">
          <div className="adm-number-box">
            <input
              {...a}
              className="adm-input"
              type="number"
              inputMode={step % 1 === 0 ? 'numeric' : 'decimal'}
              min={min}
              max={max}
              step={step}
              value={text}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onChange={(e) => commit(e.target.value)}
            />
            {unit && <span className="adm-unit" aria-hidden>{unit}</span>}
          </div>
          {slider && min !== undefined && max !== undefined && (
            <input
              className="adm-range"
              type="range"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(parsed) ? parsed : min}
              aria-label={typeof field.label === 'string' ? `${field.label} slider` : 'Slider'}
              onChange={(e) => commit(e.target.value)}
              tabIndex={-1}
            />
          )}
          {seconds && <span className="adm-number-note" aria-live="polite">{seconds}</span>}
        </div>
      )}
    </Field>
  );
}
