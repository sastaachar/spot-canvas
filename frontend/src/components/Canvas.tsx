import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMenuStore } from '../core/menu';
import { selectOrderedGroups, selectOrderedPanels, useCanvasStore } from '../core/store';
import { useChatStore } from '../core/chat';
import { useSession } from '../core/session';
import { useUiStore } from '../core/ui';
import { Ghosts } from './Ghosts';
import { Group } from './Group';
import { Panel } from './Panel';

export function Canvas() {
  const panels = useCanvasStore(useShallow(selectOrderedPanels));
  const groups = useCanvasStore(useShallow(selectOrderedGroups));
  const openMenu = useMenuStore((s) => s.openMenu);
  const cluster = useSession((s) => s.user?.cluster ?? null);
  const chatPending = useChatStore((s) => s.pending);
  const buildFromActivity = () =>
    void useChatStore.getState().send('Build my homepage from what I used most on ThoughtSpot in the last 3 months.');

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openMenu({ kind: 'canvas' }, e.clientX, e.clientY);
  };

  const openAddMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({ kind: 'canvas' }, rect.left, rect.bottom + 8);
  };

  const members = (gid: string) => panels.filter((p) => p.groupId === gid).length;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.canvas__empty')) useUiStore.getState().select(null);
  };

  return (
    <main className="canvas" id="canvas" onContextMenu={onContextMenu} onPointerDown={onPointerDown}>
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
            {cluster && (
              <button type="button" className="tb-btn canvas__empty-cta" disabled={chatPending} onClick={buildFromActivity}>
                {chatPending ? 'Spotter is building…' : 'Build from my ThoughtSpot activity'}
              </button>
            )}
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
      <Ghosts />
    </main>
  );
}
