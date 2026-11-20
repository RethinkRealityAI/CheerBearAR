// Mounts the "Mic check" view (voice-4) when asked: `?voicediag` in the URL, or Settings > Mic check. The view itself
// is a separate lazily loaded chunk (VoiceDiag.tsx), so normal visitors never download it. Kept out of the normal UI.
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const VoiceDiag = lazy(() => import('./VoiceDiag'));

let open = (() => {
  try { return new URLSearchParams(location.search).has('voicediag'); } catch { return false; }
})();
const subs = new Set<() => void>();
const set = (v: boolean) => { open = v; subs.forEach((cb) => cb()); };

export function openVoiceDiag(): void { set(true); }
export function closeVoiceDiag(): void { set(false); }

export function VoiceDiagHost() {
  const isOpen = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => open);
  if (!isOpen || typeof document === 'undefined') return null;
  return createPortal(
    <Suspense fallback={null}>
      <VoiceDiag onClose={closeVoiceDiag} />
    </Suspense>,
    document.body,
  );
}
