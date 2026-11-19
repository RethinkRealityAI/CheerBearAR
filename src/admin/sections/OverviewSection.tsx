import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { AdminApi } from '@/shared/contracts';
import { useAdmin } from '../AdminContext';
import { errorText } from '../api';
import { SECTIONS, type SectionId } from '../lib/sections';
import { Group, Section } from '../ui';

type Status = Awaited<ReturnType<AdminApi['status']>>;
type Tone = 'ok' | 'warn' | 'bad';

const ENV_HELP = 'In Netlify: Site configuration → Environment variables. The names are listed in .env.example. Then redeploy.';

function describe(st: Status): { key: string; title: string; tone: Tone; text: ReactNode }[] {
  const storage: Record<Status['storage'], { tone: Tone; text: string; title: string }> = {
    blobs: { tone: 'ok', title: 'Saved in Netlify Blobs', text: 'Settings are stored safely and survive deploys.' },
    file: { tone: 'warn', title: 'Saved in a local file', text: 'Fine on a developer computer. On the live site this should say Netlify Blobs.' },
    memory: { tone: 'bad', title: 'Not stored', text: 'Settings live in memory only and are lost when the server restarts. Check the Netlify Blobs setup before an event.' },
  };
  return [
    { key: 'twilio', title: st.twilio ? 'Phone calls ready' : 'Phone calls not set up', tone: st.twilio ? 'ok' : 'bad',
      text: st.twilio ? 'Twilio is configured, so visitors can call Happi.' : <>Visitors can't call Happi yet: the Twilio keys are missing. {ENV_HELP}</> },
    { key: 'openai', title: st.openai ? 'Listening ready' : 'Listening not set up', tone: st.openai ? 'ok' : 'bad',
      text: st.openai ? "OpenAI is configured, so Happi's words are transcribed and can trigger the scene."
        : <>Happi's words can't be turned into text, so nothing in the scene reacts. Add the OpenAI key. {ENV_HELP}</> },
    { key: 'storage', ...storage[st.storage] ?? { tone: 'warn', title: `Storage: ${st.storage}`, text: '' } },
    { key: 'admin', title: st.adminConfigured ? 'Admin sign-in set' : 'Admin password not set', tone: st.adminConfigured ? 'ok' : 'warn',
      text: st.adminConfigured ? 'Only people with the admin password can change settings.'
        : <>The panel is using a development sign-in. Set the admin username and password. {ENV_HELP}</> },
  ];
}

const ICONS = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

export function OverviewSection() {
  const { call, draft, dirtySections, errorSections, go, source } = useAdmin();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    call((a) => a.status()).then(setStatus).catch((e) => setError(errorText(e))).finally(() => setLoading(false));
  }, [call]);
  useEffect(load, [load]);

  const active = draft.gameModes.find((g) => g.id === draft.activeGameMode);
  const engine = { local: 'Keywords only', hybrid: 'Keywords, then AI', openai: 'AI only' }[draft.intentMatchingEngine];
  const modeName = { calm: 'Calm', chat: 'Chat', call_debug: 'Call debug' }[draft.modeDefault];
  const dirty = SECTIONS.filter((s) => dirtySections.has(s.id) || errorSections.has(s.id));
  const items = status ? describe(status) : [];
  const problems = items.filter((i) => i.tone !== 'ok').length;

  const link = (id: SectionId, text: ReactNode) => (
    <button type="button" className="adm-link-btn" onClick={() => go(id)}>{text}</button>
  );

  return (
    <Section title="Overview" description="Is everything ready for visitors? Start here."
      actions={<button type="button" className="adm-btn" onClick={load} disabled={loading}><RefreshCw size={16} aria-hidden /> Check again</button>}>
      {dirty.length > 0 && (
        <Group title="Unsaved changes" description="Press Save at the bottom to publish them to visitors.">
          <ul className="adm-dirty-list">
            {dirty.map((s) => (
              <li key={s.id}>
                {link(s.id, s.title)}
                {errorSections.get(s.id) ? <span className="adm-badge error">{errorSections.get(s.id)} to fix</span> : <span className="adm-dirty-dot" aria-hidden />}
              </li>
            ))}
          </ul>
        </Group>
      )}

      <Group title={status ? (problems ? `${problems} thing${problems === 1 ? '' : 's'} to check` : 'Everything is set up') : 'Services'}
        description={source === 'mock' ? 'Practice mode: these are pretend values.' : 'Read from the server. Keys themselves are never shown.'}>
        {loading && !status && <p className="adm-muted"><LoaderCircle size={14} className="adm-spin" aria-hidden /> Checking…</p>}
        {error && <p className="adm-error" role="alert">Could not check the services: {error}</p>}
        {status && (
          <ul className="adm-status" aria-busy={loading}>
            {items.map((i) => {
              const Icon = ICONS[i.tone];
              return (
                <li key={i.key} className={`adm-status-item ${i.tone}`}>
                  <Icon size={20} aria-hidden className="adm-status-icon" />
                  <div>
                    <p className="adm-status-title">{i.title}<span className="adm-sr"> ({i.tone === 'ok' ? 'OK' : i.tone === 'warn' ? 'warning' : 'problem'})</span></p>
                    <p className="adm-hint">{i.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group title="Right now" description="The saved settings visitors get (plus your unsaved edits, if any).">
        <dl className="adm-facts">
          <div><dt>Starting mode</dt><dd>{link('mode', modeName)}</dd></div>
          <div><dt>Game</dt><dd>{link('games', active ? active.name : 'None')}</dd></div>
          <div><dt>Keywords</dt><dd>{link('intent', `${draft.localClassifier.keywords.length} words · ${engine}`)}</dd></div>
          <div><dt>Cooldown</dt><dd>{link('triggers', `${(draft.triggerPolicy.triggerCooldownMs / 1000).toLocaleString()} s between reactions`)}</dd></div>
          <div><dt>Visitor's voice</dt><dd>{link('privacy', draft.allowUserAudioToOpenAI ? 'Transcribed' : 'Not sent anywhere')}</dd></div>
          <div><dt>Welcome screen</dt><dd>{link('ui', draft.ui.customization.welcomeModal.enabled ? 'On' : 'Off')}</dd></div>
        </dl>
      </Group>
    </Section>
  );
}
