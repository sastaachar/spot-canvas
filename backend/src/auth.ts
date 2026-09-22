import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config, Identity } from './config.ts';

export interface Authenticator {
  authenticate(token: string): Promise<Identity | null>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class UpstreamError extends Error {
  override name = 'UpstreamError';
}

const SESSION_USER_PATH = '/api/rest/2.0/auth/session/user';
const LOGIN_PATH = '/api/rest/2.0/auth/session/login';
const CLUSTER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REQUESTED_BY_HEADER = { 'X-Requested-By': 'ThoughtSpot' };

export interface ClusterCredentials {
  clusterUrl: string;
  username: string;
  password: string;
}

/** The ThoughtSpot browser-style session the backend holds on the user's behalf. */
export interface ClusterSession {
  host: string;
  cookie: string;
  expiresAt: number;
}

export interface ClusterLogin {
  identity: Identity;
  cluster: ClusterSession;
}

export class ClusterUrlError extends Error {
  override name = 'ClusterUrlError';
}

/** Turn the Set-Cookie headers of a login response into a Cookie request header. */
export function cookieHeaderFrom(res: Response): string {
  const raw: string[] =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
  return raw
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('='))
    .join('; ');
}

const isIpLiteral = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

export function normaliseClusterUrl(raw: string, allowLocal: boolean): string {
  const value = raw.trim();
  if (!value) throw new ClusterUrlError('Enter your ThoughtSpot cluster URL.');
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new ClusterUrlError('That cluster URL is not valid.');
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || isIpLiteral(url.hostname);
  if (local && !allowLocal) throw new ClusterUrlError('Use the cluster\u2019s public https address.');
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ClusterUrlError('The cluster URL must use https.');
  }
  return url.origin;
}

const SessionUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().optional()
});

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function tokensEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function devAuthenticator(users: Map<string, Identity>): Authenticator {
  return {
    async authenticate(token) {
      let match: Identity | null = null;
      for (const [known, identity] of users) {
        if (tokensEqual(known, token)) match = identity;
      }
      return match;
    }
  };
}

export function thoughtSpotAuthenticator(host: string, fetchImpl: FetchLike = fetch): Authenticator {
  const endpoint = new URL(SESSION_USER_PATH, host).toString();
  return {
    async authenticate(token) {
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
      } catch {
        throw new UpstreamError('ThoughtSpot is unreachable');
      }
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new UpstreamError(`ThoughtSpot answered ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new UpstreamError('ThoughtSpot returned a non-JSON session payload');
      }
      const parsed = SessionUserSchema.safeParse(body);
      if (!parsed.success) throw new UpstreamError('ThoughtSpot returned an unexpected session payload');
      return {
        id: parsed.data.id,
        name: parsed.data.name,
        displayName: parsed.data.display_name ?? parsed.data.name
      };
    }
  };
}

async function sessionUserByCookie(host: string, cookie: string, fetchImpl: FetchLike): Promise<Identity | null> {
  let res: Response;
  try {
    res = await fetchImpl(new URL(SESSION_USER_PATH, host).toString(), {
      headers: { Cookie: cookie, Accept: 'application/json', ...REQUESTED_BY_HEADER }
    });
  } catch {
    throw new UpstreamError('The cluster is unreachable');
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new UpstreamError(`The cluster answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamError('The cluster returned a non-JSON session payload');
  }
  const parsed = SessionUserSchema.safeParse(body);
  if (!parsed.success) throw new UpstreamError('The cluster returned an unexpected session payload');
  return { id: parsed.data.id, name: parsed.data.name, displayName: parsed.data.display_name ?? parsed.data.name };
}

export async function loginToCluster(
  credentials: ClusterCredentials,
  allowLocal: boolean,
  fetchImpl: FetchLike = fetch
): Promise<ClusterLogin | null> {
  const host = normaliseClusterUrl(credentials.clusterUrl, allowLocal);
  let res: Response;
  try {
    res = await fetchImpl(new URL(LOGIN_PATH, host).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...REQUESTED_BY_HEADER },
      body: JSON.stringify({ username: credentials.username, password: credentials.password, remember_me: true })
    });
  } catch {
    throw new UpstreamError('The cluster is unreachable');
  }
  if (res.status === 401 || res.status === 403 || res.status === 400) return null;
  if (!res.ok) throw new UpstreamError(`The cluster answered ${res.status}`);
  const cookie = cookieHeaderFrom(res);
  if (!cookie) throw new UpstreamError('The cluster login did not return a session cookie');
  const user = await sessionUserByCookie(host, cookie, fetchImpl);
  if (!user) return null;
  const clusterHost = new URL(host).host;
  return {
    identity: { ...user, id: `${clusterHost}/${user.id}`, cluster: clusterHost },
    cluster: { host, cookie, expiresAt: Date.now() + CLUSTER_SESSION_TTL_MS }
  };
}

export function chain(...authenticators: Authenticator[]): Authenticator {
  return {
    async authenticate(token) {
      for (const a of authenticators) {
        const identity = await a.authenticate(token);
        if (identity) return identity;
      }
      return null;
    }
  };
}

export function authenticatorFor(config: Config, fetchImpl?: FetchLike): Authenticator {
  const list: Authenticator[] = [];
  if (config.devUsers.size > 0) list.push(devAuthenticator(config.devUsers));
  if (config.thoughtSpotHost) list.push(thoughtSpotAuthenticator(config.thoughtSpotHost, fetchImpl));
  return chain(...list);
}
