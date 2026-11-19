// The experience page (route /). The experience fills the screen; the app's UI is a layer above it with
// pointer-events: none except its own controls. See docs/handoff/app-ui.md for the component map.
import { useEffect, useRef, useState } from 'react';
import './app.css';
import { AppContext, useApp } from './context';
import { AppController } from './controller';
import { createAppStore } from './state/appState';
import { ErrorBoundary } from './ErrorBoundary';
import { TalkOrb } from './components/TalkOrb';
import { GameChip } from './components/GameChip';
import { Toast } from './components/Toast';
import { ConversationSheet } from './components/ConversationSheet';
import { Overlays } from './components/Overlays';
import { useShortcuts } from './hooks/useShortcuts';
import { useViewportVars } from './hooks/useViewportVars';
import type { ThemeToken } from './state/uiConfig';

// Admin colours are snapped to theme tokens; each token has a fill that keeps white (or ink) text readable.
const FILL: Record<ThemeToken, { fill: string; on: string }> = {
  pink: { fill: 'var(--cb-pink-deep)', on: 'var(--cb-white)' },
  purple: { fill: 'var(--cb-purple)', on: 'var(--cb-white)' },
  blue: { fill: 'var(--cb-blue)', on: 'var(--cb-ink)' },
  yellow: { fill: 'var(--cb-yellow)', on: 'var(--cb-ink)' },
  orange: { fill: 'var(--cb-orange)', on: 'var(--cb-ink)' },
  green: { fill: 'var(--cb-green)', on: 'var(--cb-ink)' },
  red: { fill: 'var(--cb-red)', on: 'var(--cb-ink)' },
};

export default function App() {
  const [controller] = useState(() => new AppController(createAppStore()));
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useViewportVars(rootRef);
  useShortcuts(controller);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    document.documentElement.classList.add('cb-app-page');
    if (import.meta.env.DEV) (window as unknown as { __cbApp?: AppController }).__cbApp = controller; // for tests
    void controller.boot(el); // safe to call again after dispose (StrictMode mounts twice in dev)
    return () => {
      document.documentElement.classList.remove('cb-app-page');
      controller.dispose();
    };
  }, [controller]);

  return (
    <AppContext.Provider value={controller}>
      <Shell rootRef={rootRef} stageRef={stageRef} />
    </AppContext.Provider>
  );
}

function Shell({ rootRef, stageRef }: { rootRef: React.RefObject<HTMLDivElement>; stageRef: React.RefObject<HTMLDivElement> }) {
  const started = useApp((s) => s.started);
  const isDesktop = useApp((s) => s.isDesktop);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const colors = useApp((s) => s.ui.colors);
  const sources = useApp((s) => s.sources);
  const style = {
    '--app-primary': FILL[colors.primary].fill,
    '--app-on-primary': FILL[colors.primary].on,
    '--app-secondary': FILL[colors.secondary].fill,
    '--app-accent': FILL[colors.accent].fill,
    '--app-on-accent': FILL[colors.accent].on,
  } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className="cb-app"
      style={style}
      data-desktop={isDesktop}
      data-side-open={isDesktop && sheetOpen && started}
    >
      <div ref={stageRef} className="cb-stage" data-testid="stage" />
      <ErrorBoundary variant="layer">
        <div className="cb-layer" data-started={started}>
          <div className="cb-layer-stage">
            {started && (
              <>
                <div className="cb-top-slot"><GameChip /><Toast /></div>
                <TalkOrb />
              </>
            )}
            {import.meta.env.DEV && sources.voice === 'mock' && started && (
              <span className="cb-devtag" aria-hidden="true">mock voice{sources.experience === 'mock' ? ' + stage' : ''}</span>
            )}
          </div>
          {started && <ConversationSheet />}
        </div>
        <Overlays />
      </ErrorBoundary>
    </div>
  );
}
