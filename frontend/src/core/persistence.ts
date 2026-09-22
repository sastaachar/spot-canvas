import { z } from 'zod';
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

const LayoutSchema = z.object({
  version: z.literal(1),
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

export function parseLayoutDocument(json: string | null): LayoutDocument | null {
  if (!json) return null;
  try {
    const result = LayoutSchema.safeParse(JSON.parse(json));
    if (!result.success) return null;
    return {
      panels: result.data.panels as PanelState[],
      suites: result.data.suites ?? {},
      groups: result.data.groups ?? [],
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
  return JSON.stringify({ version: 1, panels: Object.values(panels), suites, groups: Object.values(groups), preferences });
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
