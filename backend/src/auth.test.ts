import { describe, expect, it, vi } from 'vitest';
import { authenticatorFor, chain, devAuthenticator, thoughtSpotAuthenticator, tokensEqual, UpstreamError } from './auth.ts';
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
    gateway: null
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
