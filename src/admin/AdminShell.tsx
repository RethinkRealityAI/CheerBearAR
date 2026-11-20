import { useEffect, type ReactNode } from 'react';
import { FlaskConical, LogOut } from 'lucide-react';
import { useAdmin } from './AdminContext';
import { SECTIONS, sectionById, sectionForPath, type SectionDef, type SectionId } from './lib/sections';
import { SaveBar, useConfirm } from './ui';
import { OverviewSection } from './sections/OverviewSection';
import { ModeSection } from './sections/ModeSection';
import { PrivacySection } from './sections/PrivacySection';
import { IntentSection } from './sections/IntentSection';
import { TriggerSection } from './sections/TriggerSection';
import { SmsSection } from './sections/SmsSection';
import { GameModesSection } from './sections/GameModesSection';
import { UiSection } from './sections/UiSection';
import { LipSyncSection } from './sections/LipSyncSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { HistorySection } from './sections/HistorySection';
import { BackupSection } from './sections/BackupSection';

const VIEWS: Record<SectionId, () => ReactNode> = {
  overview: () => <OverviewSection />,
  mode: () => <ModeSection />,
  privacy: () => <PrivacySection />,
  intent: () => <IntentSection />,
  triggers: () => <TriggerSection />,
  sms: () => <SmsSection />,
  games: () => <GameModesSection />,
  ui: () => <UiSection />,
  lipsync: () => <LipSyncSection />,
  advanced: () => <AdvancedSection />,
  history: () => <HistorySection />,
  backup: () => <BackupSection />,
};

const GROUP_TITLES: Record<SectionDef['group'], string> = {
  start: '', behaviour: 'Behaviour', content: 'Content', tools: 'Tools',
};

export function AdminShell({ mockReason, onSignedOut }: { mockReason?: string; onSignedOut: () => void }) {
  const s = useAdmin();
  const confirm = useConfirm();
  const visible = SECTIONS.filter((x) => x.id !== 'advanced' || s.extraKeys.length > 0);
  const current = sectionById(s.section) && visible.some((v) => v.id === s.section) ? s.section : 'overview';
  const problems = Object.keys(s.errors);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!s.changed.length) return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [s.changed.length]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (s.changed.length && !s.saving) void s.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const signOut = async () => {
    if (s.changed.length && !(await confirm({
      title: 'Sign out without saving?',
      message: `You have ${s.changed.length} unsaved change${s.changed.length === 1 ? '' : 's'}. They will be lost.`,
      confirmText: 'Sign out', danger: true,
    }))) return;
    s.api.logout();
    onSignedOut();
  };

  const discard = async () => {
    if (await confirm({
      title: 'Discard your changes?',
      message: `This throws away ${s.changed.length} unsaved change${s.changed.length === 1 ? '' : 's'} and goes back to the saved settings.`,
      confirmText: 'Discard', danger: true,
    })) s.discard();
  };

  const showProblem = () => {
    const p = problems[0];
    if (!p) return;
    s.go(sectionForPath(p, s.extraKeys) ?? 'overview', p);
  };

  const label = (x: SectionDef) => {
    const n = s.errorSections.get(x.id);
    return `${x.title}${n ? ` (${n} to fix)` : s.dirtySections.has(x.id) ? ' (unsaved)' : ''}`;
  };

  return (
    <div className={`adm-app${s.changed.length || s.saving ? ' has-savebar' : ''}`}>
      <a className="adm-skip" href="#adm-main">Skip to settings</a>
      <header className="adm-top">
        <div className="adm-brand">
          <span className="adm-brand-dot" aria-hidden />
          <span className="adm-brand-name">Happi</span>
          <span className="adm-brand-sub">Admin</span>
        </div>
        <div className="adm-top-actions">
          <a className="adm-btn ghost small" href="/" target="_blank" rel="noreferrer">Open the experience</a>
          <button type="button" className="adm-btn ghost small" onClick={signOut}>
            <LogOut size={16} aria-hidden /> <span className="adm-hide-sm">Sign out</span>
          </button>
        </div>
      </header>

      {s.source === 'mock' && (
        <div className="adm-practice" role="note">
          <FlaskConical size={16} aria-hidden />
          <span><strong>Practice mode.</strong> Changes are only saved in this browser, not for visitors.{mockReason ? ` (${mockReason})` : ''}</span>
        </div>
      )}

      <div className="adm-picker">
        <label htmlFor="adm-picker" className="adm-sr">Section</label>
        <select id="adm-picker" className="adm-input adm-select" value={current} onChange={(e) => s.go(e.target.value as SectionId)}>
          {(['start', 'behaviour', 'content', 'tools'] as const).map((g) => {
            const items = visible.filter((x) => x.group === g);
            const opts = items.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>);
            return GROUP_TITLES[g] ? <optgroup key={g} label={GROUP_TITLES[g]}>{opts}</optgroup> : opts;
          })}
        </select>
      </div>

      <div className="adm-body">
        <nav className="adm-nav" aria-label="Settings sections">
          {(['start', 'behaviour', 'content', 'tools'] as const).map((g) => (
            <div key={g} className="adm-nav-group">
              {GROUP_TITLES[g] && <p className="adm-nav-title">{GROUP_TITLES[g]}</p>}
              <ul>
                {visible.filter((x) => x.group === g).map((x) => {
                  const Icon = x.icon;
                  const errs = s.errorSections.get(x.id);
                  const dirty = s.dirtySections.has(x.id);
                  return (
                    <li key={x.id}>
                      <a
                        href={`#${x.id}`}
                        className={`adm-nav-link${current === x.id ? ' is-on' : ''}`}
                        aria-current={current === x.id ? 'page' : undefined}
                        onClick={(e) => { e.preventDefault(); s.go(x.id); }}
                      >
                        <Icon size={18} aria-hidden />
                        <span className="adm-nav-text">{x.title}</span>
                        {errs ? <span className="adm-badge error" aria-label={`${errs} to fix`}>{errs}</span>
                          : dirty ? <span className="adm-dirty-dot" aria-label="unsaved changes" /> : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main id="adm-main" className="adm-main" tabIndex={-1}>
          <h1 className="adm-sr">Happi admin</h1>
          {VIEWS[current]()}
        </main>
      </div>

      <SaveBar
        changes={s.changed.length}
        problems={problems.length}
        saving={s.saving}
        onSave={() => void s.save()}
        onDiscard={discard}
        onShowProblem={showProblem}
      />
    </div>
  );
}
