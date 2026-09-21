import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayoutStore, type Layout } from './layouts.ts';

let dir: string;
let store: LayoutStore;

const layout: Layout = {
  version: 1,
  panels: [{ iid: 'a.b#1', pluginId: 'a.b', x: 0, y: 0, w: 200, h: 120, z: 1, data: null, title: null }]
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'layouts-'));
  store = new LayoutStore(path.join(dir, 'nested'));
  await store.init();
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('LayoutStore', () => {
  it('returns null for an unknown user and round-trips a layout', async () => {
    expect(await store.read('u1')).toBeNull();
    await store.write('u1', layout);
    expect(await store.read('u1')).toEqual(layout);
    expect(await store.read('u2')).toBeNull();
  });

  it('never uses the user id as a file name', async () => {
    await store.write('../../etc/passwd', layout);
    const files = await readdir(path.join(dir, 'nested'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('treats corrupt or foreign files as missing', async () => {
    await store.write('u1', layout);
    const [file] = await readdir(path.join(dir, 'nested'));
    await writeFile(path.join(dir, 'nested', file!), '{not json', 'utf8');
    expect(await store.read('u1')).toBeNull();
    await writeFile(path.join(dir, 'nested', file!), JSON.stringify({ version: 9 }), 'utf8');
    expect(await store.read('u1')).toBeNull();
  });

  it('propagates unexpected filesystem errors', async () => {
    const broken = new LayoutStore(path.join(dir, 'file-not-dir'));
    await writeFile(path.join(dir, 'file-not-dir'), 'x', 'utf8');
    await expect(broken.read('u1')).rejects.toThrow();
  });
});
