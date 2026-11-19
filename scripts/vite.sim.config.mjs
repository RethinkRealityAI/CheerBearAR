// Simulator dev server: the project's Vite config with live reload and file watching off, so edits made while a
// Playwright run is in flight do not reload the page. Start the functions runner first, then Vite:
//   API_PORT=6190 npx tsx scripts/dev-api.ts &
//   API_PROXY=http://127.0.0.1:6190 SIM_PORT=5190 npx vite --config scripts/vite.sim.config.mjs
// SIM_CACHE gives this server its own dependency cache (two Vite servers sharing node_modules/.vite can end up
// with two copies of React).
import base from '../vite.config.ts';
export default {
  ...base,
  cacheDir: process.env.SIM_CACHE || 'node_modules/.vite-sim',
  server: { ...base.server, port: Number(process.env.SIM_PORT) || 5190, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
};
