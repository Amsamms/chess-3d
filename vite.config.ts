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
    // Production sourcemaps are disabled (ships zero .map files to the CDN,
    // reducing bundle size and hiding implementation details from the public).
    // Dev mode still generates inline sourcemaps (Vite default: 'inline').
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
