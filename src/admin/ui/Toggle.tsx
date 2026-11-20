import { useId, type ReactNode } from 'react';

interface ToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Short words shown next to the switch; defaults to On / Off. */
  onText?: string;
  offText?: string;
  compact?: boolean;
}

/** A labelled on/off switch. The whole row is the hit area; Space/Enter toggle it. */
export function Toggle({ label, hint, checked, onChange, disabled, onText = 'On', offText = 'Off', compact }: ToggleProps) {
  const id = useId();
  return (
    <div className={`adm-toggle-row${compact ? ' compact' : ''}${disabled ? ' is-disabled' : ''}`}>
      <div className="adm-toggle-text">
        <span className="adm-label" id={`${id}-l`}>{label}</span>
        {hint && <span className="adm-hint" id={`${id}-h`}>{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={disabled}
        className={`adm-switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="adm-switch-track" aria-hidden><span className="adm-switch-thumb" /></span>
        <span className="adm-switch-word" aria-hidden>{checked ? onText : offText}</span>
      </button>
    </div>
  );
}
