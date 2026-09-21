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

  const members = (gid: string) => panels.filter((p) => p.groupId === gid).length;

  return (
    <main className="canvas" id="canvas" onContextMenu={onContextMenu}>
      {panels.length === 0 && groups.length === 0 && (
        <div className="canvas__empty">
          <h1>Your homepage is empty</h1>
          <p>Right-click anywhere to add a note, a workflow, a data embed or links. Group related panels with a rectangle.</p>
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
