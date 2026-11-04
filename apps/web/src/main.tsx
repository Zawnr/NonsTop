import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupAppUpdates } from './app-update.ts';
import { App } from './App.tsx';
import './styles.css';

setupAppUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
