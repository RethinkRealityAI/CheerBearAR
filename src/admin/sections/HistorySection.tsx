import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useAdmin } from '../AdminContext';
import { errorText } from '../api';
import { Group, Section, useConfirm, useToast } from '../ui';

type Entry = { id: string; at: string; by: string; summary: string };

function ago(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function HistorySection() {
  const { call, adopt, changed } = useAdmin();
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    call((a) => a.history()).then(setItems).catch((e) => setError(errorText(e)));
  }, [call]);
  useEffect(load, [load]);

  const restore = async (e: Entry, latest: boolean) => {
    const ok = await confirm({
      title: 'Restore this version?',
      confirmText: 'Restore',
      danger: changed.length > 0,
      message: (
        <>
          <p>All settings go back to how they were after "{e.summary}" ({new Date(e.at).toLocaleString()}). Visitors get them straight away.</p>
          {changed.length > 0 && <p><strong>Your {changed.length} unsaved change{changed.length === 1 ? '' : 's'} will be lost.</strong></p>}
          {latest && <p>This is already the newest version.</p>}
          <p>The current settings stay in the history, so you can switch back.</p>
        </>
      ),
    });
    if (!ok) return;
    setBusy(e.id);
    try {
      const cfg = await call((a) => a.restore(e.id));
      adopt(cfg);
      toast('success', 'Version restored and saved.');
      load();
    } catch (err) {
      toast('error', `Could not restore: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="History" description="Every save is kept here. Restore an earlier version if something went wrong."
      actions={<button type="button" className="adm-btn" onClick={load}><RefreshCw size={16} aria-hidden /> Refresh</button>}>
      <Group>
        {error && <p className="adm-error" role="alert">Could not load the history: {error}</p>}
        {!items && !error && <p className="adm-muted"><LoaderCircle size={14} className="adm-spin" aria-hidden /> Loading…</p>}
        {items && !items.length && <p className="adm-empty">No saved versions yet. Each time you press Save, a version appears here.</p>}
        {items && items.length > 0 && (
          <ol className="adm-history">
            {items.map((e, i) => (
              <li key={e.id} className="adm-history-item">
                <div className="adm-history-text">
                  <p className="adm-history-summary">{e.summary || 'Saved'}{i === 0 && <span className="adm-tag-soft">Current</span>}</p>
                  <p className="adm-hint">
                    <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>{ago(e.at)}</time>
                    {' · '}{new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {e.by ? ` · by ${e.by}` : ''}
                  </p>
                </div>
                <button type="button" className="adm-btn small" disabled={!!busy} onClick={() => restore(e, i === 0)}
                  aria-label={`Restore the version from ${new Date(e.at).toLocaleString()}`}>
                  {busy === e.id ? <LoaderCircle size={16} className="adm-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
                  Restore
                </button>
              </li>
            ))}
          </ol>
        )}
      </Group>
    </Section>
  );
}
