// Dev entry for admin-dev.html: renders the admin panel on its own, without the app's router.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminPage from '../AdminPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminPage />
  </StrictMode>,
);
