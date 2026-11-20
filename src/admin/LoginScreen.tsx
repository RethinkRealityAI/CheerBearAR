import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, Lock } from 'lucide-react';
import type { AdminApi } from '@/shared/contracts';
import { errorText } from './api';

interface LoginProps {
  api: AdminApi;
  source: 'real' | 'mock';
  /** Why the sign-in screen is showing again (e.g. the session expired). */
  notice?: string | null;
  onDone: () => void;
}

export function LoginScreen({ api, source, notice, onDone }: LoginProps) {
  const id = useId();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  useEffect(() => { userRef.current?.focus(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !pass) { setError('Enter your username and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.login(user.trim(), pass);
      onDone();
    } catch (err) {
      const msg = errorText(err);
      setError(/401|unauthori|invalid|incorrect|not right/i.test(msg) ? 'That username or password is not right.' : msg);
      setBusy(false);
    }
  };

  return (
    <main className="adm-login">
      <form className="adm-login-card" onSubmit={submit} noValidate aria-describedby={error ? `${id}-err` : undefined}>
        <div className="adm-login-mark" aria-hidden><Lock size={22} /></div>
        <h1 className="adm-login-title">Cheer Bear admin</h1>
        <p className="adm-login-lead">Sign in to change how Cheer Bear behaves for everyone.</p>
        {notice && <p className="adm-notice" role="status">{notice}</p>}
        {source === 'mock' && (
          <p className="adm-notice practice">Practice mode: any username, password <code>demo</code>.</p>
        )}
        <div className="adm-field">
          <label className="adm-label" htmlFor={`${id}-u`}>Username</label>
          <input id={`${id}-u`} ref={userRef} className="adm-input" autoComplete="username" autoCapitalize="none"
            spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} aria-invalid={error ? true : undefined} />
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor={`${id}-p`}>Password</label>
          <div className="adm-pass">
            <input id={`${id}-p`} className="adm-input" type={show ? 'text' : 'password'} autoComplete="current-password"
              value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={error ? true : undefined} />
            <button type="button" className="adm-icon-btn" onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
        </div>
        {error && <p className="adm-error" id={`${id}-err`} role="alert">{error}</p>}
        <button type="submit" className="adm-btn primary block" disabled={busy}>
          {busy && <LoaderCircle size={16} className="adm-spin" aria-hidden />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
