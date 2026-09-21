import { useShallow } from 'zustand/react/shallow';
import { selectOrderedPanels, useCanvasStore } from '../core/store';
import { Panel } from './Panel';

export function Canvas() {
  const panels = useCanvasStore(useShallow(selectOrderedPanels));

  return (
    <main className="canvas" id="canvas">
      {panels.length === 0 && (
        <div className="canvas__empty">
          <div>
            <strong>Blank canvas</strong>
            Press <kbd>+</kbd> in the rail to add a plugin. Drag panels by their header.
          </div>
        </div>
      )}
      {panels.map((panel) => (
        <Panel key={panel.iid} panel={panel} />
      ))}
    </main>
  );
}
