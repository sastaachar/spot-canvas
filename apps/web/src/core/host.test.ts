import type { PluginManifest } from '@spot-canvas/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createPluginApi, ensurePluginStyle, EventBus, PluginPermissionError, type HostDeps } from './host';

const manifest = (permissions: PluginManifest['permissions']): PluginManifest => ({
  apiVersion: 1,
  id: 'test.plugin',
  name: 'Test',
  kind: 'widget',
  version: '0.1.0',
  size: [200, 120],
  permissions
});

const deps = (overrides: Partial<HostDeps> = {}): HostDeps & { data: Record<string, unknown> } => {
  const data: Record<string, unknown> = {};
  return {
    data,
    hostKind: 'web',
    bus: new EventBus(),
    styleRoot: document,
    getData: (iid) => data[iid] ?? null,
    setData: (iid, v) => {
      data[iid] = v;
    },
    resize: vi.fn(),
    close: vi.fn(),
    setTitle: vi.fn(),
    notify: vi.fn(),
    theme: () => 'light',
    onThemeChange: vi.fn(() => () => {}),
    ...overrides
  };
};

describe('EventBus', () => {
  it('delivers to subscribers and unsubscribes cleanly', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('x', fn);
    bus.emit('x', 1, 'a');
    off();
    bus.emit('x', 2, 'a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, 'a');
    expect(bus.count('x')).toBe(0);
  });

  it('contains a throwing handler and reports it, other handlers still run', () => {
    const fault = vi.fn();
    const bus = new EventBus(fault);
    const ok = vi.fn();
    bus.on('x', () => {
      throw new Error('bad');
    });
    bus.on('x', ok);
    bus.emit('x', null, 'p#1');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(fault).toHaveBeenCalledWith('p#1', 'events:x', expect.any(Error));
  });
});

describe('createPluginApi', () => {
  it('reports the host kind', () => {
    expect(createPluginApi('p#1', manifest([]), deps({ hostKind: 'desktop' })).api.host.kind).toBe('desktop');
  });

  it('gates storage behind the storage permission and rejects unserialisable data', () => {
    const d = deps();
    const denied = createPluginApi('p#1', manifest([]), d).api;
    expect(() => denied.storage.get()).toThrow(PluginPermissionError);
    expect(() => denied.storage.set(1)).toThrow(/storage/);

    const granted = createPluginApi('p#2', manifest(['storage']), d).api;
    expect(granted.storage.get()).toBeNull();
    granted.storage.set({ a: 1 });
    expect(granted.storage.get()).toEqual({ a: 1 });
    expect(() => granted.storage.set({ fn: () => 1 })).toThrow(TypeError);
  });

  it('gates events behind the events permission and cleans listeners on dispose', () => {
    const d = deps();
    const denied = createPluginApi('p#1', manifest([]), d).api;
    expect(() => denied.events.emit('x')).toThrow(PluginPermissionError);
    expect(() => denied.events.on('x', () => {})).toThrow(PluginPermissionError);

    const a = createPluginApi('p#2', manifest(['events']), d);
    const b = createPluginApi('p#3', manifest(['events']), d);
    const fn = vi.fn();
    a.api.events.on('ping', fn);
    b.api.events.emit('ping', 42);
    expect(fn).toHaveBeenCalledWith(42, 'p#3');
    a.dispose();
    b.api.events.emit('ping', 43);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.bus.count('ping')).toBe(0);
  });

  it('gates fetch behind the network permission and allows only http(s)', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    const d = deps({ fetch: fetchMock as unknown as typeof fetch });
    expect(() => createPluginApi('p#1', manifest([]), d).api.net.fetch('https://a.test')).toThrow(PluginPermissionError);

    const { api } = createPluginApi('p#2', manifest(['network']), d);
    expect(() => api.net.fetch('file:///etc/passwd')).toThrow(TypeError);
    expect(() => api.net.fetch('nope')).toThrow();
    const res = await api.net.fetch('https://a.test/x', { method: 'POST' });
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://a.test/x'), { method: 'POST' });
  });

  it('routes ui calls to the host with the panel id', () => {
    const d = deps();
    const { api } = createPluginApi('p#1', manifest([]), d);
    api.ui.resize(300, 200);
    api.ui.close();
    api.ui.setTitle('  Hello  ');
    api.ui.setTitle('   ');
    api.ui.setTitle(null);
    api.ui.setTitle('x'.repeat(100));
    api.ui.notify('done', 'success');
    api.ui.notify('hi');
    expect(d.resize).toHaveBeenCalledWith('p#1', 300, 200);
    expect(d.close).toHaveBeenCalledWith('p#1');
    expect(d.setTitle).toHaveBeenNthCalledWith(1, 'p#1', 'Hello');
    expect(d.setTitle).toHaveBeenNthCalledWith(2, 'p#1', null);
    expect(d.setTitle).toHaveBeenNthCalledWith(3, 'p#1', null);
    expect(d.setTitle).toHaveBeenNthCalledWith(4, 'p#1', 'x'.repeat(60));
    expect(d.notify).toHaveBeenNthCalledWith(1, 'done', 'success', 'p#1');
    expect(d.notify).toHaveBeenNthCalledWith(2, 'hi', 'info', 'p#1');
  });

  it('exposes the theme and unsubscribes theme listeners on dispose', () => {
    const off = vi.fn();
    const d = deps({ theme: () => 'dark', onThemeChange: vi.fn(() => off) });
    const handle = createPluginApi('p#1', manifest([]), d);
    expect(handle.api.theme.get()).toBe('dark');
    handle.api.theme.onChange(() => {});
    handle.dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('runs onUnmount hooks once, swallowing hook errors', () => {
    const handle = createPluginApi('p#1', manifest([]), deps());
    const ok = vi.fn();
    handle.api.onUnmount(() => {
      throw new Error('boom');
    });
    handle.api.onUnmount(ok);
    handle.dispose();
    handle.dispose();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('injects a plugin stylesheet once into the given root', () => {
    const shadowHost = document.createElement('div');
    const root = shadowHost.attachShadow({ mode: 'open' });
    const { api } = createPluginApi('p#1', manifest([]), deps({ styleRoot: root }));
    api.ui.style('.a{}');
    api.ui.style('.a{}');
    expect(root.querySelectorAll('style[data-spot-canvas-plugin="test.plugin"]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-spot-canvas-plugin="test.plugin"]')).toBeNull();

    ensurePluginStyle('test.plugin', '.a{}', document);
    ensurePluginStyle('test.plugin', '.a{}', document);
    expect(document.head.querySelectorAll('style[data-spot-canvas-plugin="test.plugin"]')).toHaveLength(1);
  });
});
