import type { SpotCanvasPlugin, SpotCanvasSuite } from '@spot-canvas/sdk';
import { isSpotCanvasPlugin, isSpotCanvasSuite } from '@spot-canvas/sdk';
import { create } from 'zustand';

interface RegistryState {
  plugins: Record<string, SpotCanvasPlugin>;
  suites: Record<string, SpotCanvasSuite>;
  suiteOf: Record<string, string>;
  register(plugin: SpotCanvasPlugin): void;
  registerSuite(suite: SpotCanvasSuite): void;
  loadFromUrl(url: string): Promise<SpotCanvasPlugin | SpotCanvasSuite>;
}

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

export const usePluginRegistry = create<RegistryState>()((set, get) => ({
  plugins: {},
  suites: {},
  suiteOf: {},

  register(plugin) {
    set({ plugins: { ...get().plugins, [plugin.manifest.id]: plugin } });
  },

  registerSuite(suite) {
    const plugins = { ...get().plugins };
    const suiteOf = { ...get().suiteOf };
    for (const plugin of suite.plugins) {
      plugins[plugin.manifest.id] = plugin;
      suiteOf[plugin.manifest.id] = suite.manifest.id;
    }
    set({ plugins, suiteOf, suites: { ...get().suites, [suite.manifest.id]: suite } });
  },

  async loadFromUrl(url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PluginLoadError('That is not a valid URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new PluginLoadError('Plugins load over https only.');
    }
    let mod: { default?: unknown };
    try {
      mod = (await import(/* @vite-ignore */ parsed.toString())) as { default?: unknown };
    } catch {
      throw new PluginLoadError('The module could not be fetched or failed to run.');
    }
    if (isSpotCanvasSuite(mod.default)) {
      get().registerSuite(mod.default);
      return mod.default;
    }
    if (isSpotCanvasPlugin(mod.default)) {
      get().register(mod.default);
      return mod.default;
    }
    throw new PluginLoadError('The module has no default export matching a plugin { manifest, mount } or a suite { manifest, plugins }.');
  }
}));

export const getPlugin = (id: string): SpotCanvasPlugin | undefined => usePluginRegistry.getState().plugins[id];

export const getSuite = (id: string): SpotCanvasSuite | undefined => usePluginRegistry.getState().suites[id];

export const suiteForPlugin = (pluginId: string): SpotCanvasSuite | undefined => {
  const state = usePluginRegistry.getState();
  const suiteId = state.suiteOf[pluginId];
  return suiteId ? state.suites[suiteId] : undefined;
};

export const KIND_BLURB: Record<SpotCanvasPlugin['manifest']['kind'], string> = {
  workflow: 'Step-by-step checklist with progress.',
  embed: 'Any web page inside a panel.',
  widget: 'A small self-contained tool.'
};
