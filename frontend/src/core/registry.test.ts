import { definePlugin, defineSuite } from '@spot-canvas/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS, registerBuiltins } from './builtins';
import { getPlugin, getSuite, PluginLoadError, suiteForPlugin, usePluginRegistry } from './registry';

beforeEach(() => usePluginRegistry.setState({ plugins: {}, suites: {}, suiteOf: {} }));

describe('plugin registry', () => {
  it('registers builtins by id', () => {
    registerBuiltins();
    expect(Object.keys(usePluginRegistry.getState().plugins)).toHaveLength(BUILTIN_PLUGINS.length);
    expect(getPlugin('spotcanvas.workflow')?.manifest.kind).toBe('workflow');
    expect(getPlugin('nope')).toBeUndefined();
  });

  it('replaces a plugin registered under the same id', () => {
    const a = definePlugin({
      manifest: { apiVersion: 1, id: 'x.y', name: 'A', kind: 'widget', version: '0.1.0', size: [200, 120] },
      mount() {}
    });
    const b = definePlugin({ manifest: { ...a.manifest, name: 'B' }, mount() {} });
    usePluginRegistry.getState().register(a);
    usePluginRegistry.getState().register(b);
    expect(getPlugin('x.y')?.manifest.name).toBe('B');
  });

  it('registers a suite and its plugins together', () => {
    const a = definePlugin({
      manifest: { apiVersion: 1, id: 'x.a', name: 'A', kind: 'widget', version: '0.1.0', size: [200, 120] },
      mount() {}
    });
    const suite = defineSuite({ manifest: { apiVersion: 1, id: 'x.suite', name: 'X', version: '1.0.0' }, plugins: [a] });
    usePluginRegistry.getState().registerSuite(suite);
    expect(getSuite('x.suite')).toBe(suite);
    expect(getPlugin('x.a')).toBe(a);
    expect(suiteForPlugin('x.a')).toBe(suite);
    expect(suiteForPlugin('nope')).toBeUndefined();
  });

  it('refuses malformed and insecure urls before fetching', async () => {
    const { loadFromUrl } = usePluginRegistry.getState();
    await expect(loadFromUrl('not a url')).rejects.toBeInstanceOf(PluginLoadError);
    await expect(loadFromUrl('http://example.com/p.js')).rejects.toThrow(/https/);
  });

  it('reports a module that cannot be fetched', async () => {
    await expect(usePluginRegistry.getState().loadFromUrl('https://localhost:1/p.js')).rejects.toThrow(/fetched/);
  });
});
