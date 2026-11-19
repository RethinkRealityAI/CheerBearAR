import { useRef, useState } from 'react';
import { Copy, Download, RotateCcw, Upload } from 'lucide-react';
import type { AppConfig } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { errorText } from '../api';
import { changedPaths, clone, deepMerge, isPlainObject } from '../lib/configDiff';
import { KNOWN_KEYS, OBSOLETE_KEYS } from '../lib/sections';
import { Group, Section, useConfirm, useToast } from '../ui';

/** Accepts a config, or an object wrapping one ({ config: {...} }, as the old panel's API returned). */
export function parseImport(text: string, base: AppConfig): { config: AppConfig; unknown: string[]; changes: number } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('This is not valid JSON. Check that you copied the whole file.'); }
  if (isPlainObject(data) && isPlainObject(data.config)) data = data.config;
  if (!isPlainObject(data)) throw new Error('The file should contain one settings object ({ … }).');
  const known = Object.keys(data).filter((k) => KNOWN_KEYS.includes(k) || k in base);
  if (!known.length) throw new Error('No Cheer Bear settings found in this file.');
  for (const k of OBSOLETE_KEYS) delete data[k];
  const unknown = Object.keys(data).filter((k) => !KNOWN_KEYS.includes(k) && !(k in base));
  for (const k of unknown) delete data[k];
  const config = deepMerge(clone(base), data);
  return { config, unknown, changes: changedPaths(base, config).length };
}

export function BackupSection() {
  const { saved, draft, changed, loadDraft, call, adopt, go } = useAdmin();
  const confirm = useConfirm();
  const toast = useToast();
  const [paste, setPaste] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = () => JSON.stringify(saved, null, 2);

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cheer-bear-settings-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('success', 'Settings downloaded.');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportJson()); toast('success', 'Settings copied to the clipboard.'); }
    catch { toast('error', 'Copying is blocked in this browser. Use Download instead.'); }
  };

  const doImport = async (text: string) => {
    setImportError(null);
    try {
      const { config, unknown, changes } = parseImport(text, saved);
      if (changed.length && !(await confirm({
        title: 'Replace your unsaved changes?',
        message: `The imported settings replace your ${changed.length} unsaved change${changed.length === 1 ? '' : 's'}.`,
        confirmText: 'Import', danger: true,
      }))) return;
      loadDraft(config);
      setPaste('');
      toast('info', changes
        ? `Imported ${changes} change${changes === 1 ? '' : 's'} into your draft. Check them, then press Save.${unknown.length ? ` Ignored: ${unknown.join(', ')}.` : ''}`
        : 'The imported settings are the same as the saved ones.');
      if (changes) go('overview');
    } catch (e) {
      setImportError(errorText(e));
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) { setImportError('That file is too big to be a settings file.'); return; }
    await doImport(await f.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Reset everything to defaults?',
      danger: true,
      confirmText: 'Reset all settings',
      message: (
        <>
          <p>Keywords, game modes, texts, colours and every other setting go back to how Cheer Bear shipped. Visitors get this straight away.</p>
          <p>The current settings stay in History, so you can restore them.</p>
        </>
      ),
    });
    if (!ok) return;
    try {
      adopt(await call((a) => a.resetConfig()));
      toast('success', 'All settings are back to the defaults.');
    } catch (e) {
      toast('error', `Could not reset: ${errorText(e)}`);
    }
  };

  return (
    <Section title="Import, export & reset" description="Keep a copy of the settings, move them between sites, or start over.">
      <Group title="Export" description={changed.length ? 'Exports the saved settings. Save first if you want your current changes included.' : 'A JSON file with every saved setting.'}>
        <div className="adm-inline">
          <button type="button" className="adm-btn primary" onClick={download}><Download size={16} aria-hidden /> Download settings</button>
          <button type="button" className="adm-btn" onClick={copy}><Copy size={16} aria-hidden /> Copy as text</button>
        </div>
      </Group>

      <Group title="Import" description="Loads a settings file into your draft. Nothing changes for visitors until you press Save.">
        <div className="adm-inline">
          <input ref={fileRef} id="import-file" type="file" accept="application/json,.json" className="adm-sr"
            onChange={(e) => void onFile(e.target.files?.[0])} />
          <label htmlFor="import-file" className="adm-btn" tabIndex={0} role="button"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
            <Upload size={16} aria-hidden /> Choose a file…
          </label>
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="import-paste">Or paste the JSON</label>
          <textarea id="import-paste" className="adm-input adm-textarea adm-mono" rows={5} value={paste}
            placeholder='{ "modeDefault": "calm", … }' spellCheck={false}
            aria-invalid={importError ? true : undefined} aria-describedby={importError ? 'import-err' : undefined}
            onChange={(e) => { setPaste(e.target.value); setImportError(null); }} />
        </div>
        {importError && <p className="adm-error" id="import-err" role="alert">{importError}</p>}
        <div>
          <button type="button" className="adm-btn" disabled={!paste.trim()} onClick={() => void doImport(paste)}>Import pasted text</button>
        </div>
      </Group>

      <Group title="Reset to defaults" tone="danger" description="Throws away every change ever made and goes back to the original settings.">
        <div>
          <button type="button" className="adm-btn danger" onClick={reset}><RotateCcw size={16} aria-hidden /> Reset all settings…</button>
        </div>
        {draft !== saved && changed.length > 0 && <p className="adm-hint">Your unsaved changes would be lost too.</p>}
      </Group>
    </Section>
  );
}
