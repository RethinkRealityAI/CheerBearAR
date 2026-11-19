import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Local dev: `npm run dev` serves the app; the Netlify functions are reached through the proxy below
// (see README "Local development" for how to run them).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
    // `npm run dev` (scripts/dev.ts) sets API_PROXY to the local functions runner. xfwd passes the browser's host on
    // (X-Forwarded-Host) so the functions' same-origin check accepts requests coming through this proxy.
    proxy: process.env.API_PROXY ? { '/api': { target: process.env.API_PROXY, changeOrigin: true, xfwd: true } } : undefined,
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
