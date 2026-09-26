import { get } from 'svelte/store';
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { theme, applyTheme } from './stores/ui.js';
import { ensureFreshBuild } from './services/buildGuard.js';

// Apply the persisted theme before first paint to avoid a flash.
applyTheme(get(theme));

const app = mount(App, { target: document.getElementById('app') });

// Offline-first: the service worker is only registered for the compiled build.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update?.())
      .catch(() => {});
  });
  // A tab opened before a deploy keeps running its old JavaScript. Reload once if
  // the bundle in memory is older than the service worker the server is serving.
  ensureFreshBuild().catch(() => {});
}

export default app;
