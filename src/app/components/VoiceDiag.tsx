// "Mic check" (voice-4): what this phone's browser does when Happi listens, so a tester can tell us exactly
// where it goes wrong. Open with `?voicediag` or Settings > Mic check. Not part of the normal UI; lazily loaded.
//
//   - Facts: browser, recognition present, mic permission (live), microphones, secure page, online, in-app browser.
//   - "Hold and talk": the real hold-to-talk listener (same code as the talk button), every recognition event shown
//     as it arrives (start, audiostart, soundstart, speechstart, results, error code, end) with timestamps.
//   - Variants to try on a device: continuous off, interim off, and the old level meter on (a second getUserMedia
//     next to the recogniser, the suspected cause of "it can't hear me").
//   - "Mic only": getUserMedia alone with a level bar (does the microphone itself work?).
//   - Copy / Share the log. Nothing is sent anywhere by this view.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Copy, Mic, Share2, Trash2, X } from 'lucide-react';
import { HoldListener, MicMeter, micPermission, watchMicPermission, type HoldResult, type MicPermission } from '@/voice/holdToTalk';
import { browserRecognition } from '@/voice/speechInput';
import { problemHelp, voicePlatform } from '@/voice/voiceHelp';
import { clearVoiceLog, formatVoiceLog, onVoiceLog, voiceLog, voiceLogEntries, voiceLogVersion } from '@/voice/voiceLog';
import { useApp } from '../context';
import './voiceDiag.css';

const STEPS = ['start', 'audiostart', 'soundstart', 'speechstart', 'result', 'end'] as const;

function recognitionName(): string {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.SpeechRecognition === 'function') return 'SpeechRecognition';
  if (typeof w.webkitSpeechRecognition === 'function') return 'webkitSpeechRecognition';
  return 'none';
}

function isPhone(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function VoiceDiag({ onClose }: { onClose(): void }) {
  const platform = useMemo(() => voicePlatform(), []);
  const mode = useApp((s) => s.expMode);
  const call = useApp((s) => s.call);
  const version = useSyncExternalStore(onVoiceLog, voiceLogVersion);
  const [perm, setPerm] = useState<MicPermission>('unknown');
  const [mics, setMics] = useState('…');
  const [continuous, setContinuous] = useState(true);
  const [interim, setInterim] = useState(true);
  const [meterOn, setMeterOn] = useState(false);
  const [holding, setHolding] = useState(false);
  const [words, setWords] = useState('');
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [verdict, setVerdict] = useState('');
  const [level, setLevel] = useState(0);
  const [micOnly, setMicOnly] = useState<'' | 'on' | 'done'>('');
  const [copied, setCopied] = useState('');
  const listener = useRef<HoldListener | null>(null);
  const logBox = useRef<HTMLPreElement>(null);
  const recName = useMemo(recognitionName, []);

  useEffect(() => watchMicPermission(setPerm), []);
  const countMics = () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setMics('no mediaDevices'); return; }
    void navigator.mediaDevices.enumerateDevices().then((list) => {
      const ins = list.filter((d) => d.kind === 'audioinput');
      setMics(`${ins.length}${ins.some((d) => d.label) ? `: ${ins.map((d) => d.label).filter(Boolean).slice(0, 3).join(', ')}` : ''}`);
    }, () => setMics('unknown'));
  };
  useEffect(countMics, [perm]);
  useEffect(() => {
    voiceLog(0, 'mic check opened', `${platform.name}; recognition ${recName}; secure ${window.isSecureContext}; online ${navigator.onLine}; mode ${mode}; call ${call}`);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); listener.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const el = logBox.current; if (el) el.scrollTop = el.scrollHeight; }, [version]);

  // the step lights follow the log of the current test hold
  useEffect(() => {
    if (!holding && !listener.current?.active) return;
    const list = voiceLogEntries();
    let i = list.length - 1;
    while (i > 0 && list[i].ev !== 'press') i -= 1;
    setSeen(new Set(list.slice(i).map((e) => e.ev)));
  }, [version, holding]);

  const facts: Array<[string, string]> = [
    ['Browser', platform.name],
    ['Counts as a phone', isPhone() ? 'yes' : 'no'],
    ['Speech recognition', recName],
    ['Mic permission', perm],
    ['Microphones', mics],
    ['Secure page', window.isSecureContext ? 'yes' : 'no (recognition needs https)'],
    ['Online', navigator.onLine ? 'yes' : 'no (Chrome / Safari recognition needs the internet)'],
    ['In-app browser', platform.inApp ? 'yes (may block the mic: try Chrome / Safari)' : 'no'],
    ['Language', `${navigator.language} (we listen for en-US)`],
    ['Voice / mode', `call ${call}, view ${mode}`],
  ];

  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    listener.current?.dispose();
    setWords('');
    setVerdict('');
    setSeen(new Set());
    const l = new HoldListener({
      onText: (t) => setWords(t),
      onState: () => undefined,
      onLevel: (v) => setLevel(v),
      onDone: (r: HoldResult) => {
        setHolding(false);
        setLevel(0);
        if (r.text) setVerdict(`Heard: “${r.text}”${r.restarts ? ` (restarted ${r.restarts}×)` : ''}`);
        else setVerdict(`Nothing heard: ${r.problem ?? 'unknown'}${r.error ? ` (error ${r.error})` : ''}. ${r.problem ? problemHelp(r.problem, platform).text : ''}`);
      },
    }, browserRecognition(), { tag: 'diag', continuous, interim, meter: meterOn ? new MicMeter() : null, permission: micPermission });
    listener.current = l;
    // synchronously inside the press, exactly like the talk button
    if (l.press()) setHolding(true);
    else setVerdict(`Could not start: ${l.lastProblem ?? 'unknown'}`);
  };
  const release = () => { listener.current?.release(); };

  const testMicOnly = async () => {
    setMicOnly('on');
    const m = new MicMeter();
    voiceLog(0, 'mic only: getUserMedia');
    const ok = await m.start((v) => setLevel(v));
    voiceLog(0, ok ? 'mic only: open' : 'mic only: failed', m.info);
    if (ok) {
      await new Promise((r) => setTimeout(r, 3000));
      m.stop();
      voiceLog(0, 'mic only: closed');
    }
    setLevel(0);
    setMicOnly('done');
    countMics();
  };

  const reportText = () => [
    'Happi mic check',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    `Options: continuous ${continuous}, interim ${interim}, meter ${meterOn}`,
    `UA: ${navigator.userAgent}`,
    '',
    formatVoiceLog(),
  ].join('\n');

  const copy = async () => {
    const text = reportText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    setCopied(ok ? 'Copied! Paste it in a message to us.' : 'Copy did not work: press and hold the log to select it.');
    setTimeout(() => setCopied(''), 4000);
  };
  const share = async () => {
    try { await navigator.share({ title: 'Happi mic check', text: reportText() }); } catch { /* cancelled */ }
  };

  const toggle = (label: string, on: boolean, set: (v: boolean) => void, hint: string) => (
    <button type="button" role="switch" aria-checked={on} className="cb-diag-opt" onClick={() => set(!on)} disabled={holding}>
      <span className="cb-diag-opt-dot" aria-hidden="true" />
      <span><b>{label}</b><small>{hint}</small></span>
    </button>
  );

  return (
    <div className="cb-diag" role="dialog" aria-modal="true" aria-labelledby="cb-diag-title">
      <header className="cb-diag-head">
        <h2 id="cb-diag-title">Mic check</h2>
        <button type="button" className="cb-diag-close" onClick={onClose} aria-label="Close mic check"><X size={22} aria-hidden="true" /></button>
      </header>
      <div className="cb-diag-body">
        <p className="cb-diag-lead">Hold the button, say “rainbow”, let go. Then copy the log and send it to us.</p>

        <section className="cb-diag-test">
          <button
            type="button"
            className={`cb-diag-hold${holding ? ' is-live' : ''}`}
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
            disabled={recName === 'none'}
            style={{ ['--lvl' as string]: String(level) }}
          >
            <span className="cb-diag-hold-ring" aria-hidden="true" />
            <Mic size={30} strokeWidth={2.4} aria-hidden="true" />
            <span>{recName === 'none' ? 'No speech recognition' : holding ? 'Listening… let go when done' : 'Hold and talk'}</span>
          </button>
          <ol className="cb-diag-steps" aria-label="What the browser did">
            {STEPS.map((s) => <li key={s} className={seen.has(s) ? 'is-on' : ''}>{s}</li>)}
            {seen.has('error') && <li className="is-bad">error</li>}
            {seen.has('restart') && <li className="is-warn">restart</li>}
          </ol>
          <p className="cb-diag-words" aria-live="polite">{words || verdict || '…'}</p>
          {words && verdict && <p className="cb-diag-verdict">{verdict}</p>}
          <div className="cb-diag-opts">
            {toggle('Continuous', continuous, setContinuous, 'keep listening through pauses')}
            {toggle('Live words', interim, setInterim, 'interim results')}
            {toggle('Level meter', meterOn, setMeterOn, 'opens a 2nd mic stream (old build)')}
          </div>
          <div className="cb-diag-row">
            <button type="button" className="cb-diag-btn" onClick={() => void testMicOnly()} disabled={holding || micOnly === 'on'}>
              {micOnly === 'on' ? 'Talk now (3 s)…' : 'Mic only test'}
            </button>
            <span className="cb-diag-meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.02, level)})` }} /></span>
          </div>
        </section>

        <section>
          <h3>This phone</h3>
          <dl className="cb-diag-facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <p className="cb-diag-ua">{navigator.userAgent}</p>
        </section>

        <section>
          <div className="cb-diag-loghead">
            <h3>Log</h3>
            <button type="button" className="cb-diag-btn is-ghost" onClick={clearVoiceLog} aria-label="Clear the log"><Trash2 size={16} aria-hidden="true" /> Clear</button>
          </div>
          <pre ref={logBox} className="cb-diag-log" data-testid="voice-diag-log">{formatVoiceLog() || 'Nothing yet. Hold the button above, or the talk button.'}</pre>
          <div className="cb-diag-row">
            <button type="button" className="cb-diag-btn is-primary" onClick={() => void copy()}><Copy size={18} aria-hidden="true" /> Copy log</button>
            {typeof navigator.share === 'function' && (
              <button type="button" className="cb-diag-btn" onClick={() => void share()}><Share2 size={18} aria-hidden="true" /> Share</button>
            )}
          </div>
          {copied && <p className="cb-diag-copied" role="status">{copied}</p>}
        </section>
      </div>
    </div>
  );
}
