import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { useApp } from '../context';

/** One toast at a time, centred under the game chip. Found words get the celebration look. */
export function Toast() {
  const toast = useApp((s) => s.toast);
  return (
    <div className="cb-toast-slot" role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div key={toast.id} className={`cb-toast is-${toast.kind}`}>
          {toast.kind === 'found' && (
            <span className="cb-toast-stripes" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
          )}
          {toast.kind === 'found' ? <CheckCircle2 aria-hidden="true" size={20} />
            : toast.kind === 'error' ? <TriangleAlert aria-hidden="true" size={20} /> : <Info aria-hidden="true" size={20} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
