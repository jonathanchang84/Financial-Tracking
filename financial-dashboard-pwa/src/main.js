import { get } from 'svelte/store';
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { theme, applyTheme } from './stores/ui.js';

// Apply the persisted theme before first paint to avoid a flash.
applyTheme(get(theme));

const app = mount(App, { target: document.getElementById('app') });

// Offline-first: the service worker is only registered for the compiled build.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => registration.update?.())
      .catch(() => {});
  });
}

export default app;
