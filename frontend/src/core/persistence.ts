import { z } from 'zod';
import { useCanvasStore, type PanelState } from './store';
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
  title: z.string().nullable().optional()
});

const LayoutSchema = z.object({ version: z.literal(1), panels: z.array(PanelSchema) });

export interface LayoutBackend {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

export function parseLayout(json: string | null): PanelState[] | null {
  if (!json) return null;
  try {
    const result = LayoutSchema.safeParse(JSON.parse(json));
    return result.success ? (result.data.panels as PanelState[]) : null;
  } catch {
    return null;
  }
}

export function serializeLayout(panels: Record<string, PanelState>): string {
  return JSON.stringify({ version: 1, panels: Object.values(panels) });
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
  const panels = parseLayout(stored);
  if (!panels) return false;
  useCanvasStore.getState().hydrate(panels);
  return true;
}

export function attachPersistence(backend: LayoutBackend): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useCanvasStore.subscribe((state, prev) => {
    if (state.panels === prev.panels) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      backend.write(serializeLayout(useCanvasStore.getState().panels)).catch((error: unknown) => {
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
