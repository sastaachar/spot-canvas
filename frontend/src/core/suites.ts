import { missingRequiredSettings, type SpotCanvasSuite, type SuiteSettings } from '@spot-canvas/sdk';
import { create } from 'zustand';
import { suiteForPlugin } from './registry';
import { useCanvasStore, type SuiteState } from './store';

export function needsSetup(suite: SpotCanvasSuite, state: SuiteState | undefined): boolean {
  if (suite.setup && !state?.configured) return true;
  return missingRequiredSettings(suite.manifest, state?.settings ?? {}).length > 0;
}

export function hasSetup(suite: SpotCanvasSuite): boolean {
  return suite.setup !== undefined || suite.manifest.settings.length > 0;
}

export function settingsForPlugin(pluginId: string): SuiteSettings {
  const suite = suiteForPlugin(pluginId);
  if (!suite) return {};
  return useCanvasStore.getState().suites[suite.manifest.id]?.settings ?? {};
}

interface SetupState {
  suiteId: string | null;
  onDone: (() => void) | null;
  open(suiteId: string, onDone?: () => void): void;
  close(): void;
}

export const useSetupStore = create<SetupState>()((set) => ({
  suiteId: null,
  onDone: null,
  open(suiteId, onDone) {
    set({ suiteId, onDone: onDone ?? null });
  },
  close() {
    set({ suiteId: null, onDone: null });
  }
}));

export function runAfterSetup(pluginId: string, action: () => void): void {
  const suite = suiteForPlugin(pluginId);
  if (suite && needsSetup(suite, useCanvasStore.getState().suites[suite.manifest.id])) {
    useSetupStore.getState().open(suite.manifest.id, action);
    return;
  }
  action();
}
