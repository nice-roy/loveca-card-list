import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import MobileUiMock from './app/mobile-ui-mock';
import './app/globals.css';

const isMobileUiMock = window.location.pathname.startsWith('/mobile-ui-mock');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMobileUiMock ? <MobileUiMock /> : <Home />}
  </StrictMode>,
);
