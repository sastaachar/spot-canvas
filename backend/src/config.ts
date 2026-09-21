import { z } from 'zod';

export interface Identity {
  id: string;
  name: string;
  displayName: string;
}

export interface Config {
  host: string;
  port: number;
  frontendOrigin: string;
  thoughtSpotHost: string | null;
  devUsers: Map<string, Identity>;
  dataDir: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_DEV_TOKEN_LENGTH = 8;
const MAX_PORT = 65535;

const DevUsersSchema = z.array(
  z.object({
    token: z.string().min(MIN_DEV_TOKEN_LENGTH),
    id: z.string().min(1),
    name: z.string().min(1),
    displayName: z.string().min(1).optional()
  })
);

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parseDevUsers(raw: string | undefined): Map<string, Identity> {
  const users = new Map<string, Identity>();
  if (!raw?.trim()) return users;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('DEV_USERS must be a JSON array');
  }
  const result = DevUsersSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`DEV_USERS is malformed: every entry needs token (${MIN_DEV_TOKEN_LENGTH}+ chars), id and name`);
  }
  for (const u of result.data) {
    users.set(u.token, { id: u.id, name: u.name, displayName: u.displayName ?? u.name });
  }
  return users;
}

function parseThoughtSpotHost(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('THOUGHTSPOT_HOST must be a full URL');
  }
  if (url.protocol !== 'https:') throw new ConfigError('THOUGHTSPOT_HOST must use https');
  return url.origin;
}

function parseInteger(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ConfigError(`${name} must be an integer between 0 and ${max}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const thoughtSpotHost = parseThoughtSpotHost(env['THOUGHTSPOT_HOST']);
  const devUsers = parseDevUsers(env['DEV_USERS']);
  if (thoughtSpotHost === null && devUsers.size === 0) {
    throw new ConfigError('Set THOUGHTSPOT_HOST or DEV_USERS: the API refuses to start without a way to authenticate users');
  }
  return {
    host: env['HOST'] || DEFAULT_HOST,
    port: parseInteger('PORT', env['PORT'], DEFAULT_PORT, MAX_PORT),
    frontendOrigin: env['FRONTEND_ORIGIN'] || DEFAULT_FRONTEND_ORIGIN,
    thoughtSpotHost,
    devUsers,
    dataDir: env['DATA_DIR'] || DEFAULT_DATA_DIR,
    sessionTtlMs: parseInteger('SESSION_TTL_MS', env['SESSION_TTL_MS'], DEFAULT_SESSION_TTL_MS, Number.MAX_SAFE_INTEGER),
    cookieSecure: env['COOKIE_SECURE'] !== 'false'
  };
}
