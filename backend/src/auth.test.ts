import { describe, expect, it, vi } from 'vitest';
import {
  authenticatorFor,
  chain,
  ClusterUrlError,
  cookieHeaderFrom,
  devAuthenticator,
  loginToCluster,
  normaliseClusterUrl,
  thoughtSpotAuthenticator,
  tokensEqual,
  UpstreamError
} from './auth.ts';
import type { Config, Identity } from './config.ts';

const alice: Identity = { id: 'u1', name: 'alice', displayName: 'Alice' };
const users = new Map([['alice-token-12345', alice]]);

const response = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

describe('tokensEqual', () => {
  it('compares tokens of different lengths without throwing', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abc', 'abcd')).toBe(false);
    expect(tokensEqual('', 'x')).toBe(false);
  });
});

describe('devAuthenticator', () => {
  it('resolves a known token and rejects everything else', async () => {
    const auth = devAuthenticator(users);
    expect(await auth.authenticate('alice-token-12345')).toEqual(alice);
    expect(await auth.authenticate('alice-token-1234')).toBeNull();
    expect(await auth.authenticate('')).toBeNull();
  });
});

describe('thoughtSpotAuthenticator', () => {
  it('calls the session-user endpoint with the bearer token', async () => {
    const fetchImpl = vi.fn(async () => response(200, { id: 'ts-1', name: 'jdoe', display_name: 'J. Doe' }));
    const auth = thoughtSpotAuthenticator('https://ts.example.com', fetchImpl);
    expect(await auth.authenticate('tok')).toEqual({ id: 'ts-1', name: 'jdoe', displayName: 'J. Doe' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ts.example.com/api/rest/2.0/auth/session/user');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('falls back to name when display_name is absent', async () => {
    const auth = thoughtSpotAuthenticator('https://ts.example.com', async () => response(200, { id: 'a', name: 'b' }));
    expect(await auth.authenticate('t')).toEqual({ id: 'a', name: 'b', displayName: 'b' });
  });

  it('treats 401 and 403 as a bad token', async () => {
    expect(await thoughtSpotAuthenticator('https://x.example', async () => response(401, {})).authenticate('t')).toBeNull();
    expect(await thoughtSpotAuthenticator('https://x.example', async () => response(403, {})).authenticate('t')).toBeNull();
  });

  it('raises UpstreamError for outages, server errors and bad payloads', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new Error('ECONNREFUSED');
      },
      async () => response(503, {}),
      async () => response(200, 'not json'),
      async () => response(200, { nope: true })
    ];
    for (const fetchImpl of cases) {
      await expect(thoughtSpotAuthenticator('https://x.example', fetchImpl).authenticate('t')).rejects.toBeInstanceOf(UpstreamError);
    }
  });
});

describe('chain and authenticatorFor', () => {
  const base: Config = {
    host: '127.0.0.1',
    port: 0,
    frontendOrigin: 'http://localhost:5173',
    thoughtSpotHost: null,
    devUsers: new Map(),
    devDefaultUserId: null,
    dataDir: 'data',
    sessionTtlMs: 1000,
    cookieSecure: true,
    gateway: null,
    allowLocalClusters: false
  };

  it('returns the first match and null when nobody matches', async () => {
    const none = { authenticate: async () => null };
    const auth = chain(none, devAuthenticator(users));
    expect(await auth.authenticate('alice-token-12345')).toEqual(alice);
    expect(await chain(none).authenticate('x')).toBeNull();
  });

  it('uses dev tokens first, then ThoughtSpot', async () => {
    const fetchImpl = vi.fn(async () => response(200, { id: 'ts-1', name: 'remote' }));
    const auth = authenticatorFor({ ...base, devUsers: users, thoughtSpotHost: 'https://ts.example.com' }, fetchImpl);
    expect(await auth.authenticate('alice-token-12345')).toEqual(alice);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await auth.authenticate('remote-token'))?.name).toBe('remote');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('normaliseClusterUrl', () => {
  it('accepts https hosts with or without a scheme and strips paths', () => {
    expect(normaliseClusterUrl('my.thoughtspot.cloud', false)).toBe('https://my.thoughtspot.cloud');
    expect(normaliseClusterUrl(' https://my.thoughtspot.cloud/#/home ', false)).toBe('https://my.thoughtspot.cloud');
    expect(normaliseClusterUrl('https://ts.example:8443', false)).toBe('https://ts.example:8443');
  });

  it('rejects blanks, garbage, http and local addresses unless allowed', () => {
    expect(() => normaliseClusterUrl('  ', false)).toThrow(ClusterUrlError);
    expect(() => normaliseClusterUrl('http://[::1', false)).toThrow(/not valid/);
    expect(() => normaliseClusterUrl('http://ts.example', false)).toThrow(/https/);
    expect(() => normaliseClusterUrl('localhost:8443', false)).toThrow(/public https/);
    expect(() => normaliseClusterUrl('10.0.0.4', false)).toThrow(/public https/);
    expect(normaliseClusterUrl('http://localhost:8443', true)).toBe('http://localhost:8443');
  });
});

describe('loginToCluster', () => {
  const creds = { clusterUrl: 'ts.example.com', username: 'jdoe', password: 'pw' };

  const loginOk = () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'JSESSIONID=abc123; Path=/; HttpOnly; Secure');
    headers.append('Set-Cookie', 'clientId=xyz; Path=/');
    return new Response('{}', { status: 200, headers });
  };

  it('logs in with session/login, keeps the cluster cookies, resolves the user, and scopes the id to the cluster', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/auth/session/login') ? loginOk() : response(200, { id: 'guid-1', name: 'jdoe', display_name: 'J. Doe' })
    );
    const login = await loginToCluster(creds, false, fetchImpl);
    expect(login?.identity).toEqual({ id: 'ts.example.com/guid-1', name: 'jdoe', displayName: 'J. Doe', cluster: 'ts.example.com' });
    expect(login?.cluster).toMatchObject({ host: 'https://ts.example.com', cookie: 'JSESSIONID=abc123; clientId=xyz' });
    const [loginUrl, loginInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(loginUrl).toBe('https://ts.example.com/api/rest/2.0/auth/session/login');
    expect(loginInit.method).toBe('POST');
    expect(JSON.parse(String(loginInit.body))).toEqual({ username: 'jdoe', password: 'pw', remember_me: true });
    expect((loginInit.headers as Record<string, string>)['X-Requested-By']).toBe('ThoughtSpot');
    const [userUrl, userInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(userUrl).toBe('https://ts.example.com/api/rest/2.0/auth/session/user');
    expect((userInit.headers as Record<string, string>)['Cookie']).toBe('JSESSIONID=abc123; clientId=xyz');
    expect((userInit.headers as Record<string, string>)['X-Requested-By']).toBe('ThoughtSpot');
  });

  it('returns null for rejected credentials and raises UpstreamError for cluster trouble', async () => {
    expect(await loginToCluster(creds, false, async () => response(401, {}))).toBeNull();
    expect(await loginToCluster(creds, false, async () => response(400, {}))).toBeNull();
    const userRejected = vi.fn(async (url: string) => (url.endsWith('/auth/session/login') ? loginOk() : response(401, {})));
    expect(await loginToCluster(creds, false, userRejected)).toBeNull();
    const noCookie = async () => response(200, {});
    await expect(loginToCluster(creds, false, noCookie)).rejects.toThrow(/session cookie/);
    for (const bad of [
      async () => {
        throw new Error('ECONNREFUSED');
      },
      async () => response(500, {}),
      vi.fn(async (url: string) => (url.endsWith('/auth/session/login') ? loginOk() : response(200, 'not json'))),
      vi.fn(async (url: string) => (url.endsWith('/auth/session/login') ? loginOk() : response(200, { nope: 1 }))),
      vi.fn(async (url: string) => (url.endsWith('/auth/session/login') ? loginOk() : response(503, {})))
    ]) {
      await expect(loginToCluster(creds, false, bad)).rejects.toBeInstanceOf(UpstreamError);
    }
    await expect(loginToCluster({ ...creds, clusterUrl: 'http://x' }, false)).rejects.toBeInstanceOf(ClusterUrlError);
  });

  it('parses Set-Cookie headers into a Cookie header, with a fallback for joined headers', () => {
    expect(cookieHeaderFrom(loginOk())).toBe('JSESSIONID=abc123; clientId=xyz');
    const joined = { headers: { get: () => 'a=1; Path=/, b=2; HttpOnly', getSetCookie: undefined } } as unknown as Response;
    expect(cookieHeaderFrom(joined)).toBe('a=1; b=2');
    expect(cookieHeaderFrom(response(200, {}))).toBe('');
  });
});
