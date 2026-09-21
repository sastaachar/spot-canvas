import { z } from 'zod';
import { useCanvasStore, type PanelState } from './store';

const STORAGE_KEY = 'spot-canvas.layout.v1';
const WRITE_DEBOUNCE_MS = 300;

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

export const localStorageBackend: LayoutBackend = {
  async read() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  async write(json) {
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // storage may be unavailable (private mode, quota); the canvas still works in memory
    }
  }
};

export function pickBackend(): LayoutBackend {
  return window.spotCanvasHost?.layout ?? localStorageBackend;
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

export async function restoreLayout(backend: LayoutBackend = pickBackend()): Promise<boolean> {
  const panels = parseLayout(await backend.read());
  if (!panels) return false;
  useCanvasStore.getState().hydrate(panels);
  return true;
}

export function attachPersistence(backend: LayoutBackend = pickBackend()): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useCanvasStore.subscribe((state, prev) => {
    if (state.panels === prev.panels) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void backend.write(serializeLayout(useCanvasStore.getState().panels));
    }, WRITE_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
