import { describe, expect, it } from 'vitest';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, sessionCookie, SessionStore } from './sessions.ts';

const identity = { id: 'u1', name: 'alice', displayName: 'Alice' };

describe('SessionStore', () => {
  it('creates unguessable ids and resolves them until they expire', () => {
    let now = 1000;
    const store = new SessionStore(500, () => now);
    const a = store.create(identity);
    const b = store.create(identity);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(store.get(a)).toEqual(identity);
    now = 1499;
    expect(store.get(a)).toEqual(identity);
    now = 1500;
    expect(store.get(a)).toBeNull();
    expect(store.get('unknown')).toBeNull();
  });

  it('keeps a cluster token beside the identity and forgets it on expiry', () => {
    let now = 0;
    const store = new SessionStore(10, () => now);
    const cluster = { host: 'https://ts.example', token: 't', expiresAt: 999 };
    const withCluster = store.create(identity, cluster);
    const without = store.create(identity);
    expect(store.cluster(withCluster)).toEqual(cluster);
    expect(store.cluster(without)).toBeNull();
    now = 10;
    expect(store.cluster(withCluster)).toBeNull();
  });

  it('deletes and sweeps', () => {
    let now = 0;
    const store = new SessionStore(10, () => now);
    const a = store.create(identity);
    store.create(identity);
    store.delete(a);
    expect(store.size).toBe(1);
    now = 11;
    store.sweep();
    expect(store.size).toBe(0);
  });
});

describe('cookies', () => {
  it('parses a cookie header leniently', () => {
    const cookies = parseCookies(`a=1; ${SESSION_COOKIE}=abc==; junk;  =x; b = 2 `);
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get(SESSION_COOKIE)).toBe('abc==');
    expect(cookies.get('b')).toBe('2');
    expect(cookies.has('junk')).toBe(false);
    expect(parseCookies(undefined).size).toBe(0);
  });

  it('emits hardened Set-Cookie values', () => {
    expect(sessionCookie('sid', 90_000, true)).toBe('sc_session=sid; Path=/; HttpOnly; SameSite=Strict; Max-Age=90; Secure');
    expect(sessionCookie('sid', 90_000, false)).not.toContain('Secure');
    expect(clearSessionCookie(true)).toBe('sc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  });
});
