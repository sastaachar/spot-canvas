import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachPersistence,
  localStorageBackend,
  parseLayout,
  pickBackend,
  restoreLayout,
  serializeLayout,
  type LayoutBackend
} from './persistence';
import { useCanvasStore, type PanelState } from './store';

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
  useCanvasStore.setState({ panels: {}, seq: 0, nextZ: 1 });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.spotCanvasHost;
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
});

describe('backends', () => {
  it('uses localStorage on the web', async () => {
    expect(pickBackend()).toBe(localStorageBackend);
    await localStorageBackend.write('{"v":1}');
    expect(await localStorageBackend.read()).toBe('{"v":1}');
  });

  it('prefers the desktop bridge when present', () => {
    const layout = { read: async () => null, write: async () => {} };
    window.spotCanvasHost = { kind: 'desktop', layout };
    expect(pickBackend()).toBe(layout);
  });
});
