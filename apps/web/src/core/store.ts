import type { PluginManifest } from '@spot-canvas/sdk';
import { MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH } from '@spot-canvas/sdk';
import { create } from 'zustand';

export interface PanelState {
  iid: string;
  pluginId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  data: unknown;
  title?: string | null;
}

export type DrawerTab = 'browse' | 'developer';

export type PanelPlacement = Partial<Pick<PanelState, 'x' | 'y' | 'w' | 'h' | 'data'>>;

interface CanvasState {
  panels: Record<string, PanelState>;
  seq: number;
  nextZ: number;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  addPanel(manifest: PluginManifest, at?: PanelPlacement): string;
  removePanel(iid: string): void;
  movePanel(iid: string, x: number, y: number): void;
  resizePanel(iid: string, w: number, h: number): void;
  focusPanel(iid: string): void;
  setPanelData(iid: string, data: unknown): void;
  setPanelTitle(iid: string, title: string | null): void;
  clearPanels(): void;
  hydrate(panels: PanelState[]): void;
  setDrawer(open: boolean, tab?: DrawerTab): void;
}

const ORIGIN = { x: 70, y: 40 };
const STAGGER = 28;

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  panels: {},
  seq: 0,
  nextZ: 1,
  drawerOpen: false,
  drawerTab: 'browse',

  addPanel(manifest, at = {}) {
    const { seq, nextZ, panels } = get();
    const iid = `${manifest.id}#${seq + 1}`;
    const count = Object.keys(panels).length;
    const panel: PanelState = {
      iid,
      pluginId: manifest.id,
      x: at.x ?? ORIGIN.x + count * STAGGER,
      y: at.y ?? ORIGIN.y + count * STAGGER,
      w: at.w ?? manifest.size[0],
      h: at.h ?? manifest.size[1],
      z: nextZ,
      data: at.data ?? null
    };
    set({ panels: { ...panels, [iid]: panel }, seq: seq + 1, nextZ: nextZ + 1 });
    return iid;
  },

  removePanel(iid) {
    const { [iid]: _removed, ...rest } = get().panels;
    set({ panels: rest });
  },

  movePanel(iid, x, y) {
    const panel = get().panels[iid];
    if (!panel) return;
    set({ panels: { ...get().panels, [iid]: { ...panel, x: Math.max(0, x), y: Math.max(0, y) } } });
  },

  resizePanel(iid, w, h) {
    const panel = get().panels[iid];
    if (!panel) return;
    set({
      panels: {
        ...get().panels,
        [iid]: { ...panel, w: Math.max(MIN_PANEL_WIDTH, w), h: Math.max(MIN_PANEL_HEIGHT, h) }
      }
    });
  },

  focusPanel(iid) {
    const { panels, nextZ } = get();
    const panel = panels[iid];
    if (!panel || panel.z === nextZ - 1) return;
    set({ panels: { ...panels, [iid]: { ...panel, z: nextZ } }, nextZ: nextZ + 1 });
  },

  setPanelData(iid, data) {
    const panel = get().panels[iid];
    if (!panel) return;
    set({ panels: { ...get().panels, [iid]: { ...panel, data } } });
  },

  setPanelTitle(iid, title) {
    const panel = get().panels[iid];
    if (!panel) return;
    set({ panels: { ...get().panels, [iid]: { ...panel, title } } });
  },

  clearPanels() {
    set({ panels: {} });
  },

  hydrate(list) {
    const panels: Record<string, PanelState> = {};
    let seq = 0;
    let nextZ = 1;
    for (const p of list) {
      panels[p.iid] = p;
      const n = Number(p.iid.split('#')[1]);
      if (Number.isFinite(n)) seq = Math.max(seq, n);
      nextZ = Math.max(nextZ, p.z + 1);
    }
    set({ panels, seq, nextZ });
  },

  setDrawer(open, tab) {
    set({ drawerOpen: open, ...(tab ? { drawerTab: tab } : {}) });
  }
}));

export const selectOrderedPanels = (s: CanvasState): PanelState[] =>
  Object.values(s.panels).sort((a, b) => a.z - b.z);

export const selectInstalledIds = (s: CanvasState): Set<string> =>
  new Set(Object.values(s.panels).map((p) => p.pluginId));
