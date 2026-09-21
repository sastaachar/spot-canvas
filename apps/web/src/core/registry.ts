import type { SpotCanvasPlugin } from '@spot-canvas/sdk';
import { isSpotCanvasPlugin } from '@spot-canvas/sdk';
import { create } from 'zustand';

interface RegistryState {
  plugins: Record<string, SpotCanvasPlugin>;
  register(plugin: SpotCanvasPlugin): void;
  loadFromUrl(url: string): Promise<SpotCanvasPlugin>;
}

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

export const usePluginRegistry = create<RegistryState>()((set, get) => ({
  plugins: {},

  register(plugin) {
    set({ plugins: { ...get().plugins, [plugin.manifest.id]: plugin } });
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
    if (!isSpotCanvasPlugin(mod.default)) {
      throw new PluginLoadError('The module has no default export matching { manifest, mount }.');
    }
    get().register(mod.default);
    return mod.default;
  }
}));

export const getPlugin = (id: string): SpotCanvasPlugin | undefined => usePluginRegistry.getState().plugins[id];

export const KIND_BLURB: Record<SpotCanvasPlugin['manifest']['kind'], string> = {
  workflow: 'Step-by-step checklist with progress.',
  embed: 'Any web page inside a panel.',
  widget: 'A small self-contained tool.'
};
