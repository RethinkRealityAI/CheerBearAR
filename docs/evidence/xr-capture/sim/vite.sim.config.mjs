// xr-capture simulator dev server: the project's vite config with HMR, file watching and the shared dep cache off
// (other workers edit this checkout at the same time). From the repo root:
//   npx vite --config docs/evidence/xr-capture/sim/vite.sim.config.mjs      -> http://localhost:5186
import base from '../../../../vite.config.ts';
export default {
  ...base,
  cacheDir: 'node_modules/.vite-xr-capture',
  server: { ...base.server, port: 5186, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
};
