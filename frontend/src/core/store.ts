import type { PluginManifest, SuiteSettings } from '@spot-canvas/sdk';
import { create } from 'zustand';
import { clampInt, GRID, MIN_GROUP, MIN_PANEL, pxSizeToUnits } from './grid';

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
  groupId?: string | null;
}

export const GROUP_COLORS = ['blue', 'amber', 'green', 'violet', 'slate'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface GroupState {
  gid: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: GroupColor;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Preferences {
  theme: ThemePreference;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system' };
const DEFAULT_GROUP_SIZE = { w: 10, h: 7 };
const MAX_GROUP_TITLE = 60;

export type DrawerTab = 'browse' | 'developer';

export interface SuiteState {
  url: string | null;
  settings: SuiteSettings;
  configured: boolean;
}

export type PanelPlacement = Partial<Pick<PanelState, 'x' | 'y' | 'w' | 'h' | 'data'>>;

interface CanvasState {
  panels: Record<string, PanelState>;
  suites: Record<string, SuiteState>;
  groups: Record<string, GroupState>;
  preferences: Preferences;
  gseq: number;
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
  addGroup(at?: Partial<Pick<GroupState, 'x' | 'y' | 'w' | 'h'>>, title?: string): string;
  removeGroup(gid: string, withPanels?: boolean): void;
  moveGroup(gid: string, x: number, y: number): void;
  resizeGroup(gid: string, w: number, h: number): void;
  renameGroup(gid: string, title: string): void;
  recolorGroup(gid: string, color: GroupColor): void;
  assignPanel(iid: string, gid: string | null): void;
  settlePanel(iid: string): void;
  setPreferences(patch: Partial<Preferences>): void;
  trackSuite(id: string, url: string | null): void;
  configureSuite(id: string, settings: SuiteSettings): void;
  hydrate(
    panels: PanelState[],
    suites?: Record<string, SuiteState>,
    groups?: GroupState[],
    preferences?: Partial<Preferences>
  ): void;
  setDrawer(open: boolean, tab?: DrawerTab): void;
}

const ORIGIN = { x: 1, y: 1 };
const STAGGER = 1;
const GROUP_TITLE_ROWS = 1;

/**
 * Members of a group flow inside it, left to right then down, in reading order.
 * Widgets wider than the group shrink to fit; a group grows taller to hold its content.
 */
export function reflowGroup(panels: Record<string, PanelState>, group: GroupState): { panels: Record<string, PanelState>; group: GroupState } {
  const members = Object.values(panels)
    .filter((p) => p.groupId === group.gid)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (members.length === 0) return { panels, group };
  const innerX = group.x;
  const innerY = group.y + GROUP_TITLE_ROWS;
  const innerW = group.w;
  let cursorX = innerX;
  let cursorY = innerY;
  let rowH = 0;
  const next = { ...panels };
  for (const m of members) {
    const w = Math.min(m.w, innerW);
    if (cursorX + w > innerX + innerW && cursorX > innerX) {
      cursorX = innerX;
      cursorY += rowH;
      rowH = 0;
    }
    const y = Math.min(cursorY, GRID.rows - m.h);
    if (m.x !== cursorX || m.y !== y || m.w !== w) next[m.iid] = { ...m, x: cursorX, y, w };
    cursorX += w;
    rowH = Math.max(rowH, m.h);
  }
  const needed = cursorY + rowH - group.y;
  const h = clampInt(Math.max(group.h, needed), MIN_GROUP.h, GRID.rows - group.y);
  return { panels: next, group: h === group.h ? group : { ...group, h } };
}

export const useCanvasStore = create<CanvasState>()((set, get) => {
  const reflow = (gid: string | null | undefined) => {
    if (!gid) return;
    const group = get().groups[gid];
    if (!group) return;
    const result = reflowGroup(get().panels, group);
    set({ panels: result.panels, groups: { ...get().groups, [gid]: result.group } });
  };

  return {
  panels: {},
  suites: {},
  groups: {},
  preferences: DEFAULT_PREFERENCES,
  gseq: 0,
  seq: 0,
  nextZ: 1,
  drawerOpen: false,
  drawerTab: 'browse',

  addPanel(manifest, at = {}) {
    const { seq, nextZ, panels } = get();
    const iid = `${manifest.id}#${seq + 1}`;
    const count = Object.keys(panels).length;
    const natural = pxSizeToUnits(manifest.size);
    const w = clampInt(at.w ?? natural.w, MIN_PANEL.w, GRID.cols);
    const h = clampInt(at.h ?? natural.h, MIN_PANEL.h, GRID.rows);
    const panel: PanelState = {
      iid,
      pluginId: manifest.id,
      x: clampInt(at.x ?? ORIGIN.x + count * STAGGER, 0, GRID.cols - w),
      y: clampInt(at.y ?? ORIGIN.y + count * STAGGER, 0, GRID.rows - h),
      w,
      h,
      z: nextZ,
      data: at.data ?? null
    };
    set({ panels: { ...panels, [iid]: panel }, seq: seq + 1, nextZ: nextZ + 1 });
    return iid;
  },

  removePanel(iid) {
    const { [iid]: removed, ...rest } = get().panels;
    set({ panels: rest });
    reflow(removed?.groupId);
  },

  movePanel(iid, x, y) {
    const panel = get().panels[iid];
    if (!panel) return;
    const nx = clampInt(x, 0, GRID.cols - panel.w);
    const ny = clampInt(y, 0, GRID.rows - panel.h);
    if (nx === panel.x && ny === panel.y) return;
    set({ panels: { ...get().panels, [iid]: { ...panel, x: nx, y: ny } } });
  },

  resizePanel(iid, w, h) {
    const panel = get().panels[iid];
    if (!panel) return;
    const nw = clampInt(w, MIN_PANEL.w, GRID.cols - panel.x);
    const nh = clampInt(h, MIN_PANEL.h, GRID.rows - panel.y);
    if (nw === panel.w && nh === panel.h) return;
    set({ panels: { ...get().panels, [iid]: { ...panel, w: nw, h: nh } } });
    reflow(panel.groupId);
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
    set({ panels: {}, groups: {} });
  },

  addGroup(at = {}, title) {
    const { gseq, groups } = get();
    const gid = `group#${gseq + 1}`;
    const count = Object.keys(groups).length;
    const w = clampInt(at.w ?? DEFAULT_GROUP_SIZE.w, MIN_GROUP.w, GRID.cols);
    const h = clampInt(at.h ?? DEFAULT_GROUP_SIZE.h, MIN_GROUP.h, GRID.rows);
    const group: GroupState = {
      gid,
      title: (title ?? `Group ${count + 1}`).slice(0, MAX_GROUP_TITLE),
      x: clampInt(at.x ?? ORIGIN.x + count * STAGGER, 0, GRID.cols - w),
      y: clampInt(at.y ?? ORIGIN.y + count * STAGGER, 0, GRID.rows - h),
      w,
      h,
      color: GROUP_COLORS[count % GROUP_COLORS.length] ?? 'blue'
    };
    set({ groups: { ...groups, [gid]: group }, gseq: gseq + 1 });
    return gid;
  },

  removeGroup(gid, withPanels = false) {
    const { [gid]: _removed, ...groups } = get().groups;
    const panels: Record<string, PanelState> = {};
    for (const panel of Object.values(get().panels)) {
      if (panel.groupId !== gid) panels[panel.iid] = panel;
      else if (!withPanels) panels[panel.iid] = { ...panel, groupId: null };
    }
    set({ groups, panels });
  },

  moveGroup(gid, x, y) {
    const group = get().groups[gid];
    if (!group) return;
    const nx = clampInt(x, 0, GRID.cols - group.w);
    const ny = clampInt(y, 0, GRID.rows - group.h);
    const dx = nx - group.x;
    const dy = ny - group.y;
    if (dx === 0 && dy === 0) return;
    const panels = { ...get().panels };
    for (const panel of Object.values(panels)) {
      if (panel.groupId === gid) {
        panels[panel.iid] = {
          ...panel,
          x: clampInt(panel.x + dx, 0, GRID.cols - panel.w),
          y: clampInt(panel.y + dy, 0, GRID.rows - panel.h)
        };
      }
    }
    set({ groups: { ...get().groups, [gid]: { ...group, x: nx, y: ny } }, panels });
  },

  resizeGroup(gid, w, h) {
    const group = get().groups[gid];
    if (!group) return;
    const nw = clampInt(w, MIN_GROUP.w, GRID.cols - group.x);
    const nh = clampInt(h, MIN_GROUP.h, GRID.rows - group.y);
    if (nw === group.w && nh === group.h) return;
    set({ groups: { ...get().groups, [gid]: { ...group, w: nw, h: nh } } });
    reflow(gid);
  },

  renameGroup(gid, title) {
    const group = get().groups[gid];
    if (!group) return;
    const clean = title.trim().slice(0, MAX_GROUP_TITLE);
    set({ groups: { ...get().groups, [gid]: { ...group, title: clean || group.title } } });
  },

  recolorGroup(gid, color) {
    const group = get().groups[gid];
    if (!group) return;
    set({ groups: { ...get().groups, [gid]: { ...group, color } } });
  },

  assignPanel(iid, gid) {
    const panel = get().panels[iid];
    if (!panel || (gid !== null && !get().groups[gid])) return;
    if (panel.groupId !== undefined && panel.groupId === gid) {
      reflow(gid);
      return;
    }
    const previous = panel.groupId;
    set({ panels: { ...get().panels, [iid]: { ...panel, groupId: gid } } });
    reflow(previous);
    reflow(gid);
  },

  settlePanel(iid) {
    const panel = get().panels[iid];
    if (!panel) return;
    const cx = panel.x + panel.w / 2;
    const cy = panel.y + panel.h / 2;
    const home = Object.values(get().groups).find((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h);
    get().assignPanel(iid, home?.gid ?? null);
  },

  setPreferences(patch) {
    set({ preferences: { ...get().preferences, ...patch } });
  },

  trackSuite(id, url) {
    const existing = get().suites[id];
    set({ suites: { ...get().suites, [id]: { url, settings: existing?.settings ?? {}, configured: existing?.configured ?? false } } });
  },

  configureSuite(id, settings) {
    const existing = get().suites[id];
    set({
      suites: {
        ...get().suites,
        [id]: { url: existing?.url ?? null, settings: { ...existing?.settings, ...settings }, configured: true }
      }
    });
  },

  hydrate(list, suites = {}, groupList = [], preferences = {}) {
    const panels: Record<string, PanelState> = {};
    const groups: Record<string, GroupState> = {};
    let seq = 0;
    let gseq = 0;
    let nextZ = 1;
    for (const g of groupList) {
      groups[g.gid] = g;
      const n = Number(g.gid.split('#')[1]);
      if (Number.isFinite(n)) gseq = Math.max(gseq, n);
    }
    for (const p of list) {
      panels[p.iid] = p.groupId && !groups[p.groupId] ? { ...p, groupId: null } : p;
      const n = Number(p.iid.split('#')[1]);
      if (Number.isFinite(n)) seq = Math.max(seq, n);
      nextZ = Math.max(nextZ, p.z + 1);
    }
    set({ panels, suites, groups, preferences: { ...DEFAULT_PREFERENCES, ...preferences }, seq, gseq, nextZ });
  },

  setDrawer(open, tab) {
    set({ drawerOpen: open, ...(tab ? { drawerTab: tab } : {}) });
  }
  };
});

export const selectOrderedPanels = (s: CanvasState): PanelState[] =>
  Object.values(s.panels).sort((a, b) => a.z - b.z);

export const selectInstalledIds = (s: CanvasState): Set<string> =>
  new Set(Object.values(s.panels).map((p) => p.pluginId));

export const selectOrderedGroups = (s: CanvasState): GroupState[] =>
  Object.values(s.groups).sort((a, b) => a.gid.localeCompare(b.gid, undefined, { numeric: true }));
