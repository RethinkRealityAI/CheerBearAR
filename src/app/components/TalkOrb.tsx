// The call orb: bottom right, 72px, always within thumb reach. Never covers the experience's shutter / joystick
// (bottom centre) or Move (bottom left).
//   idle        tap -> (first time: one-line microphone explainer) -> call
//   connecting  spinner ring; tap opens the conversation
//   in call     gentle pulse while Cheer Bear speaks; tap opens the conversation; press and hold OR the red
//               button above it ends the call
//   error       tap tries again
import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, MessageCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw } from 'lucide-react';
import { useApp, useController } from '../context';

const HOLD_MS = 700;

export function TalkOrb() {
  const c = useController();
  const call = useApp((s) => s.call);
  const speaking = useApp((s) => s.speaking);
  const muted = useApp((s) => s.muted);
  const micAsk = useApp((s) => s.micAsk);
  const nudge = useApp((s) => !s.prefs.orbNudgeDone);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const overlay = useApp((s) => s.overlay);
  const text = useApp((s) => s.ui.text);
  const canCall = useApp((s) => s.ui.show.call);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const inCall = call === 'in-call';
  const busy = call === 'connecting' || call === 'ringing' || call === 'ending';

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  if (sheetOpen) return null;

  const state = !canCall ? 'chat' : inCall ? 'live' : busy ? 'busy' : call === 'error' ? 'error' : 'idle';
  const label = {
    chat: text.openChat,
    idle: text.call,
    busy: 'Calling Cheer Bear. Open the conversation',
    live: `On a call with Cheer Bear. Open the conversation. Press and hold to ${text.hangUp.toLowerCase()}`,
    error: 'Call did not connect. Tap to try again',
  }[state];

  const startHold = () => {
    if (!inCall) return;
    held.current = false;
    setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(false);
      navigator.vibrate?.(20);
      c.hangUp();
    }, HOLD_MS);
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const Icon = state === 'chat' ? MessageCircle : state === 'live' ? (muted ? MicOff : Mic) : state === 'error' ? RotateCcw : Phone;
  const bubble = state === 'busy' ? (call === 'ringing' ? 'Ringing…' : call === 'ending' ? 'Hanging up…' : 'Calling…')
    : state === 'idle' && nudge && !micAsk ? 'Tap to call Cheer Bear'
      : state === 'error' ? 'Tap to try again' : null;

  const showMore = (state === 'idle' || state === 'error') && !micAsk;

  return (
    <div className="cb-orb-dock">
      {micAsk && !overlay && <MicExplainer />}
      {bubble && !micAsk && (
        <div className={`cb-orb-bubble${state === 'error' ? ' is-error' : ''}${showMore ? ' is-beside' : ''}`} aria-hidden="true">{bubble}</div>
      )}
      {inCall ? (
        <button type="button" className="cb-hangup" onClick={() => c.hangUp()} aria-label={text.hangUp}>
          <PhoneOff aria-hidden="true" size={22} strokeWidth={2.4} />
        </button>
      ) : showMore && (
        // without a call, the talk button calls: this opens chat, actions, games and settings instead
        <button type="button" className="cb-more" onClick={() => c.openSheet()} aria-label="Open chat, games and settings">
          <LayoutGrid aria-hidden="true" size={22} strokeWidth={2.4} />
        </button>
      )}
      <button
        type="button"
        className={`cb-orb is-${state}${speaking && inCall ? ' is-speaking' : ''}${holding ? ' is-holding' : ''}`}
        aria-label={label}
        aria-haspopup={state === 'idle' ? undefined : 'dialog'}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => { if (inCall) e.preventDefault(); }}
        onClick={() => {
          if (held.current) { held.current = false; return; }
          navigator.vibrate?.(8);
          c.tapOrb();
        }}
      >
        <span className="cb-orb-ring" aria-hidden="true" />
        <span className="cb-orb-core" aria-hidden="true"><Icon size={30} strokeWidth={2.4} /></span>
        {inCall && <span className="cb-orb-hold" aria-hidden="true" />}
      </button>
      <span className="cb-sr-only" role="status" aria-live="polite">
        {call === 'connecting' ? 'Calling Cheer Bear' : call === 'in-call' ? 'Connected to Cheer Bear' : call === 'error' ? 'Call did not connect' : ''}
      </span>
    </div>
  );
}

/** One line on why we need the microphone, before the browser asks. Inline in the call card when the panel is open. */
export function MicExplainer({ inline = false }: { inline?: boolean }) {
  const c = useController();
  const callText = useApp((s) => s.ui.text.call);
  const primary = useRef<HTMLButtonElement>(null);
  // the explainer unmounts on either choice: hand focus to the talk button (or the call card in the panel)
  const refocus = () => requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('.cb-orb, .cb-callcard button')?.focus({ preventScroll: true }));
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); c.dismissMic(); refocus(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [c]);
  return (
    <div className={`cb-mic${inline ? ' is-inline' : ''}`} role="dialog" aria-labelledby="cb-mic-text">
      <p id="cb-mic-text"><Mic aria-hidden="true" size={18} /> Cheer Bear needs your microphone to hear you.</p>
      <div className="cb-mic-actions">
        <button type="button" className="cb-btn is-ghost" onClick={() => { c.dismissMic(); refocus(); }}>Not now</button>
        <button ref={primary} type="button" className="cb-btn is-primary" onClick={() => { c.confirmMic(); refocus(); }}>
          <Phone aria-hidden="true" size={18} /> {callText}
        </button>
      </div>
    </div>
  );
}
