import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { AdminApi, DeepPartial } from '@/shared/contracts';
import type { AppConfig } from '@/shared/config';
import { changedPaths, clone, diffPatch, pathIn, setIn } from './lib/configDiff';
import { validateConfig, type Errors } from './lib/validate';
import { KNOWN_KEYS, OBSOLETE_KEYS, SECTIONS, sectionForPath, type SectionId } from './lib/sections';
import { errorText } from './api';
import { useToast } from './ui';

export interface AdminStore {
  api: AdminApi;
  source: 'real' | 'mock';
  saved: AppConfig;
  draft: AppConfig;
  /** Change the draft: `edit(d => { d.triggerPolicy.triggerCooldownMs = 2000 })`. */
  edit: (recipe: (d: AppConfig) => void) => void;
  /** Change one value by dotted path (used by the generic field renderer). */
  setPath: (path: string, value: unknown) => void;
  errors: Errors;
  changed: string[];
  /** Top-level config keys the panel has no page for (shown under "Other settings"). */
  extraKeys: string[];
  dirtySections: Set<SectionId>;
  errorSections: Map<SectionId, number>;
  saving: boolean;
  save: () => Promise<void>;
  discard: () => void;
  /** Replace both copies after a reset / restore (the server already saved it). */
  adopt: (config: AppConfig) => void;
  /** Load a whole config into the draft only (import): you review, then Save. */
  loadDraft: (config: AppConfig) => void;
  /** Run an API call; a sign-in problem signs you out (keeping your edits) instead of showing a raw error. */
  call: <T>(fn: (api: AdminApi) => Promise<T>) => Promise<T>;
  section: SectionId;
  go: (id: SectionId, focusPath?: string) => void;
}

const Ctx = createContext<AdminStore | null>(null);
export function useAdmin(): AdminStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAdmin outside AdminProvider');
  return s;
}

interface ProviderProps {
  api: AdminApi;
  source: 'real' | 'mock';
  initial: AppConfig;
  initialDraft?: AppConfig;
  call: AdminStore['call'];
  section: SectionId;
  go: AdminStore['go'];
  /** Filled with a function returning the unsaved edits as a patch (kept across a sign-out). */
  pendingRef: MutableRefObject<(() => unknown) | null>;
  children: ReactNode;
}

export function AdminProvider({ api, source, initial, initialDraft, call, section, go, pendingRef, children }: ProviderProps) {
  const toast = useToast();
  const [saved, setSaved] = useState<AppConfig>(initial);
  const [draft, setDraft] = useState<AppConfig>(initialDraft ?? initial);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  /** Last copy the server confirmed (the optimistic `saved` may be ahead of it while a save is in flight). */
  const confirmedRef = useRef(initial);
  useEffect(() => {
    pendingRef.current = () => diffPatch(confirmedRef.current, draftRef.current);
    return () => { pendingRef.current = null; };
  }, [pendingRef]);

  const edit = useCallback((recipe: (d: AppConfig) => void) => {
    setDraft((prev) => {
      const next = clone(prev);
      recipe(next);
      return next;
    });
  }, []);
  const setPath = useCallback((path: string, value: unknown) => setDraft((prev) => setIn(prev, path, value)), []);

  const extraKeys = useMemo(
    () => Object.keys(draft).filter((k) => !KNOWN_KEYS.includes(k) && !OBSOLETE_KEYS.includes(k)),
    [draft],
  );
  const changed = useMemo(
    () => changedPaths(saved, draft).filter((p) => !OBSOLETE_KEYS.some((k) => pathIn(p, k))),
    [saved, draft],
  );
  const errors = useMemo(() => validateConfig(draft), [draft]);

  const dirtySections = useMemo(() => {
    const s = new Set<SectionId>();
    for (const p of changed) { const id = sectionForPath(p, extraKeys); if (id) s.add(id); }
    return s;
  }, [changed, extraKeys]);
  const errorSections = useMemo(() => {
    const m = new Map<SectionId, number>();
    for (const p of Object.keys(errors)) { const id = sectionForPath(p, extraKeys); if (id) m.set(id, (m.get(id) ?? 0) + 1); }
    return m;
  }, [errors, extraKeys]);

  const save = useCallback(async () => {
    const before = savedRef.current;
    const sent = draftRef.current;
    const patch = diffPatch(before, sent) as DeepPartial<AppConfig> | undefined;
    if (!patch) return;
    if (Object.keys(validateConfig(sent)).length) { toast('error', 'Fix the problems marked in red, then save again.'); return; }
    // Optimistic: treat the draft as saved straight away; roll back if the server says no.
    setSaving(true);
    setSaved(sent);
    try {
      const result = await call((a) => a.updateConfig(patch));
      confirmedRef.current = result;
      setSaved(result);
      // If nothing was edited while saving, adopt the server's copy (it may normalise values).
      setDraft((cur) => (cur === sent ? result : cur));
      toast('success', 'Saved. Visitors get the new settings within a minute (or when they reopen the page).');
    } catch (err) {
      setSaved(before);
      toast('error', `Not saved: ${errorText(err)} Your changes are still here; try Save again.`);
    } finally {
      setSaving(false);
    }
  }, [call, toast]);

  const discard = useCallback(() => setDraft(savedRef.current), []);
  const adopt = useCallback((c: AppConfig) => { confirmedRef.current = c; setSaved(c); setDraft(c); }, []);
  const loadDraft = useCallback((c: AppConfig) => setDraft(c), []);

  const value: AdminStore = {
    api, source, saved, draft, edit, setPath, errors, changed, extraKeys, dirtySections, errorSections, saving, save,
    discard, adopt, loadDraft, call, section, go,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { SECTIONS };
