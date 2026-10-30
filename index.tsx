
import React from 'react';
import ReactDOM from 'react-dom/client';
import './src/index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Vite fires `vite:preloadError` when a lazily-imported chunk fails to load —
// typically because a new deploy removed the old hashed chunk while this tab was
// still running the previous build ("Failed to fetch dynamically imported
// modules"). Reload once to pick up the new build, guarded to avoid a reload loop.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('vantage_chunk_reload_at') || 0);
    if (Date.now() - last < 15000) return;
    sessionStorage.setItem('vantage_chunk_reload_at', String(Date.now()));
  } catch {
    /* sessionStorage unavailable — fall through to a single reload */
  }
  window.location.reload();
});

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  let hasController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasController) {
      hasController = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED') {
      console.log('New version detected:', event.data.version);
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        const activateWaitingWorker = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        activateWaitingWorker();
        registration.update().catch((err) => console.warn('[PWA] SW update check failed:', err));

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch((err) => console.warn('[PWA] SW update check failed:', err));
          }
        });

        window.setInterval(() => {
          registration.update().catch((err) => console.warn('[PWA] SW update check failed:', err));
        }, 30 * 60 * 1000);
      })
      .catch((err) => console.warn('[PWA] SW registration failed:', err));
  });
};

registerServiceWorker();
