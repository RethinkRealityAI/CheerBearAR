// Local runner for the Netlify functions: mounts every netlify/functions/*.ts handler on one HTTP port, using each
// function's own `config.path` / `config.method` / `config.rateLimit`, so local behaviour matches the deployed site.
// No Netlify CLI, Docker, tunnels or Google Cloud needed.
//
//   npm run dev          -> this API on API_PORT (default PORT+1000, i.e. 6173) + Vite proxying /api to it
//   npm run dev:api      -> just this API (restarts when a function changes)
//
// Config is stored in .tmp/config-store/*.json (delete the folder to reset). Env vars come from .env if present.
import http from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env', '.env.local']) {
  const p = path.join(root, file);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch (err) {
      console.warn(`[dev-api] could not read ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}
process.env.CHEERBEAR_LOCAL_DEV = '1';
process.env.CHEERBEAR_STORE ||= 'file';
process.env.CHEERBEAR_STORE_DIR ||= path.join(root, '.tmp', 'config-store');

type Handler = (req: Request, context: Record<string, unknown>) => Promise<Response> | Response;
interface FnConfig {
  path?: string | string[];
  method?: string | string[];
  rateLimit?: { windowLimit: number; windowSize: number };
}
interface Route {
  name: string;
  patterns: RegExp[];
  methods: string[] | null;
  handler: Handler;
  rateLimit?: FnConfig['rateLimit'];
}

/** Netlify path syntax subset: literal segments, `:param` and a trailing `/*`. */
function toRegex(p: string): RegExp {
  const wildcard = p.endsWith('/*');
  const base = wildcard ? p.slice(0, -2) : p;
  const body = base
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `(?<${seg.slice(1)}>[^/]+)` : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}${wildcard ? '(?:/.*)?' : ''}/?$`);
}

export async function loadRoutes(): Promise<Route[]> {
  const dir = path.join(root, 'netlify', 'functions');
  const routes: Route[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.(ts|mts|js|mjs)$/.test(f)).sort()) {
    const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as { default?: Handler; config?: FnConfig };
    if (typeof mod.default !== 'function') continue;
    const name = file.replace(/\.\w+$/, '');
    const paths = mod.config?.path ? ([] as string[]).concat(mod.config.path) : [`/.netlify/functions/${name}`];
    routes.push({
      name,
      patterns: paths.map(toRegex),
      methods: mod.config?.method ? ([] as string[]).concat(mod.config.method) : null,
      handler: mod.default,
      rateLimit: mod.config?.rateLimit,
    });
  }
  return routes;
}

const windows = new Map<string, { count: number; resetAt: number }>();
function platformRateLimited(route: Route, ip: string): number {
  if (!route.rateLimit) return 0;
  const key = `${route.name}:${ip}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + route.rateLimit.windowSize * 1000 });
    return 0;
  }
  w.count += 1;
  return w.count > route.rateLimit.windowLimit ? Math.ceil((w.resetAt - now) / 1000) : 0;
}

export async function createDevApi(): Promise<http.Server> {
  const routes = await loadRoutes();
  const server = http.createServer(async (nodeReq, nodeRes) => {
    const started = Date.now();
    const host = nodeReq.headers.host || 'localhost';
    const url = new URL(nodeReq.url || '/', `http://${host}`);
    const ip = (String(nodeReq.headers['x-forwarded-for'] || '').split(',')[0].trim() || nodeReq.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
    let status = 500;
    try {
      const route = routes.find((r) => r.patterns.some((re) => re.test(url.pathname)));
      let res: Response;
      if (!route) {
        res = Response.json({ error: 'not_found', message: 'No function at this path.' }, { status: 404 });
      } else if (route.methods && !route.methods.includes(nodeReq.method || 'GET')) {
        res = Response.json({ error: 'method_not_allowed', message: 'Method not allowed.' }, { status: 405 });
      } else if (platformRateLimited(route, ip)) {
        res = new Response('Too Many Requests (local emulation of Netlify rate limiting)', { status: 429 });
      } else {
        const chunks: Buffer[] = [];
        for await (const c of nodeReq) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(nodeReq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        const hasBody = !['GET', 'HEAD'].includes(nodeReq.method || 'GET');
        const req = new Request(url, { method: nodeReq.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
        const match = route.patterns.map((re) => re.exec(url.pathname)).find(Boolean);
        const context = {
          ip,
          params: match?.groups ?? {},
          requestId: randomUUID(),
          geo: {},
          site: { url: `http://${host}`, name: 'local' },
          deploy: { context: 'dev', id: 'local', published: false },
          server: { region: 'local' },
          waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined),
          json: (d: unknown, init?: ResponseInit) => Response.json(d, init),
        };
        res = await route.handler(req, context);
      }
      status = res.status;
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => (out[k] = v));
      nodeRes.writeHead(res.status, out);
      nodeRes.end(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      console.error('[dev-api] handler crashed:', err);
      nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: 'internal', message: String(err) }));
    } finally {
      if (process.env.DEV_API_QUIET !== '1') console.log(`[dev-api] ${nodeReq.method} ${url.pathname} -> ${status} (${Date.now() - started} ms)`);
    }
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.API_PORT) || (Number(process.env.PORT) || 5173) + 1000;
  const server = await createDevApi();
  server.listen(port, '0.0.0.0', () => {
    const routes = readdirSync(path.join(root, 'netlify', 'functions')).filter((f) => f.endsWith('.ts'));
    console.log(`[dev-api] functions (${routes.length}) on http://localhost:${port}  store: ${process.env.CHEERBEAR_STORE} (${process.env.CHEERBEAR_STORE_DIR})`);
  });
}
