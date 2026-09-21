import type { PluginManifest } from '@spot-canvas/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectInstalledIds, selectOrderedPanels, useCanvasStore } from './store';

const manifest: PluginManifest = {
  apiVersion: 1,
  id: 'test.widget',
  name: 'Test',
  kind: 'widget',
  version: '0.1.0',
  size: [240, 160],
  permissions: []
};

const reset = () =>
  useCanvasStore.setState({ panels: {}, suites: {}, groups: {}, preferences: { theme: 'system' }, seq: 0, gseq: 0, nextZ: 1, drawerOpen: false, drawerTab: 'browse' });

describe('canvas store', () => {
  beforeEach(reset);

  it('adds a panel with manifest size and staggered position', () => {
    const s = useCanvasStore.getState();
    const a = s.addPanel(manifest);
    const b = s.addPanel(manifest);
    const panels = useCanvasStore.getState().panels;
    expect(panels[a]).toMatchObject({ w: 240, h: 160, x: 70, y: 40, z: 1, data: null });
    expect(panels[b]).toMatchObject({ x: 98, y: 68, z: 2 });
    expect(a).not.toBe(b);
  });

  it('honours an explicit placement and data', () => {
    const iid = useCanvasStore.getState().addPanel(manifest, { x: 5, y: 6, w: 300, h: 200, data: { n: 1 } });
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 5, y: 6, w: 300, h: 200, data: { n: 1 } });
  });

  it('removes a panel', () => {
    const iid = useCanvasStore.getState().addPanel(manifest);
    useCanvasStore.getState().removePanel(iid);
    expect(useCanvasStore.getState().panels).toEqual({});
  });

  it('clamps moves to the canvas origin and sizes to the minimum', () => {
    const iid = useCanvasStore.getState().addPanel(manifest);
    useCanvasStore.getState().movePanel(iid, -50, -10);
    useCanvasStore.getState().resizePanel(iid, 10, 10);
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 0, y: 0, w: 200, h: 120 });
  });

  it('ignores moves and resizes for unknown panels', () => {
    useCanvasStore.getState().movePanel('nope', 1, 1);
    useCanvasStore.getState().resizePanel('nope', 1, 1);
    useCanvasStore.getState().setPanelData('nope', 1);
    expect(useCanvasStore.getState().panels).toEqual({});
  });

  it('focus brings a panel to the top and is a no-op when already on top', () => {
    const s = useCanvasStore.getState();
    const a = s.addPanel(manifest);
    const b = s.addPanel(manifest);
    s.focusPanel(a);
    let panels = useCanvasStore.getState().panels;
    expect(panels[a]!.z).toBeGreaterThan(panels[b]!.z);
    const before = useCanvasStore.getState().nextZ;
    useCanvasStore.getState().focusPanel(a);
    expect(useCanvasStore.getState().nextZ).toBe(before);
    panels = useCanvasStore.getState().panels;
    expect(selectOrderedPanels(useCanvasStore.getState()).map((p) => p.iid)).toEqual([b, a]);
  });

  it('stores per-panel data and reports installed plugin ids', () => {
    const iid = useCanvasStore.getState().addPanel(manifest);
    useCanvasStore.getState().setPanelData(iid, { hello: 1 });
    expect(useCanvasStore.getState().panels[iid]!.data).toEqual({ hello: 1 });
    expect([...selectInstalledIds(useCanvasStore.getState())]).toEqual(['test.widget']);
  });

  it('sets and clears a title override', () => {
    const iid = useCanvasStore.getState().addPanel(manifest);
    useCanvasStore.getState().setPanelTitle(iid, 'Renamed');
    expect(useCanvasStore.getState().panels[iid]!.title).toBe('Renamed');
    useCanvasStore.getState().setPanelTitle(iid, null);
    expect(useCanvasStore.getState().panels[iid]!.title).toBeNull();
    useCanvasStore.getState().setPanelTitle('nope', 'x');
  });

  it('clears everything', () => {
    useCanvasStore.getState().addPanel(manifest);
    useCanvasStore.getState().clearPanels();
    expect(useCanvasStore.getState().panels).toEqual({});
  });

  it('hydrates and continues numbering after the highest restored id', () => {
    useCanvasStore.getState().hydrate([
      { iid: 'test.widget#7', pluginId: 'test.widget', x: 1, y: 2, w: 200, h: 120, z: 4, data: null }
    ]);
    const next = useCanvasStore.getState().addPanel(manifest);
    expect(next).toBe('test.widget#8');
    expect(useCanvasStore.getState().panels[next]!.z).toBe(5);
  });

  it('tracks suite sources and merges settings without losing the url', () => {
    const s = useCanvasStore.getState();
    s.trackSuite('a.s', 'https://p.example/a.js');
    expect(useCanvasStore.getState().suites['a.s']).toEqual({ url: 'https://p.example/a.js', settings: {}, configured: false });
    s.configureSuite('a.s', { host: 'x' });
    s.configureSuite('a.s', { retries: 2 });
    expect(useCanvasStore.getState().suites['a.s']).toEqual({ url: 'https://p.example/a.js', settings: { host: 'x', retries: 2 }, configured: true });
    s.trackSuite('a.s', null);
    expect(useCanvasStore.getState().suites['a.s']).toMatchObject({ url: null, configured: true });
    s.configureSuite('b.s', {});
    expect(useCanvasStore.getState().suites['b.s']).toEqual({ url: null, settings: {}, configured: true });
    s.hydrate([], { 'c.s': { url: null, settings: {}, configured: false } });
    expect(Object.keys(useCanvasStore.getState().suites)).toEqual(['c.s']);
  });

  it('manages groups: create, resize floors, settle by containment, rename, hydrate with orphan cleanup', () => {
    const s = useCanvasStore.getState();
    const gid = s.addGroup({ x: -5, y: 10, w: 10, h: 10 });
    expect(useCanvasStore.getState().groups[gid]).toMatchObject({ x: 0, y: 10, w: 240, h: 160, title: 'Group 1' });
    s.resizeGroup(gid, 1000, 20);
    expect(useCanvasStore.getState().groups[gid]).toMatchObject({ w: 1000, h: 160 });
    s.renameGroup(gid, '   ');
    expect(useCanvasStore.getState().groups[gid]!.title).toBe('Group 1');
    s.renameGroup(gid, ' Sales ');
    expect(useCanvasStore.getState().groups[gid]!.title).toBe('Sales');
    s.recolorGroup(gid, 'green');
    expect(useCanvasStore.getState().groups[gid]!.color).toBe('green');

    const inside = s.addPanel(manifest, { x: 20, y: 20 });
    const outside = s.addPanel(manifest, { x: 2000, y: 20 });
    s.settlePanel(inside);
    s.settlePanel(outside);
    expect(useCanvasStore.getState().panels[inside]!.groupId).toBe(gid);
    expect(useCanvasStore.getState().panels[outside]!.groupId).toBeNull();
    s.assignPanel(outside, 'missing');
    expect(useCanvasStore.getState().panels[outside]!.groupId).toBeNull();
    s.moveGroup('missing', 1, 1);
    s.resizeGroup('missing', 1, 1);
    s.renameGroup('missing', 'x');
    s.recolorGroup('missing', 'blue');
    s.settlePanel('missing');

    s.hydrate([{ iid: 'test.widget#9', pluginId: 'test.widget', x: 0, y: 0, w: 200, h: 120, z: 1, data: null, groupId: 'group#7' }], {}, [
      { gid: 'group#3', title: 'Kept', x: 0, y: 0, w: 300, h: 200, color: 'slate' }
    ]);
    expect(useCanvasStore.getState().panels['test.widget#9']!.groupId).toBeNull();
    expect(useCanvasStore.getState().addGroup()).toBe('group#4');
    expect(useCanvasStore.getState().preferences).toEqual({ theme: 'system' });
    useCanvasStore.getState().setPreferences({ theme: 'dark' });
    expect(useCanvasStore.getState().preferences.theme).toBe('dark');
  });

  it('toggles the drawer and switches tab only when asked', () => {
    useCanvasStore.getState().setDrawer(true, 'developer');
    expect(useCanvasStore.getState()).toMatchObject({ drawerOpen: true, drawerTab: 'developer' });
    useCanvasStore.getState().setDrawer(false);
    expect(useCanvasStore.getState()).toMatchObject({ drawerOpen: false, drawerTab: 'developer' });
  });
});
