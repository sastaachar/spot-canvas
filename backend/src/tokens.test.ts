import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TokenStore } from './tokens.ts';

const alice = { id: 'u1', name: 'alice', displayName: 'Alice' };
const bob = { id: 'u2', name: 'bob', displayName: 'Bob' };

describe('TokenStore', () => {
  it('creates unguessable tokens, resolves them, lists per user, revokes, and persists only hashes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tokens-'));
    const file = path.join(dir, 'nested', 'tokens.json');
    try {
      const store = new TokenStore(file);
      const t1 = store.create(alice, 'MCP', 1000);
      const t2 = store.create(alice, 'Script', 2000);
      const t3 = store.create(bob, 'MCP', 3000);
      expect(t1.startsWith('sc_')).toBe(true);
      expect(t1).not.toBe(t2);
      expect(store.resolve(t1)).toEqual(alice);
      expect(store.resolve('sc_nope')).toBeNull();
      expect(store.list(alice.id)).toEqual([{ label: 'MCP', createdAt: 1000 }, { label: 'Script', createdAt: 2000 }]);
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('600');
      const raw = await import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8'));
      expect(raw).not.toContain(t1);

      const reloaded = new TokenStore(file);
      expect(reloaded.resolve(t3)).toEqual(bob);
      expect(reloaded.revokeAll(alice.id)).toBe(2);
      expect(reloaded.resolve(t1)).toBeNull();
      expect(reloaded.resolve(t3)).toEqual(bob);
      expect(reloaded.revokeAll(alice.id)).toBe(0);

      await writeFile(file, '{bad', 'utf8');
      expect(new TokenStore(file).size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
