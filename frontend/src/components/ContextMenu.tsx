import { useEffect, useLayoutEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMenuStore, type MenuTarget } from '../core/menu';
import { getPlugin, usePluginRegistry } from '../core/registry';
import { useSession } from '../core/session';
import { useCanvasStore } from '../core/store';

interface Item {
  label: string;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
}

type Entry = Item | 'separator';

const VIEWPORT_MARGIN = 8;

function canvasPoint(x: number, y: number): { x: number; y: number } {
  const rect = document.getElementById('canvas')?.getBoundingClientRect();
  return rect ? { x: x - rect.left, y: y - rect.top } : { x, y };
}

export function ContextMenu() {
  const { open, x, y, target } = useMenuStore(useShallow((s) => ({ open: s.open, x: s.x, y: s.y, target: s.target })));
  const closeMenu = useMenuStore((s) => s.closeMenu);
  const plugins = usePluginRegistry(useShallow((s) => Object.values(s.plugins)));
  const hasPanels = useCanvasStore((s) => Object.keys(s.panels).length > 0);
  const panel = useCanvasStore((s) => (target.kind === 'panel' ? s.panels[target.iid] : undefined));
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', closeMenu);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', closeMenu);
    };
  }, [open, closeMenu]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN))}px`;
    el.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN))}px`;
  }, [open, x, y, target]);

  if (!open) return null;

  const entries = target.kind === 'canvas' ? canvasEntries(x, y) : panelEntries(target);

  function canvasEntries(clientX: number, clientY: number): Entry[] {
    const { addPanel, clearPanels, setDrawer } = useCanvasStore.getState();
    const at = canvasPoint(clientX, clientY);
    return [
      ...plugins.map<Entry>((p) => ({ label: `Add ${p.manifest.name}`, onSelect: () => addPanel(p.manifest, at) })),
      'separator',
      { label: 'Load plugin from URL…', onSelect: () => setDrawer(true, 'developer') },
      { label: 'Clear homepage', danger: true, disabled: !hasPanels, onSelect: clearPanels },
      'separator',
      { label: user ? `Sign out ${user.displayName}` : 'Sign out', onSelect: () => void signOut() }
    ];
  }

  function panelEntries(t: Extract<MenuTarget, { kind: 'panel' }>): Entry[] {
    const { removePanel, focusPanel } = useCanvasStore.getState();
    const name = panel?.title ?? getPlugin(panel?.pluginId ?? '')?.manifest.name ?? t.iid;
    return [
      { label: 'Bring to front', onSelect: () => focusPanel(t.iid) },
      'separator',
      { label: `Remove ${name}`, danger: true, onSelect: () => removePanel(t.iid) }
    ];
  }

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: x, top: y }}>
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <hr key={`sep-${i}`} className="menu__sep" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={`menu__item${entry.danger ? ' is-danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              closeMenu();
              entry.onSelect();
            }}
          >
            {entry.label}
          </button>
        )
      )}
    </div>
  );
}
