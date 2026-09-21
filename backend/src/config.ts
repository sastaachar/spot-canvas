import { z } from 'zod';

export interface Identity {
  id: string;
  name: string;
  displayName: string;
  cluster?: string;
}

export interface GatewayConfig {
  url: string;
  key: string;
  model: string;
}

export interface Config {
  host: string;
  port: number;
  frontendOrigin: string;
  thoughtSpotHost: string | null;
  devUsers: Map<string, Identity>;
  devDefaultUserId: string | null;
  dataDir: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  gateway: GatewayConfig | null;
  allowLocalClusters: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_DEV_TOKEN_LENGTH = 8;
const MAX_PORT = 65535;
const DEFAULT_LLM_MODEL = 'kimi-k3';

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

function parseGateway(env: NodeJS.ProcessEnv): GatewayConfig | null {
  const key = env['API_GATEWAY_KEY']?.trim();
  const rawUrl = env['LLM_GATEWAY_URL']?.trim();
  if (!key && !rawUrl) return null;
  if (!key) throw new ConfigError('LLM_GATEWAY_URL is set but API_GATEWAY_KEY is missing');
  if (!rawUrl) throw new ConfigError('API_GATEWAY_KEY is set but LLM_GATEWAY_URL is missing');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError('LLM_GATEWAY_URL must be a full URL');
  }
  if (url.protocol !== 'https:') throw new ConfigError('LLM_GATEWAY_URL must use https');
  return { url: url.toString().replace(/\/+$/, ''), key, model: env['LLM_MODEL']?.trim() || DEFAULT_LLM_MODEL };
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
  const devDefaultUserId = env['DEV_DEFAULT_USER']?.trim() || null;
  if (devDefaultUserId !== null && ![...devUsers.values()].some((u) => u.id === devDefaultUserId)) {
    throw new ConfigError('DEV_DEFAULT_USER must be the id of one of the DEV_USERS entries');
  }
  return {
    host: env['HOST'] || DEFAULT_HOST,
    port: parseInteger('PORT', env['PORT'], DEFAULT_PORT, MAX_PORT),
    frontendOrigin: env['FRONTEND_ORIGIN'] || DEFAULT_FRONTEND_ORIGIN,
    thoughtSpotHost,
    devUsers,
    devDefaultUserId,
    dataDir: env['DATA_DIR'] || DEFAULT_DATA_DIR,
    sessionTtlMs: parseInteger('SESSION_TTL_MS', env['SESSION_TTL_MS'], DEFAULT_SESSION_TTL_MS, Number.MAX_SAFE_INTEGER),
    cookieSecure: env['COOKIE_SECURE'] !== 'false',
    gateway: parseGateway(env),
    allowLocalClusters: env['ALLOW_LOCAL_CLUSTERS'] === 'true'
  };
}
