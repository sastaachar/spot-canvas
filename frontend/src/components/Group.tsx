import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cellSize, rectStyle } from '../core/grid';
import { useMenuStore } from '../core/menu';
import { useCanvasStore, type GroupState } from '../core/store';
import { useUiStore } from '../core/ui';

interface Props {
  group: GroupState;
  members: number;
}

type DragMode = 'move' | 'resize';

export function Group({ group, members }: Props) {
  const renaming = useUiStore((s) => s.renamingGid === group.gid);
  const setRenaming = useUiStore((s) => s.setRenaming);
  const { moveGroup, resizeGroup, renameGroup } = useCanvasStore.getState();
  const [draft, setDraft] = useState(group.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(group.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming, group.title]);

  const commit = () => {
    renameGroup(group.gid, draft);
    setRenaming(null);
  };

  const startDrag = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || renaming) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('input')) return;
    e.preventDefault();
    const target = e.currentTarget;
    const canvas = target.closest('.canvas') as HTMLElement | null;
    const cell = cellSize(canvas);
    const start = { x: e.clientX, y: e.clientY, gx: group.x, gy: group.y, gw: group.w, gh: group.h };
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / cell.w;
      const dy = (ev.clientY - start.y) / cell.h;
      if (mode === 'move') moveGroup(group.gid, start.gx + dx, start.gy + dy);
      else resizeGroup(group.gid, start.gw + dx, start.gh + dy);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    useMenuStore.getState().openMenu({ kind: 'group', gid: group.gid }, e.clientX, e.clientY);
  };

  return (
    <section
      className={`group group--${group.color}`}
      aria-label={`Group ${group.title}`}
      style={rectStyle(group)}
      onContextMenu={onContextMenu}
    >
      <header className="group__head" onPointerDown={startDrag('move')} onDoubleClick={() => setRenaming(group.gid)}>
        {renaming ? (
          <input
            ref={inputRef}
            className="group__rename"
            aria-label="Group name"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <>
            <span className="group__title">{group.title}</span>
            <span className="group__count">{members === 1 ? '1 panel' : `${members} panels`}</span>
          </>
        )}
      </header>
      <div className="group__grip" aria-hidden="true" onPointerDown={startDrag('resize')} />
    </section>
  );
}
