import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerServiceWorker } from './lib/pwa';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// After render, never before: registration must not delay first paint for a
// promoter opening the app mid-shift.
registerServiceWorker();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
