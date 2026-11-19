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
    proxy: process.env.API_PROXY ? { '/api': { target: process.env.API_PROXY, changeOrigin: true } } : undefined,
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
