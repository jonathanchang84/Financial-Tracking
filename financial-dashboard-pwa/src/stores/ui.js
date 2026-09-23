import { writable, get } from 'svelte/store';

/** Lightweight toast channel (historic `showToast`). */
export const toast = writable({ message: '', tone: 'info', id: 0 });

let toastTimer = null;

export function showToast(message, tone = 'info', duration = 2600) {
  if (!message) return;
  toast.set({ message: String(message), tone, id: Date.now() });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set({ message: '', tone, id: 0 }), duration);
}

export const errorToast = (message) => showToast(message, 'error', 4200);

/* ------------------------------------------------------------------ */
/* Theme (persisted under the historic `fh-theme` key)                 */
/* ------------------------------------------------------------------ */

const THEME_KEY = 'fh-theme';

function initialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const theme = writable(initialTheme());

export function applyTheme(value) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#0b0f14' : '#0f766e');
}

export function setTheme(value) {
  const next = value === 'dark' ? 'dark' : 'light';
  theme.set(next);
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage disabled */
  }
  return next;
}

export function toggleTheme() {
  return setTheme(get(theme) === 'dark' ? 'light' : 'dark');
}

/** Online/offline indicator shared by the header. */
export const online = writable(typeof navigator === 'undefined' ? true : navigator.onLine);

export function watchConnectivity() {
  if (typeof window === 'undefined') return () => {};
  const up = () => online.set(true);
  const down = () => online.set(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  return () => {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
  };
}
