import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * The service worker owns the build id (`const VERSION = 'findash-v13'`). Read it
 * here so the compiled bundle and the deployed worker can never drift apart —
 * `src/services/buildGuard.js` compares the two to spot a stale tab.
 */
const workerSource = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
const buildId = workerSource.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || 'dev';

/**
 * Hyper-optimized static build targetable by Cloudflare Workers.
 * `dist/` is the only build artifact; `public/` is copied verbatim so the
 * hand-written `sw.js`, manifest and icon ship at the site root.
 */
export default defineConfig({
  base: '/',
  plugins: [svelte()],
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId)
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    cssMinify: true,
    assetsInlineLimit: 4096,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700
  },
  esbuild: {
    legalComments: 'none'
  },
  server: { port: 5173 },
  preview: { port: 4173 }
});

