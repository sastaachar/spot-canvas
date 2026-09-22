import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    const cluster = { host: 'https://ts.example', cookie: 'JSESSIONID=t', expiresAt: 999 };
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

describe('persistence and sliding expiry', () => {
  it('survives a restart, drops expired entries on load, and ignores a corrupt file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    const file = path.join(dir, 'nested', 'sessions.json');
    try {
      let now = 1000;
      const first = new SessionStore(500, () => now, file);
      const cluster = { host: 'https://ts.example', cookie: 'JSESSIONID=abc', expiresAt: 9999 };
      const keep = first.create(identity, cluster);
      const drop = first.create(identity);
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('600');

      now = 1200;
      const reloaded = new SessionStore(500, () => now, file);
      expect(reloaded.get(keep)).toEqual(identity);
      expect(reloaded.cluster(keep)).toEqual(cluster);
      expect(reloaded.get(drop)).toEqual(identity);

      now = 1600;
      const later = new SessionStore(500, () => now, file);
      expect(later.get(keep)).toBeNull();
      expect(later.size).toBe(0);

      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '{not json', 'utf8');
      expect(new SessionStore(500, () => now, file).size).toBe(0);
      await writeFile(file, JSON.stringify({ x: { nope: 1 } }), 'utf8');
      expect(new SessionStore(500, () => now, file).size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('extends a session only once it is past half its life, and persists the extension', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    const file = path.join(dir, 'sessions.json');
    try {
      let now = 0;
      const store = new SessionStore(1000, () => now, file);
      const sid = store.create(identity);
      now = 400;
      expect(store.touch(sid)).toBe(false);
      now = 600;
      expect(store.touch(sid)).toBe(true);
      now = 1500;
      expect(store.get(sid)).toEqual(identity);
      const persisted = JSON.parse(await readFile(file, 'utf8')) as Record<string, { expiresAt: number }>;
      expect(persisted[sid]!.expiresAt).toBe(1600);
      expect(store.touch('nope')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
