import { useEffect, useState } from 'react';
import { Field, type FieldProps } from './Field';
import { HEX_RE } from '../lib/validate';

interface ColorFieldProps extends Omit<FieldProps, 'children'> {
  value: string;
  onChange: (v: string) => void;
  /** Quick picks (theme colours). */
  swatches?: { name: string; value: string }[];
}

/** Colour picker + hex box. Typing a partial hex keeps it local until it is a full #rrggbb. */
export function ColorField({ value, onChange, swatches, ...field }: ColorFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const set = (v: string) => {
    let s = v.trim();
    if (s && !s.startsWith('#')) s = `#${s}`;
    setText(s);
    onChange(s.toLowerCase());
  };
  return (
    <Field {...field}>
      {(a) => (
        <div className="adm-color">
          <span className="adm-color-chip" style={{ background: HEX_RE.test(text) ? text : 'transparent' }} aria-hidden>
            <input
              type="color"
              value={HEX_RE.test(value) ? value : '#000000'}
              onChange={(e) => set(e.target.value)}
              aria-label={typeof field.label === 'string' ? `Pick ${field.label.toLowerCase()}` : 'Pick a colour'}
              tabIndex={-1}
            />
          </span>
          <input
            {...a}
            className="adm-input adm-color-hex"
            value={text}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => set(e.target.value)}
          />
          {swatches && (
            <div className="adm-swatches" role="group" aria-label="Brand colours">
              {swatches.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`adm-swatch${s.value.toLowerCase() === value.toLowerCase() ? ' is-on' : ''}`}
                  style={{ background: s.value }}
                  title={`${s.name} ${s.value}`}
                  aria-label={`Use ${s.name} (${s.value})`}
                  onClick={() => set(s.value)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
