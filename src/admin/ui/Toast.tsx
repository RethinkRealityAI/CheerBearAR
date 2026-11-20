import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: Tone; text: string; action?: { label: string; run: () => void } }
type Push = (tone: Tone, text: string, action?: ToastItem['action']) => void;

const ToastCtx = createContext<Push>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Small status messages, announced to screen readers. Errors stay until closed; others fade after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const close = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((tone, text, action) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-1), { id, tone, text, action }]);
    if (tone !== 'error') setTimeout(() => close(id), action ? 7000 : 3000);
  }, [close]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="adm-toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CircleCheck : t.tone === 'error' ? CircleAlert : Info;
          return (
            <div key={t.id} className={`adm-toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : undefined}>
              <Icon size={18} aria-hidden />
              <span className="adm-toast-text">{t.text}</span>
              {t.action && (
                <button type="button" className="adm-link-btn" onClick={() => { t.action!.run(); close(t.id); }}>{t.action.label}</button>
              )}
              <button type="button" className="adm-icon-btn" aria-label="Dismiss message" onClick={() => close(t.id)}>
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
