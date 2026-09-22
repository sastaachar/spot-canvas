import type { MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMenuStore } from '../core/menu';
import { selectOrderedGroups, selectOrderedPanels, useCanvasStore } from '../core/store';
import { Group } from './Group';
import { Panel } from './Panel';

export function Canvas() {
  const panels = useCanvasStore(useShallow(selectOrderedPanels));
  const groups = useCanvasStore(useShallow(selectOrderedGroups));
  const openMenu = useMenuStore((s) => s.openMenu);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openMenu({ kind: 'canvas' }, e.clientX, e.clientY);
  };

  const openAddMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({ kind: 'canvas' }, rect.left, rect.bottom + 8);
  };

  const members = (gid: string) => panels.filter((p) => p.groupId === gid).length;

  return (
    <main className="canvas" id="canvas" onContextMenu={onContextMenu}>
      {panels.length === 0 && groups.length === 0 && (
        <div className="canvas__empty">
          <div className="canvas__empty-badge" aria-hidden="true">
            ＋
          </div>
          <h1>Your homepage is empty</h1>
          <p>Add panels — notes, workflows, ThoughtSpot charts, links — and arrange them your way.</p>
          <div className="canvas__empty-actions">
            <button type="button" className="tb-btn tb-btn--primary canvas__empty-cta" onClick={openAddMenu}>
              Add a panel
            </button>
          </div>
          <p className="canvas__empty-hint">or right-click anywhere on the canvas</p>
        </div>
      )}
      {groups.map((group) => (
        <Group key={group.gid} group={group} members={members(group.gid)} />
      ))}
      {panels.map((panel) => (
        <Panel key={panel.iid} panel={panel} />
      ))}
    </main>
  );
}
