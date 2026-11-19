import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for things that cannot be undone. */
  danger?: boolean;
}
type Confirm = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<Confirm>(async () => window.confirm('Are you sure?'));
/** `if (await confirm({...})) doIt()` */
export const useConfirm = () => useContext(ConfirmCtx);

/** One shared modal dialog (native <dialog>: focus is trapped, Escape cancels, focus returns afterwards). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (opts && d && !d.open) d.showModal();
  }, [opts]);

  const finish = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    ref.current?.close();
    setOpts(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <dialog
        ref={ref}
        className="adm-dialog"
        aria-labelledby="adm-dialog-title"
        aria-describedby="adm-dialog-msg"
        onCancel={(e) => { e.preventDefault(); finish(false); }}
        onClick={(e) => { if (e.target === ref.current) finish(false); }}
      >
        {opts && (
          <form method="dialog" className="adm-dialog-body" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
            <div className="adm-dialog-head">
              {opts.danger && <TriangleAlert size={22} className="adm-danger-icon" aria-hidden />}
              <h2 id="adm-dialog-title">{opts.title}</h2>
            </div>
            <div id="adm-dialog-msg" className="adm-dialog-msg">{opts.message}</div>
            <div className="adm-dialog-actions">
              <button type="button" className="adm-btn" onClick={() => finish(false)} autoFocus>
                {opts.cancelText ?? 'Cancel'}
              </button>
              <button type="submit" className={`adm-btn ${opts.danger ? 'danger' : 'primary'}`}>
                {opts.confirmText ?? 'Continue'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmCtx.Provider>
  );
}
