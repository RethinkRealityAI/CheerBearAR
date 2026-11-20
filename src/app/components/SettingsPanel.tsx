// Settings (behind the gear in the sheet's header): only what a child or a parent needs (chrome-5, round 5).
//   Talking: hold or tap the mic, whether Cheer Bear answers out loud, and a Mic check for grown-ups.
//   More: the welcome again, keyboard shortcuts (computers).
// The staff view, staff transcripts, "typing plays actions", "my words start actions", the magic-word list and the
// staff info summary are gone from the app: they are admin settings, edited in /admin.
import type { ReactNode } from 'react';
import { Keyboard, Mic, PartyPopper } from 'lucide-react';
import { useApp, useController } from '../context';
import { openVoiceDiag } from './VoiceDiagHost';

export function SettingsPanel() {
  const c = useController();
  const s = useApp((st) => ({
    ui: st.ui,
    isDesktop: st.isDesktop,
    voiceMode: st.ui.voiceMode.enabled,
    tapToTalk: st.prefs.tapToTalk ?? !st.ui.voiceMode.holdToTalk,
    spokenReplies: st.prefs.spokenReplies ?? st.ui.voiceMode.spokenReplies,
  }));

  return (
    <div className="cb-settings">
      {s.voiceMode && (
        <Group title="Talking to Cheer Bear">
          <Switch
            label="Tap to talk"
            desc="Tap the mic once to start and once to stop, instead of holding it."
            checked={s.tapToTalk}
            onChange={(v) => c.voiceUi.setTapToTalk(v)}
          />
          <Switch
            label="Cheer Bear answers out loud"
            desc="She says a few happy words back when you ask for something."
            checked={s.spokenReplies}
            onChange={(v) => c.voiceUi.setSpokenReplies(v)}
          />
          <p className="cb-settings-note">Cheer Bear only listens while you hold the mic (or until you tap it again). Your browser turns your words into text (Chrome uses Google’s speech service, Safari uses Apple’s).</p>
          {/* voice-4: for grown-ups when the mic doesn't hear: what this phone's browser actually does */}
          <button type="button" className="cb-settings-link" onClick={() => openVoiceDiag()}>
            <Mic aria-hidden="true" size={16} /> Mic not hearing you? Mic check
          </button>
        </Group>
      )}

      <Group title="More">
        {s.ui.welcome.enabled && (
          <button type="button" className="cb-btn is-soft is-wide" onClick={() => c.showWelcomeAgain()}>
            <PartyPopper aria-hidden="true" size={20} /> Show the welcome again
          </button>
        )}
        {s.isDesktop && s.ui.show.keyboardHelp && (
          <button type="button" className="cb-btn is-soft is-wide" onClick={() => c.openOverlay('keys')}>
            <Keyboard aria-hidden="true" size={20} /> Keyboard shortcuts
          </button>
        )}
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cb-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Switch({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="cb-switch" onClick={() => onChange(!checked)}>
      <span className="cb-switch-text">
        <span className="cb-switch-label">{label}</span>
        {desc && <span className="cb-switch-desc">{desc}</span>}
      </span>
      <span className="cb-switch-track" aria-hidden="true"><span /></span>
    </button>
  );
}
