import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Static, hyper-optimized build for Cloudflare Pages free tier.
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 4096,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  server: { port: 5173 }
});
