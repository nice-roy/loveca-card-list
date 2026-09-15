import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import SyncUiPreview from './app/sync-ui-preview';
import './app/globals.css';

const previewRoute = window.location.pathname.replace(/\/$/, '') === '/sync-ui-preview';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {previewRoute ? <SyncUiPreview /> : <Home />}
  </StrictMode>,
);
