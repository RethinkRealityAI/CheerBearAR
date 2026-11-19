import { StrictMode, Suspense, lazy, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@/shared/theme.css';
import './app/base.css';
import App from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { NotFound, RouteLoading, NotReady } from './app/RoutePages';

// /admin and /lab/lipsync are lazy chunks so they never weigh on the experience. They are found with a glob, so a
// page that has not been built yet shows a friendly placeholder instead of breaking the build.
const pages = import.meta.glob<{ default: ComponentType }>(['./admin/AdminPage.tsx', './bear/lab/LipSyncLab.tsx']);

function lazyPage(path: string, name: string) {
  return lazy(async () => {
    const load = pages[path];
    if (!load) return { default: () => <NotReady name={name} /> };
    return load();
  });
}

const AdminPage = lazyPage('./admin/AdminPage.tsx', 'The admin panel');
const LipSyncLab = lazyPage('./bear/lab/LipSyncLab.tsx', 'The lip sync lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/admin/*" element={<Suspense fallback={<RouteLoading />}><AdminPage /></Suspense>} />
          <Route path="/lab/lipsync" element={<Suspense fallback={<RouteLoading />}><LipSyncLab /></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
