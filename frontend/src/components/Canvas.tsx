import type { MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMenuStore } from '../core/menu';
import { selectOrderedPanels, useCanvasStore } from '../core/store';
import { Panel } from './Panel';

export function Canvas() {
  const panels = useCanvasStore(useShallow(selectOrderedPanels));
  const openMenu = useMenuStore((s) => s.openMenu);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openMenu({ kind: 'canvas' }, e.clientX, e.clientY);
  };

  return (
    <main className="canvas" id="canvas" onContextMenu={onContextMenu}>
      {panels.length === 0 && (
        <div className="canvas__empty">
          <div>
            <strong>Your homepage is empty</strong>
            Right-click anywhere to add a plugin. Drag panels by their header.
          </div>
        </div>
      )}
      {panels.map((panel) => (
        <Panel key={panel.iid} panel={panel} />
      ))}
    </main>
  );
}
