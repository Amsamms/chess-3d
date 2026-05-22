import { defineConfig } from 'vite';

export default defineConfig({
  // Deployed under amsamms.github.io/chess-3d/ — Vite needs to rewrite all asset
  // URLs (script, css, wasm) to this prefix. Override at build time with
  // `BASE=/your-prefix/` if you ever host somewhere else.
  base: process.env.BASE ?? '/chess-3d/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
