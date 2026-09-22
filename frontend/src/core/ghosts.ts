import { create } from 'zustand';
import type { LayoutDocument } from './persistence';
import { useCanvasStore } from './store';

export interface Ghost {
  id: string;
  kind: 'panel' | 'group';
  x: number;
  y: number;
  w: number;
  h: number;
}

// Timing of the "drawing" outline shown before the agent's additions appear.
export const GHOST_DRAW_MS = 650;
export const GHOST_STAGGER_MS = 120;
export const GHOST_HOLD_MS = 150;

interface GhostState {
  ghosts: Ghost[];
  show(ghosts: Ghost[]): void;
  clear(): void;
}

export const useGhostStore = create<GhostState>()((set) => ({
  ghosts: [],
  show(ghosts) {
    set({ ghosts });
  },
  clear() {
    set({ ghosts: [] });
  }
}));

/** Rectangles for everything in `next` that the canvas does not have yet: groups first, then panels. */
export function newRects(next: LayoutDocument): Ghost[] {
  const { panels, groups } = useCanvasStore.getState();
  return [
    ...next.groups.filter((g) => !groups[g.gid]).map<Ghost>((g) => ({ id: g.gid, kind: 'group', x: g.x, y: g.y, w: g.w, h: g.h })),
    ...next.panels.filter((p) => !panels[p.iid]).map<Ghost>((p) => ({ id: p.iid, kind: 'panel', x: p.x, y: p.y, w: p.w, h: p.h }))
  ];
}

export function ghostDuration(count: number): number {
  return count === 0 ? 0 : GHOST_DRAW_MS + GHOST_STAGGER_MS * (count - 1) + GHOST_HOLD_MS;
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
