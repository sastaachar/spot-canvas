import type { PluginCommand } from '@spot-canvas/sdk';
import { create } from 'zustand';

// Plugin-contributed right-click commands, keyed by panel iid. Commands hold live
// callbacks, so they live here and never in the persisted panel state.
interface CommandState {
  byPanel: Record<string, PluginCommand[]>;
  setCommands(iid: string, commands: PluginCommand[]): void;
  clearCommands(iid: string): void;
}

export const usePanelCommands = create<CommandState>()((set) => ({
  byPanel: {},
  setCommands(iid, commands) {
    set((s) => ({ byPanel: { ...s.byPanel, [iid]: commands } }));
  },
  clearCommands(iid) {
    set((s) => {
      if (!(iid in s.byPanel)) return s;
      const byPanel = { ...s.byPanel };
      delete byPanel[iid];
      return { byPanel };
    });
  }
}));
