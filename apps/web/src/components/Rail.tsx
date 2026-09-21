import { useCanvasStore } from '../core/store';

const icon = {
  add: <path d="M12 5v14M5 12h14" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
};

export function Rail() {
  const drawerOpen = useCanvasStore((s) => s.drawerOpen);
  const setDrawer = useCanvasStore((s) => s.setDrawer);
  const clearPanels = useCanvasStore((s) => s.clearPanels);
  const hasPanels = useCanvasStore((s) => Object.keys(s.panels).length > 0);

  return (
    <nav className="rail" aria-label="Spot Canvas">
      <button
        type="button"
        aria-pressed={drawerOpen}
        aria-label="Add plugin"
        title="Add plugin"
        onClick={() => setDrawer(!drawerOpen, 'browse')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">{icon.add}</svg>
      </button>
      <button
        type="button"
        aria-label="Developer"
        title="Developer"
        onClick={() => setDrawer(true, 'developer')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">{icon.grid}</svg>
      </button>
      <span className="rail__spacer" />
      <button
        type="button"
        aria-label="Clear canvas"
        title="Clear canvas"
        disabled={!hasPanels}
        onClick={clearPanels}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">{icon.trash}</svg>
      </button>
    </nav>
  );
}
