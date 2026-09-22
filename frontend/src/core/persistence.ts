import { z } from 'zod';
import { clampInt, GRID, legacyPxToUnits, MIN_GROUP, MIN_PANEL } from './grid';
import { usePluginRegistry } from './registry';
import {
  DEFAULT_PREFERENCES,
  GROUP_COLORS,
  useCanvasStore,
  type GroupState,
  type PanelState,
  type Preferences,
  type SuiteState
} from './store';
import { useToastStore } from './toasts';

const WRITE_DEBOUNCE_MS = 300;
const SAVE_FAILED = 'Your homepage could not be saved. Changes stay on screen until it reconnects.';
const SYSTEM = 'spot-canvas';

const PanelSchema = z.object({
  iid: z.string(),
  pluginId: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  z: z.number(),
  data: z.unknown(),
  title: z.string().nullable().optional(),
  groupId: z.string().nullable().optional()
});

const GroupSchema = z.object({
  gid: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  color: z.enum(GROUP_COLORS)
});

const PreferencesSchema = z.object({ theme: z.enum(['system', 'light', 'dark']) }).partial();

const SuiteStateSchema = z.object({
  url: z.string().nullable(),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  configured: z.boolean()
});

export const LAYOUT_VERSION = 2;

const LayoutSchema = z.object({
  version: z.union([z.literal(1), z.literal(LAYOUT_VERSION)]),
  panels: z.array(PanelSchema),
  suites: z.record(z.string(), SuiteStateSchema).optional(),
  groups: z.array(GroupSchema).optional(),
  preferences: PreferencesSchema.optional()
});

export interface LayoutDocument {
  panels: PanelState[];
  suites: Record<string, SuiteState>;
  groups: GroupState[];
  preferences: Preferences;
}

export interface LayoutBackend {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

// Version 1 stored pixels on a fixed canvas; version 2 stores grid sectors.
function toGridPanel(p: PanelState): PanelState {
  const w = clampInt(legacyPxToUnits.x(p.w), MIN_PANEL.w, GRID.cols);
  const h = clampInt(legacyPxToUnits.y(p.h), MIN_PANEL.h, GRID.rows);
  return { ...p, w, h, x: clampInt(legacyPxToUnits.x(p.x), 0, GRID.cols - w), y: clampInt(legacyPxToUnits.y(p.y), 0, GRID.rows - h) };
}

function toGridGroup(g: GroupState): GroupState {
  const w = clampInt(legacyPxToUnits.x(g.w), MIN_GROUP.w, GRID.cols);
  const h = clampInt(legacyPxToUnits.y(g.h), MIN_GROUP.h, GRID.rows);
  return { ...g, w, h, x: clampInt(legacyPxToUnits.x(g.x), 0, GRID.cols - w), y: clampInt(legacyPxToUnits.y(g.y), 0, GRID.rows - h) };
}

export function parseLayoutDocument(json: string | null): LayoutDocument | null {
  if (!json) return null;
  try {
    const result = LayoutSchema.safeParse(JSON.parse(json));
    if (!result.success) return null;
    const legacy = result.data.version === 1;
    return {
      panels: (result.data.panels as PanelState[]).map((p) => (legacy ? toGridPanel(p) : p)),
      suites: result.data.suites ?? {},
      groups: (result.data.groups ?? []).map((g) => (legacy ? toGridGroup(g) : g)),
      preferences: { ...DEFAULT_PREFERENCES, ...result.data.preferences }
    };
  } catch {
    return null;
  }
}

export function parseLayout(json: string | null): PanelState[] | null {
  return parseLayoutDocument(json)?.panels ?? null;
}

export function serializeLayout(
  panels: Record<string, PanelState>,
  suites: Record<string, SuiteState> = {},
  groups: Record<string, GroupState> = {},
  preferences: Preferences = DEFAULT_PREFERENCES
): string {
  return JSON.stringify({ version: LAYOUT_VERSION, panels: Object.values(panels), suites, groups: Object.values(groups), preferences });
}

async function loadSuiteModules(suites: Record<string, SuiteState>): Promise<void> {
  const { loadFromUrl, suites: loaded } = usePluginRegistry.getState();
  await Promise.all(
    Object.entries(suites)
      .filter(([id, state]) => state.url !== null && !loaded[id])
      .map(async ([id, state]) => {
        try {
          await loadFromUrl(state.url as string);
        } catch (error) {
          console.warn(`[spot-canvas] suite ${id} could not be loaded`, error);
          useToastStore.getState().push(`Suite ${id} could not be loaded from its URL.`, 'error', SYSTEM);
        }
      })
  );
}

export async function restoreLayout(backend: LayoutBackend): Promise<boolean> {
  let stored: string | null;
  try {
    stored = await backend.read();
  } catch (error) {
    console.warn('[spot-canvas] layout load failed', error);
    useToastStore.getState().push('Your saved homepage could not be loaded.', 'error', SYSTEM);
    return false;
  }
  const doc = parseLayoutDocument(stored);
  if (!doc) return false;
  await loadSuiteModules(doc.suites);
  useCanvasStore.getState().hydrate(doc.panels, doc.suites, doc.groups, doc.preferences);
  return true;
}

export function attachPersistence(backend: LayoutBackend): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useCanvasStore.subscribe((state, prev) => {
    if (
      state.panels === prev.panels &&
      state.suites === prev.suites &&
      state.groups === prev.groups &&
      state.preferences === prev.preferences
    ) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const { panels, suites, groups, preferences } = useCanvasStore.getState();
      backend.write(serializeLayout(panels, suites, groups, preferences)).catch((error: unknown) => {
        console.warn('[spot-canvas] layout save failed', error);
        useToastStore.getState().push(SAVE_FAILED, 'error', SYSTEM);
      });
    }, WRITE_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

const isLayoutDocument = (value: unknown): value is LayoutDocument =>
  typeof value === 'object' && value !== null && Array.isArray((value as LayoutDocument).panels) && Array.isArray((value as LayoutDocument).groups) && !('version' in value);

export async function applyLayoutDocument(doc: unknown): Promise<boolean> {
  const parsed = isLayoutDocument(doc) ? doc : parseLayoutDocument(typeof doc === 'string' ? doc : JSON.stringify(doc));
  if (!parsed) return false;
  await loadSuiteModules(parsed.suites);
  useCanvasStore.getState().hydrate(parsed.panels, parsed.suites, parsed.groups, parsed.preferences);
  return true;
}
