import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLayoutDocument,
  attachPersistence,
  parseLayout,
  parseLayoutDocument,
  restoreLayout,
  serializeLayout,
  type LayoutBackend
} from './persistence';
import { usePluginRegistry } from './registry';
import { useCanvasStore, type PanelState } from './store';
import { useToastStore } from './toasts';

const panel: PanelState = { iid: 'a.b#1', pluginId: 'a.b', x: 1, y: 2, w: 200, h: 120, z: 1, data: { t: 'x' } };

const memoryBackend = (): LayoutBackend & { value: string | null } => {
  const b = {
    value: null as string | null,
    async read() {
      return b.value;
    },
    async write(json: string) {
      b.value = json;
    }
  };
  return b;
};

beforeEach(() => {
  useCanvasStore.setState({ panels: {}, suites: {}, groups: {}, preferences: { theme: 'system' }, seq: 0, gseq: 0, nextZ: 1 });
  useToastStore.setState({ toasts: [] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseLayout', () => {
  it('round-trips a serialised layout', () => {
    expect(parseLayout(serializeLayout({ [panel.iid]: panel }))).toEqual([panel]);
  });

  it('rejects garbage, wrong versions and bad shapes', () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout(JSON.stringify({ version: 2, panels: [] }))).toBeNull();
    expect(parseLayout(JSON.stringify({ version: 1, panels: [{ iid: 1 }] }))).toBeNull();
  });
});

describe('restoreLayout', () => {
  it('hydrates the store from the backend', async () => {
    const backend = memoryBackend();
    backend.value = serializeLayout({ [panel.iid]: panel });
    expect(await restoreLayout(backend)).toBe(true);
    expect(useCanvasStore.getState().panels[panel.iid]).toEqual(panel);
  });

  it('returns false and leaves the store alone when nothing is stored', async () => {
    expect(await restoreLayout(memoryBackend())).toBe(false);
    expect(useCanvasStore.getState().panels).toEqual({});
  });

  it('toasts and returns false when the backend fails', async () => {
    const backend: LayoutBackend = { read: () => Promise.reject(new Error('503')), write: async () => {} };
    expect(await restoreLayout(backend)).toBe(false);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: 'error' });
  });
});

describe('attachPersistence', () => {
  it('writes the layout after panel changes settle, and not for drawer changes', async () => {
    vi.useFakeTimers();
    const backend = memoryBackend();
    const detach = attachPersistence(backend);
    useCanvasStore.getState().setDrawer(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.value).toBeNull();

    useCanvasStore.getState().hydrate([panel]);
    useCanvasStore.getState().movePanel(panel.iid, 10, 10);
    await vi.advanceTimersByTimeAsync(500);
    expect(parseLayout(backend.value)?.[0]).toMatchObject({ x: 10, y: 10 });

    detach();
    useCanvasStore.getState().movePanel(panel.iid, 20, 20);
    await vi.advanceTimersByTimeAsync(500);
    expect(parseLayout(backend.value)?.[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('toasts when a write fails', async () => {
    vi.useFakeTimers();
    const backend: LayoutBackend = { read: async () => null, write: () => Promise.reject(new Error('500')) };
    const detach = attachPersistence(backend);
    useCanvasStore.getState().hydrate([panel]);
    await vi.advanceTimersByTimeAsync(500);
    expect(useToastStore.getState().toasts[0]?.message).toContain('could not be saved');
    detach();
  });
});

describe('suites in the layout document', () => {
  const suites = { 'acme.suite': { url: 'https://p.example/acme.js', settings: { host: 'https://x' }, configured: true } };

  it('round-trips suite state and tolerates documents without it', () => {
    const group = { gid: 'group#1', title: 'Sales', x: 0, y: 0, w: 400, h: 300, color: 'amber' as const };
    const doc = parseLayoutDocument(serializeLayout({ [panel.iid]: panel }, suites, { [group.gid]: group }, { theme: 'dark' }));
    expect(doc).toEqual({ panels: [panel], suites, groups: [group], preferences: { theme: 'dark' } });
    expect(parseLayoutDocument(JSON.stringify({ version: 1, panels: [] }))).toEqual({
      panels: [],
      suites: {},
      groups: [],
      preferences: { theme: 'system' }
    });
    expect(parseLayoutDocument(JSON.stringify({ version: 1, panels: [], groups: [{ ...group, color: 'pink' }] }))).toBeNull();
    expect(parseLayoutDocument(JSON.stringify({ version: 1, panels: [], suites: { a: { url: 1 } } }))).toBeNull();
  });

  it('loads suite modules from their urls before hydrating, and toasts when one fails', async () => {
    const loadFromUrl = vi.fn(async (url: string) => {
      if (url.includes('bad')) throw new Error('offline');
      return {} as never;
    });
    usePluginRegistry.setState({ loadFromUrl, suites: { 'already.loaded': {} as never } });
    const backend = memoryBackend();
    backend.value = serializeLayout({}, {
      ...suites,
      'bad.suite': { url: 'https://p.example/bad.js', settings: {}, configured: false },
      'already.loaded': { url: 'https://p.example/loaded.js', settings: {}, configured: true },
      'local.suite': { url: null, settings: {}, configured: true }
    });
    expect(await restoreLayout(backend)).toBe(true);
    expect(loadFromUrl.mock.calls.map(([u]) => u).sort()).toEqual(['https://p.example/acme.js', 'https://p.example/bad.js']);
    expect(Object.keys(useCanvasStore.getState().suites)).toHaveLength(4);
    expect(useToastStore.getState().toasts[0]?.message).toContain('bad.suite');
  });

  it('persists suite changes too', async () => {
    vi.useFakeTimers();
    const backend = memoryBackend();
    const detach = attachPersistence(backend);
    useCanvasStore.getState().configureSuite('acme.suite', { host: 'https://x' });
    await vi.advanceTimersByTimeAsync(500);
    expect(parseLayoutDocument(backend.value)?.suites['acme.suite']).toEqual({ url: null, settings: { host: 'https://x' }, configured: true });
    detach();
  });
});

describe('applyLayoutDocument', () => {
  it('hydrates from an object or a JSON string and rejects garbage', async () => {
    expect(await applyLayoutDocument({ version: 1, panels: [panel], groups: [], preferences: { theme: 'dark' } })).toBe(true);
    expect(useCanvasStore.getState().panels[panel.iid]).toEqual(panel);
    expect(useCanvasStore.getState().preferences.theme).toBe('dark');
    expect(await applyLayoutDocument(JSON.stringify({ version: 1, panels: [] }))).toBe(true);
    expect(useCanvasStore.getState().panels).toEqual({});
    expect(await applyLayoutDocument({ nope: true })).toBe(false);
    expect(await applyLayoutDocument({ panels: [panel], groups: [], suites: {}, preferences: { theme: 'light' } })).toBe(true);
    expect(useCanvasStore.getState().preferences.theme).toBe('light');
  });
});
