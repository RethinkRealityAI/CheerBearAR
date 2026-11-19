// Simulator-only dev server: the project's vite config with HMR and file watching off (other people's edits must
// not reload the page in the middle of a run). From the repo root:
//   npx vite --config docs/evidence/xr-core/sim/vite.sim.config.mjs      -> http://localhost:5182
import base from '../../../../vite.config.ts';
export default { ...base, server: { ...base.server, port: 5182, hmr: false, watch: { ignored: ['**/*'] } } };
