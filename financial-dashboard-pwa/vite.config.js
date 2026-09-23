import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Hyper-optimized static build targetable by Cloudflare Pages (free tier).
 * `dist/` is the only build artifact; `public/` is copied verbatim so the
 * hand-written `sw.js`, manifest and icon ship at the site root.
 */
export default defineConfig({
  base: '/',
  plugins: [svelte()],
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

