// `npm run dev`: the local functions runner (scripts/dev-api.ts, restarted on change) + Vite, with Vite proxying /api
// to the runner. One command, no Netlify CLI or cloud services. Ctrl+C stops both.
//
//   PORT=5180 npm run dev   -> Vite on 5180, API on 6180 (API_PORT overrides)
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webPort = Number(process.env.PORT) || 5173;
const apiPort = Number(process.env.API_PORT) || webPort + 1000;
const bin = (name: string) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const extraViteArgs = process.argv.slice(2);

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[], env: Record<string, string>) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code ?? 'signal'}); stopping.`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', bin('tsx'), ['watch', '--clear-screen=false', '--include', 'netlify/**', '--include', 'src/shared/**', 'scripts/dev-api.ts'], {
  API_PORT: String(apiPort),
});
run('web', bin('vite'), ['--port', String(webPort), ...extraViteArgs], {
  API_PROXY: `http://127.0.0.1:${apiPort}`,
  PORT: String(webPort),
});
console.log(`[dev] app http://localhost:${webPort}  (functions on :${apiPort}, proxied at /api)`);
