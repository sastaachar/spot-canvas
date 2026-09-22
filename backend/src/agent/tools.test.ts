import { describe, expect, it } from 'vitest';
import type { Layout } from '../layouts.ts';
import { applyTool, THOUGHTSPOT_TOOLS, TOOLS, toolsFor, type CataloguePlugin, type ToolContext } from './tools.ts';
import { ThoughtSpotClient } from './thoughtspot.ts';

const catalogue: CataloguePlugin[] = [
  { id: 'spotcanvas.note', name: 'Sticky note', kind: 'widget', size: [220, 160] },
  { id: 'spotcanvas.links', name: 'Links', kind: 'widget', size: [300, 220] }
];

const fresh = (): ToolContext => ({
  layout: { version: 1, panels: [], suites: {}, groups: [], preferences: {} } as Layout,
  catalogue
});

describe('tool definitions', () => {
  it('exposes every tool applyTool understands and nothing else', async () => {
    const names = TOOLS.map((t) => t.function.name).sort();
    expect(names).toEqual(
      ['add_panel', 'clear_homepage', 'create_group', 'get_homepage', 'remove_group', 'remove_panel', 'set_theme', 'update_group', 'update_panel'].sort()
    );
    expect((await applyTool('nope', {}, fresh())).result).toEqual({ error: 'unknown tool nope' });
  });
});

describe('toolsFor', () => {
  it('adds the ThoughtSpot tools only when a cluster client is present', async () => {
    expect(toolsFor(fresh())).toHaveLength(TOOLS.length);
    const cluster = { host: 'https://ts.example', cookie: 'JSESSIONID=t', expiresAt: 0 };
    expect(toolsFor({ ...fresh(), thoughtSpot: new ThoughtSpotClient(cluster, async () => new Response('{}')) })).toHaveLength(TOOLS.length + THOUGHTSPOT_TOOLS.length);
  });
});

describe('panels', () => {
  it('adds panels without overlap, numbering ids and z per plugin', async () => {
    const ctx = fresh();
    const a = await applyTool('add_panel', { plugin_id: 'spotcanvas.note', data: { text: 'a' } }, ctx);
    const b = await applyTool('add_panel', { plugin_id: 'spotcanvas.note' }, ctx);
    expect(a.changed && b.changed).toBe(true);
    const [pa, pb] = ctx.layout.panels;
    expect(pa).toMatchObject({ iid: 'spotcanvas.note#1', x: 40, y: 40, w: 220, h: 160, z: 1, data: { text: 'a' } });
    expect(pb).toMatchObject({ iid: 'spotcanvas.note#2', z: 2, data: null });
    const gap = pb!.x >= pa!.x + pa!.w + 24 || pb!.y >= pa!.y + pa!.h + 24;
    expect(gap).toBe(true);
  });

  it('rejects unknown plugins, unknown groups and bad arguments', async () => {
    const ctx = fresh();
    expect((await applyTool('add_panel', { plugin_id: 'nope' }, ctx)).result).toMatchObject({ error: expect.stringContaining('unknown plugin') });
    expect((await applyTool('add_panel', { plugin_id: 'spotcanvas.note', group_id: 'group#9' }, ctx)).result).toMatchObject({ error: expect.stringContaining('unknown group') });
    expect((await applyTool('add_panel', { plugin_id: 5 }, ctx)).changed).toBe(false);
    expect((await applyTool('update_panel', { iid: 'x' }, ctx)).result).toMatchObject({ error: expect.stringContaining('unknown panel') });
    expect((await applyTool('remove_panel', { iid: 'x' }, ctx)).result).toMatchObject({ error: expect.stringContaining('unknown panel') });
    expect((await applyTool('remove_panel', {}, ctx)).changed).toBe(false);
    expect(ctx.layout.panels).toHaveLength(0);
  });

  it('updates title, merges data, moves, resizes, regroups and removes', async () => {
    const ctx = fresh();
    await applyTool('create_group', { title: 'G' }, ctx);
    await applyTool('add_panel', { plugin_id: 'spotcanvas.links', data: { items: [] } }, ctx);
    const iid = 'spotcanvas.links#1';
    await applyTool('update_panel', { iid, title: 'Mine', data: { extra: 1 }, x: -10, y: 5, w: 400, h: 300, group_id: 'group#1' }, ctx);
    expect(ctx.layout.panels[0]).toMatchObject({ title: 'Mine', data: { items: [], extra: 1 }, x: 0, y: 5, w: 400, h: 300, groupId: 'group#1' });
    await applyTool('update_panel', { iid, title: null, group_id: null }, ctx);
    expect(ctx.layout.panels[0]).toMatchObject({ title: null, groupId: null });
    expect((await applyTool('update_panel', { iid, group_id: 'group#7' }, ctx)).result).toMatchObject({ error: expect.stringContaining('unknown group') });
    ctx.layout.panels[0]!.data = 'not an object';
    await applyTool('update_panel', { iid, data: { a: 1 } }, ctx);
    expect(ctx.layout.panels[0]!.data).toEqual({ a: 1 });
    expect((await applyTool('remove_panel', { iid }, ctx)).changed).toBe(true);
    expect(ctx.layout.panels).toHaveLength(0);
  });

  it('places panels inside a group below its title and keeps them apart', async () => {
    const ctx = fresh();
    await applyTool('create_group', { title: 'Today', x: 100, y: 100, w: 600, h: 400 }, ctx);
    await applyTool('add_panel', { plugin_id: 'spotcanvas.note', group_id: 'group#1' }, ctx);
    await applyTool('add_panel', { plugin_id: 'spotcanvas.note', group_id: 'group#1' }, ctx);
    const [a, b] = ctx.layout.panels;
    expect(a).toMatchObject({ x: 116, y: 144, groupId: 'group#1' });
    expect(b!.x >= a!.x + a!.w + 24 || b!.y >= a!.y + a!.h + 24).toBe(true);
    expect(b!.x + b!.w).toBeLessThanOrEqual(700 + 24);
  });
});

describe('groups, theme and summary', () => {
  it('creates, updates (moving members), and removes groups with or without panels', async () => {
    const ctx = fresh();
    const created = await applyTool('create_group', { title: 'Sales', color: 'green' }, ctx);
    expect(created.result).toMatchObject({ gid: 'group#1', x: 40, y: 40, w: 560, h: 380 });
    await applyTool('add_panel', { plugin_id: 'spotcanvas.note', group_id: 'group#1' }, ctx);
    await applyTool('add_panel', { plugin_id: 'spotcanvas.note' }, ctx);
    const inside = ctx.layout.panels[0]!;
    const before = { x: inside.x, y: inside.y };
    await applyTool('update_group', { gid: 'group#1', title: 'Revenue', color: 'violet', x: 140, y: 90, w: 700, h: 500 }, ctx);
    expect(ctx.layout.groups![0]).toMatchObject({ title: 'Revenue', color: 'violet', x: 140, y: 90, w: 700, h: 500 });
    expect(ctx.layout.panels[0]).toMatchObject({ x: before.x + 100, y: before.y + 50 });
    expect((await applyTool('update_group', { gid: 'nope' }, ctx)).changed).toBe(false);
    expect((await applyTool('create_group', { title: '' }, ctx)).changed).toBe(false);

    await applyTool('remove_group', { gid: 'group#1' }, ctx);
    expect(ctx.layout.groups).toEqual([]);
    expect(ctx.layout.panels.map((p) => p.groupId)).toEqual([null, null]);
    expect((await applyTool('remove_group', { gid: 'group#1' }, ctx)).changed).toBe(false);

    const temp = (await applyTool('create_group', { title: 'Temp' }, ctx)).result as { gid: string };
    await applyTool('update_panel', { iid: ctx.layout.panels[0]!.iid, group_id: temp.gid }, ctx);
    await applyTool('remove_group', { gid: temp.gid, with_panels: true }, ctx);
    expect(ctx.layout.panels).toHaveLength(1);
  });

  it('sets the theme, clears, and summarises', async () => {
    const ctx = fresh();
    expect(await applyTool('set_theme', { theme: 'dark' }, ctx)).toMatchObject({ changed: true });
    expect(ctx.layout.preferences).toEqual({ theme: 'dark' });
    expect((await applyTool('set_theme', { theme: 'neon' }, ctx)).changed).toBe(false);
    await applyTool('add_panel', { plugin_id: 'spotcanvas.note', title: 'Hi' }, ctx);
    const summary = (await applyTool('get_homepage', {}, ctx)).result as { panels: unknown[]; available_plugins: unknown[]; theme: string };
    expect(summary.theme).toBe('dark');
    expect(summary.panels[0]).toMatchObject({ iid: 'spotcanvas.note#1', plugin_id: 'spotcanvas.note', title: 'Hi', group_id: null });
    expect(summary.available_plugins).toHaveLength(2);
    expect(await applyTool('clear_homepage', {}, ctx)).toMatchObject({ changed: true, result: { removed: 1 } });
    expect((await applyTool('clear_homepage', {}, ctx)).changed).toBe(false);
  });
});
