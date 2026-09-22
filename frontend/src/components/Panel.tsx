import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePanelCommands } from '../core/commands';
import { cellSize, rectStyle } from '../core/grid';
import { createPluginApi, EventBus } from '../core/host';
import { useMenuStore } from '../core/menu';
import { getPlugin } from '../core/registry';
import { useCanvasStore, type PanelState } from '../core/store';
import { useUiStore } from '../core/ui';
import { settingsForPlugin } from '../core/suites';
import { currentTheme, onThemeChange } from '../core/theme';
import { useToastStore } from '../core/toasts';
import pluginBaseCss from '../styles/plugin-base.css?inline';


const bus = new EventBus((iid, phase, error) => {
  console.warn(`[spot-canvas] plugin ${iid} threw in ${phase}`, error);
});

// Sits above any stored panel.z (which grows modestly via nextZ) so the active
// widget is never hidden behind its neighbours while selected or dragged.
const ACTIVE_Z = 100000;

interface Props {
  panel: PanelState;
  /** 1-based stacking position (1 = back) and total, for the depth badge. */
  depth: number;
  depthTotal: number;
}

type DragMode = 'move' | 'resize';

function mountRoot(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  const base = document.createElement('style');
  base.textContent = pluginBaseCss;
  root.append(base);
  return root;
}

export function Panel({ panel, depth, depthTotal }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const selected = useUiStore((s) => s.selectedIid === panel.iid);
  const renaming = useUiStore((s) => s.renamingIid === panel.iid);
  const moving = useUiStore((s) => s.movingIid === panel.iid);
  const editMode = useUiStore((s) => s.editMode);
  // Edit mode makes every widget draggable and shows its depth badge; outside it, a
  // single widget can still be moved via the "Move" menu action (movingIid).
  const canDrag = editMode || moving;
  const [draft, setDraft] = useState(panel.title ?? '');
  const renameRef = useRef<HTMLInputElement>(null);
  const plugin = getPlugin(panel.pluginId);
  const { movePanel, resizePanel, focusPanel, raisePanel, lowerPanel } = useCanvasStore.getState();

  useEffect(() => {
    const body = bodyRef.current;
    if (!plugin || !body) return;
    const store = useCanvasStore.getState();
    const root = mountRoot(body);
    const host = document.createElement('div');
    host.className = 'plugin-host';
    host.style.height = '100%';
    root.append(host);

    const handle = createPluginApi(panel.iid, plugin.manifest, {
      hostKind: 'web',
      bus,
      styleRoot: root,
      getData: (iid) => store.panels[iid]?.data ?? null,
      setData: store.setPanelData,
      resize: store.resizePanel,
      close: store.removePanel,
      setTitle: store.setPanelTitle,
      setCommands: usePanelCommands.getState().setCommands,
      openMenu: (iid, x, y) => useMenuStore.getState().openMenu({ kind: 'panel', iid }, x, y),
      notify: useToastStore.getState().push,
      theme: currentTheme,
      onThemeChange,
      getSettings: () => settingsForPlugin(panel.pluginId)
    });
    let unmount: (() => void) | void;
    try {
      unmount = plugin.mount(host, handle.api);
    } catch (error) {
      console.warn(`[spot-canvas] plugin ${panel.iid} failed to mount`, error);
      setFailed(true);
    }
    return () => {
      if (typeof unmount === 'function') {
        try {
          unmount();
        } catch {
          // the panel is going away regardless
        }
      }
      handle.dispose();
      usePanelCommands.getState().clearCommands(panel.iid);
      root.replaceChildren();
    };
  }, [panel.iid, plugin]);

  useEffect(() => {
    if (renaming) {
      setDraft(panel.title ?? plugin?.manifest.name ?? '');
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming, panel.title, plugin]);

  const commitRename = () => {
    useCanvasStore.getState().setPanelTitle(panel.iid, draft.trim() || null);
    useUiStore.getState().setRenamingPanel(null);
  };

  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().setMoving(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moving]);

  // Widgets are locked in place. "Move" from the menu unlocks one drag or resize, then it locks again.
  const startDrag = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || renaming || !canDrag) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    focusPanel(panel.iid);
    const target = e.currentTarget;
    const canvas = target.closest('.canvas') as HTMLElement | null;
    const cell = cellSize(canvas);
    const start = { x: e.clientX, y: e.clientY, px: panel.x, py: panel.y, pw: panel.w, ph: panel.h };
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / cell.w;
      const dy = (ev.clientY - start.y) / cell.h;
      if (mode === 'move') movePanel(panel.iid, start.px + dx, start.py + dy);
      else resizePanel(panel.iid, start.pw + dx, start.ph + dy);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (mode === 'move') useCanvasStore.getState().settlePanel(panel.iid);
      useUiStore.getState().setMoving(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const name = panel.title ?? plugin?.manifest.name ?? panel.pluginId;

  const openPanelMenu = (x: number, y: number) => {
    focusPanel(panel.iid);
    useUiStore.getState().select(panel.iid);
    useMenuStore.getState().openMenu({ kind: 'panel', iid: panel.iid }, x, y);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    openPanelMenu(e.clientX, e.clientY);
  };

  return (
    <section
      className={`panel${panel.groupId ? ' is-grouped' : ''}${selected ? ' is-selected' : ''}${moving ? ' is-moving' : ''}${editMode ? ' is-editing' : ''}`}
      aria-label={name}
      aria-selected={selected}
      // While a widget is selected or dragged it floats above everything (temporary,
      // reverts to its stored z the moment the interaction stops).
      style={{ ...rectStyle(panel), zIndex: moving ? ACTIVE_Z + 1 : selected ? ACTIVE_Z : panel.z }}
      onPointerDown={() => {
        focusPanel(panel.iid);
        useUiStore.getState().select(panel.iid);
      }}
      onContextMenu={onContextMenu}
    >
      {(panel.title || renaming) && (
        <header className="panel__head" onPointerDown={startDrag('move')} onDoubleClick={() => useUiStore.getState().setRenamingPanel(panel.iid)}>
          {renaming ? (
            <input
              ref={renameRef}
              className="panel__rename"
              aria-label="Widget name"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') useUiStore.getState().setRenamingPanel(null);
              }}
            />
          ) : (
            <span className="panel__name">{panel.title}</span>
          )}
        </header>
      )}
      {editMode && depthTotal > 1 && (
        <div className="panel__depth" aria-label={`Depth ${depth} of ${depthTotal}`}>
          <button
            type="button"
            className="panel__depth-btn"
            aria-label="Send backward"
            title="Send backward"
            disabled={depth <= 1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => lowerPanel(panel.iid)}
          >
            ▾
          </button>
          <span className="panel__depth-num" title="Stacking order (1 = back)">
            {depth}
          </span>
          <button
            type="button"
            className="panel__depth-btn"
            aria-label="Bring forward"
            title="Bring forward"
            disabled={depth >= depthTotal}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => raisePanel(panel.iid)}
          >
            ▴
          </button>
        </div>
      )}
      {canDrag && <div className="panel__mover" aria-label="Drag to move" onPointerDown={startDrag('move')} />}
      <div className="panel__body" ref={bodyRef} hidden={failed || !plugin} />
      {(failed || !plugin) && (
        <p className="panel__error">
          {plugin ? 'This plugin failed to start. Remove it and add it again.' : 'This plugin is no longer installed.'}
        </p>
      )}
      {canDrag && <div className="panel__grip" aria-hidden="true" onPointerDown={startDrag('resize')} />}
    </section>
  );
}
