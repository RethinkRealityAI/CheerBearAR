import { LoaderCircle, Save, Undo2 } from 'lucide-react';

interface SaveBarProps {
  changes: number;
  problems: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Jump to the first problem. */
  onShowProblem?: () => void;
}

/** Sticky bar at the bottom while there are unsaved edits: "3 unsaved changes · Discard · Save". */
export function SaveBar({ changes, problems, saving, onSave, onDiscard, onShowProblem }: SaveBarProps) {
  if (!changes && !saving) return null;
  return (
    <div className="adm-savebar" role="region" aria-label="Unsaved changes">
      <div className="adm-savebar-inner">
        <p className="adm-savebar-text" aria-live="polite">
          {saving ? 'Saving…' : (
            <>
              <strong>{changes}</strong> unsaved change{changes === 1 ? '' : 's'}
              {problems > 0 && (
                <>
                  {' · '}
                  <button type="button" className="adm-link-btn danger" onClick={onShowProblem}>
                    {problems} to fix first
                  </button>
                </>
              )}
            </>
          )}
        </p>
        <div className="adm-savebar-actions">
          <button type="button" className="adm-btn ghost" onClick={onDiscard} disabled={saving}>
            <Undo2 size={16} aria-hidden /> Discard
          </button>
          <button
            type="button"
            className="adm-btn primary"
            onClick={onSave}
            disabled={saving || problems > 0}
            aria-keyshortcuts="Control+S Meta+S"
            title={problems ? 'Fix the problems marked in red first' : 'Save (Ctrl+S)'}
          >
            {saving ? <LoaderCircle size={16} className="adm-spin" aria-hidden /> : <Save size={16} aria-hidden />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
