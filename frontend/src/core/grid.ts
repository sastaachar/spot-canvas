// The canvas is a grid of sectors. Panels and groups store integer sector
// coordinates and render as percentages, so a layout keeps its shape on any screen.
export const GRID = { cols: 24, rows: 16 } as const;

// Plugin manifests give a natural size in px; this reference canvas turns it into sectors.
const REFERENCE = { w: 1440, h: 900 } as const;

export const MIN_PANEL = { w: 3, h: 2 } as const;
export const MIN_GROUP = { w: 4, h: 3 } as const;

export const clampInt = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)));

export function pxSizeToUnits([w, h]: readonly [number, number]): { w: number; h: number } {
  return {
    w: clampInt(w / (REFERENCE.w / GRID.cols), MIN_PANEL.w, GRID.cols),
    h: clampInt(h / (REFERENCE.h / GRID.rows), MIN_PANEL.h, GRID.rows)
  };
}

/** Convert a legacy pixel layout coordinate to sectors. */
export const legacyPxToUnits = { x: (px: number) => px / (REFERENCE.w / GRID.cols), y: (px: number) => px / (REFERENCE.h / GRID.rows) };

export const pct = (units: number, total: number): string => `${(units / total) * 100}%`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectStyle = (r: Rect) => ({
  left: pct(r.x, GRID.cols),
  top: pct(r.y, GRID.rows),
  width: pct(r.w, GRID.cols),
  height: pct(r.h, GRID.rows)
});

/** Sector size in px for a canvas element (falls back to the reference when unmounted). */
export function cellSize(canvas: HTMLElement | null): { w: number; h: number } {
  const w = canvas && canvas.clientWidth > 0 ? canvas.clientWidth : REFERENCE.w;
  const h = canvas && canvas.clientHeight > 0 ? canvas.clientHeight : REFERENCE.h;
  return { w: w / GRID.cols, h: h / GRID.rows };
}

/** Client coordinates → sector coordinates inside the canvas. */
export function pointToUnits(clientX: number, clientY: number, canvas: HTMLElement | null): { x: number; y: number } {
  const rect = canvas?.getBoundingClientRect();
  const cell = cellSize(canvas);
  const px = rect ? clientX - rect.left : clientX;
  const py = rect ? clientY - rect.top : clientY;
  return { x: clampInt(px / cell.w, 0, GRID.cols - 1), y: clampInt(py / cell.h, 0, GRID.rows - 1) };
}
