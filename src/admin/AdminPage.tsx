// The admin panel (/admin). Loads the admin API (the real one from src/voice, or the in-browser mock), shows the
// sign-in screen, then the panel. Sections live in ./sections, the form kit in ./ui. See docs/handoff/admin-ui.md.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import '@/shared/theme.css';
import './admin.css';
import type { AdminApi } from '@/shared/contracts';
import type { AppConfig } from '@/shared/config';
import { errorText, isAuthError, loadAdminApi, type LoadedApi } from './api';
import { AdminProvider } from './AdminContext';
import { AdminShell } from './AdminShell';
import { LoginScreen } from './LoginScreen';
import { deepMerge, isPlainObject } from './lib/configDiff';
import { sectionById, type SectionId } from './lib/sections';
import { ConfirmProvider, ToastProvider, useToast } from './ui';

export default function AdminPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Admin · Cheer Bear';
    return () => { document.title = prev; };
  }, []);
  return (
    <div className="adm-root">
      <ToastProvider>
        <ConfirmProvider>
          <AdminRoot />
        </ConfirmProvider>
      </ToastProvider>
    </div>
  );
}

type Phase = 'api' | 'login' | 'config' | 'ready' | 'fatal';

function readSection(): SectionId {
  const h = window.location.hash.replace(/^#/, '');
  return sectionById(h)?.id ?? 'overview';
}

function AdminRoot() {
  const toast = useToast();
  const [loaded, setLoaded] = useState<LoadedApi | null>(null);
  const [phase, setPhase] = useState<Phase>('api');
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<{ saved: AppConfig; draft?: AppConfig } | null>(null);
  const [section, setSection] = useState<SectionId>(readSection);
  const pendingRef = useRef<(() => unknown) | null>(null);
  const keptEdits = useRef<unknown>(null);

  useEffect(() => {
    let alive = true;
    loadAdminApi()
      .then((l) => { if (!alive) return; setLoaded(l); setPhase(l.api.loggedIn ? 'config' : 'login'); })
      .catch((e) => { if (!alive) return; setFatal(errorText(e)); setPhase('fatal'); });
    return () => { alive = false; };
  }, []);

  const expire = useCallback((api: AdminApi) => {
    const pending = pendingRef.current?.();
    if (pending) keptEdits.current = pending;
    try { api.logout(); } catch { /* already signed out */ }
    setConfig(null);
    setNotice(pending
      ? 'Your sign-in expired. Sign in again: your unsaved changes are kept.'
      : 'Your sign-in expired. Please sign in again.');
    setPhase('login');
  }, []);

  const call = useCallback(async <T,>(fn: (api: AdminApi) => Promise<T>): Promise<T> => {
    const api = loaded!.api;
    try {
      return await fn(api);
    } catch (err) {
      if (isAuthError(err, api)) {
        expire(api);
        throw new Error('Your sign-in expired.');
      }
      throw err;
    }
  }, [loaded, expire]);

  // Fetch the config once signed in.
  useEffect(() => {
    if (phase !== 'config' || !loaded) return;
    let alive = true;
    loaded.api.getConfig()
      .then((saved) => {
        if (!alive) return;
        const kept = keptEdits.current;
        keptEdits.current = null;
        if (isPlainObject(kept)) {
          setConfig({ saved, draft: deepMerge(saved, kept) });
          toast('info', 'Your unsaved changes were kept. Review them and press Save.');
        } else setConfig({ saved });
        setNotice(null);
        setPhase('ready');
      })
      .catch((err) => {
        if (!alive) return;
        if (isAuthError(err, loaded.api)) { setNotice('Please sign in.'); setPhase('login'); return; }
        setFatal(`Could not load the settings: ${errorText(err)}`);
        setPhase('fatal');
      });
    return () => { alive = false; };
  }, [phase, loaded, toast]);

  // Section in the URL hash, so the phone's back button and links work.
  useEffect(() => {
    const onHash = () => setSection(readSection());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id: SectionId, focusPath?: string) => {
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    setSection(id);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      const target = focusPath
        ? document.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"] input, [data-path="${CSS.escape(focusPath)}"] textarea, [data-path="${CSS.escape(focusPath)}"] select, [data-path="${CSS.escape(focusPath)}"] button`)
        : null;
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'center' });
      } else document.querySelector<HTMLElement>('[data-section-title]')?.focus();
    });
  }, []);

  if (phase === 'fatal') {
    return (
      <main className="adm-login">
        <div className="adm-login-card" role="alert">
          <h1 className="adm-login-title">The admin panel can't start</h1>
          <p className="adm-login-lead">{fatal}</p>
          <button type="button" className="adm-btn primary block" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </main>
    );
  }
  if (!loaded || phase === 'api' || phase === 'config' || (phase === 'ready' && !config)) {
    return (
      <main className="adm-loading" aria-busy="true">
        <LoaderCircle size={28} className="adm-spin" aria-hidden />
        <span>Loading settings…</span>
      </main>
    );
  }
  if (phase === 'login') {
    return <LoginScreen api={loaded.api} source={loaded.source} notice={notice} onDone={() => setPhase('config')} />;
  }

  return (
    <AdminProvider
      api={loaded.api}
      source={loaded.source}
      initial={config!.saved}
      initialDraft={config!.draft}
      call={call}
      section={section}
      go={go}
      pendingRef={pendingRef}
    >
      <AdminShell mockReason={loaded.source === 'mock' ? loaded.reason : undefined}
        onSignedOut={() => { setConfig(null); setNotice('You are signed out.'); setPhase('login'); }} />
    </AdminProvider>
  );
}
