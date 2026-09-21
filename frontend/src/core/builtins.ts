import embed from '@spot-canvas/plugin-embed';
import note from '@spot-canvas/plugin-note';
import timer from '@spot-canvas/plugin-timer';
import workflow from '@spot-canvas/plugin-workflow';
import { usePluginRegistry } from './registry';

export const BUILTIN_PLUGINS = [workflow, embed, note, timer];

export function registerBuiltins(): void {
  const { register } = usePluginRegistry.getState();
  for (const plugin of BUILTIN_PLUGINS) register(plugin);
}
