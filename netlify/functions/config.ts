// GET /api/config: the public runtime config (AppConfig has no secrets) plus which services are set up.
import type { Config } from '@netlify/functions';
import { getConfig } from '../lib/store';
import { services } from '../lib/env';
import { handle, json, requireMethod } from '../lib/http';
import type { PublicConfigResponse } from '../../src/shared/config';

export default handle(async (req) => {
  requireMethod(req, 'GET');
  const current = await getConfig();
  const body: PublicConfigResponse = { config: current.config, services: services(), updatedAt: current.updatedAt };
  return json(body, 200, {
    // Browsers always revalidate; the CDN may serve it for 10 s (admin saves purge the `config` tag).
    'Cache-Control': 'no-cache',
    'Netlify-CDN-Cache-Control': 'public, durable, max-age=10, stale-while-revalidate=30',
    'Netlify-Cache-Tag': 'config',
  });
});

export const config: Config = { path: '/api/config', method: 'GET' };
