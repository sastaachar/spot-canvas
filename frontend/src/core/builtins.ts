import embed from '@spot-canvas/plugin-embed';
import link from '@spot-canvas/plugin-link';
import note from '@spot-canvas/plugin-note';
import thoughtspotChart from '@spot-canvas/plugin-thoughtspot-chart';
import timer from '@spot-canvas/plugin-timer';
import workflow from '@spot-canvas/plugin-workflow';
import { usePluginRegistry } from './registry';

export const BUILTIN_PLUGINS = [thoughtspotChart, embed, note, workflow, link, timer];

export function registerBuiltins(): void {
  const { register } = usePluginRegistry.getState();
  for (const plugin of BUILTIN_PLUGINS) register(plugin);
}
