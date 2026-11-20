// Admin authentication: one admin account from env vars, HS256 JWTs. Owner: server-voice.
//
//   ADMIN_USERNAME   admin user name
//   ADMIN_PASSWORD   the password, or a bcrypt hash of it (starts with $2a$ / $2b$ / $2y$)
//   JWT_SECRET       at least 32 random characters
//
// On a deployed site the admin API refuses to run when any of these is missing, when the user/password is the old
// admin/admin default, or when JWT_SECRET is short. Locally (scripts/dev-api.ts, netlify dev) missing values fall
// back to admin/admin with a per-process random secret, and the login response says so.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { HttpError, isLocalDev } from './http';

const ISSUER = 'cheerbear-admin';
const TOKEN_TTL_S = 12 * 60 * 60;
let devSecret: string | null = null;

export interface AdminSetup {
  ok: boolean;
  /** Why it is not usable (never includes values). */
  problems: string[];
  devDefaults: boolean;
  username: string;
  password: string;
  secret: string;
}

export function adminSetup(): AdminSetup {
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const secret = process.env.JWT_SECRET || '';
  const problems: string[] = [];
  if (!username) problems.push('ADMIN_USERNAME is not set');
  if (!password) problems.push('ADMIN_PASSWORD is not set');
  if (username === 'admin' && password === 'admin') problems.push('ADMIN_USERNAME/ADMIN_PASSWORD are the admin/admin default');
  else if (password && !password.startsWith('$2') && password.length < 10) problems.push('ADMIN_PASSWORD is shorter than 10 characters');
  if (!secret) problems.push('JWT_SECRET is not set');
  else if (secret.length < 32 || secret === 'change-me-in-production') problems.push('JWT_SECRET is shorter than 32 characters');

  if (problems.length === 0) return { ok: true, problems, devDefaults: false, username, password, secret };
  if (isLocalDev()) {
    devSecret ||= randomBytes(32).toString('hex');
    return {
      ok: true,
      problems,
      devDefaults: true,
      username: username || 'admin',
      password: password || 'admin',
      secret: secret.length >= 32 ? secret : devSecret,
    };
  }
  return { ok: false, problems, devDefaults: false, username: '', password: '', secret: '' };
}

function sha(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time comparison (hashes first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

export async function checkCredentials(setup: AdminSetup, username: string, password: string): Promise<boolean> {
  const userOk = safeEqual(username, setup.username);
  let passOk: boolean;
  if (/^\$2[aby]\$\d{2}\$/.test(setup.password)) passOk = await bcrypt.compare(password, setup.password);
  else passOk = safeEqual(password, setup.password);
  return userOk && passOk;
}

export function issueToken(setup: AdminSetup, username: string): { token: string; expiresAt: string } {
  const token = jwt.sign({ sub: username }, setup.secret, { algorithm: 'HS256', expiresIn: TOKEN_TTL_S, issuer: ISSUER });
  return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_S * 1000).toISOString() };
}

/** Returns the admin user name or throws 401/503. */
export function requireAdmin(req: Request): string {
  const setup = adminSetup();
  if (!setup.ok) throw new HttpError(503, 'admin_not_configured', 'Admin is not set up on this site (see README: ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET).');
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized', 'Please log in.');
  try {
    const payload = jwt.verify(header.slice(7), setup.secret, { algorithms: ['HS256'], issuer: ISSUER }) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || !safeEqual(payload.sub, setup.username)) throw new Error('wrong subject');
    return payload.sub;
  } catch {
    throw new HttpError(401, 'unauthorized', 'Your session has expired. Please log in again.');
  }
}
