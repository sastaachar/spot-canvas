import type { SpotCanvasPlugin, SpotCanvasSuite } from '@spot-canvas/sdk';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMenuStore, type MenuTarget } from '../core/menu';
import { getPlugin, suiteForPlugin, usePluginRegistry } from '../core/registry';
import { useSession } from '../core/session';
import { useCanvasStore } from '../core/store';
import { hasSetup, needsSetup, runAfterSetup, useSetupStore } from '../core/suites';

interface Action {
  kind: 'action';
  label: string;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

interface Submenu {
  kind: 'submenu';
  label: string;
  items: Entry[];
}

interface Heading {
  kind: 'heading';
  label: string;
}

type Entry = Action | Submenu | Heading | 'separator';

const VIEWPORT_MARGIN = 8;

function canvasPoint(x: number, y: number): { x: number; y: number } {
  const rect = document.getElementById('canvas')?.getBoundingClientRect();
  return rect ? { x: x - rect.left, y: y - rect.top } : { x, y };
}

function clampInto(el: HTMLElement, x: number, y: number): void {
  const rect = el.getBoundingClientRect();
  el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN))}px`;
  el.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN))}px`;
}

export function ContextMenu() {
  const { open, x, y, target } = useMenuStore(useShallow((s) => ({ open: s.open, x: s.x, y: s.y, target: s.target })));
  const closeMenu = useMenuStore((s) => s.closeMenu);
  const plugins = usePluginRegistry(useShallow((s) => Object.values(s.plugins)));
  const suites = usePluginRegistry(useShallow((s) => Object.values(s.suites)));
  const suiteOf = usePluginRegistry((s) => s.suiteOf);
  const suiteStates = useCanvasStore((s) => s.suites);
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
    if (open && ref.current) clampInto(ref.current, x, y);
  }, [open, x, y, target]);

  if (!open) return null;

  const addEntry = (plugin: SpotCanvasPlugin, at: { x: number; y: number }): Action => ({
    kind: 'action',
    label: plugin.manifest.name,
    hint: plugin.manifest.kind,
    onSelect: () => runAfterSetup(plugin.manifest.id, () => useCanvasStore.getState().addPanel(plugin.manifest, at))
  });

  const setupEntry = (suite: SpotCanvasSuite): Action => {
    const configured = !needsSetup(suite, suiteStates[suite.manifest.id]);
    return {
      kind: 'action',
      label: `${suite.manifest.name} settings…`,
      hint: configured ? 'configured' : 'needs setup',
      onSelect: () => useSetupStore.getState().open(suite.manifest.id)
    };
  };

  function addMenu(at: { x: number; y: number }): Entry[] {
    const standalone = plugins.filter((p) => !suiteOf[p.manifest.id]);
    const entries: Entry[] = standalone.map((p) => addEntry(p, at));
    for (const suite of suites) {
      if (entries.length > 0) entries.push('separator');
      entries.push({ kind: 'heading', label: suite.manifest.name });
      for (const plugin of suite.plugins) entries.push(addEntry(plugin, at));
    }
    return entries;
  }

  function canvasEntries(): Entry[] {
    const { clearPanels, setDrawer } = useCanvasStore.getState();
    const at = canvasPoint(x, y);
    const configurable = suites.filter(hasSetup);
    return [
      { kind: 'submenu', label: 'Add plugin', items: addMenu(at) },
      ...(configurable.length > 0 ? [{ kind: 'submenu', label: 'Suites', items: configurable.map(setupEntry) } as Submenu] : []),
      { kind: 'action', label: 'Load plugin from URL…', onSelect: () => setDrawer(true, 'developer') },
      'separator',
      { kind: 'action', label: 'Clear homepage', danger: true, disabled: !hasPanels, onSelect: clearPanels },
      'separator',
      { kind: 'action', label: user ? `Sign out ${user.displayName}` : 'Sign out', onSelect: () => void signOut() }
    ];
  }

  function panelEntries(t: Extract<MenuTarget, { kind: 'panel' }>): Entry[] {
    const { removePanel, focusPanel } = useCanvasStore.getState();
    const plugin = panel ? getPlugin(panel.pluginId) : undefined;
    const suite = panel ? suiteForPlugin(panel.pluginId) : undefined;
    const name = panel?.title ?? plugin?.manifest.name ?? t.iid;
    return [
      { kind: 'action', label: 'Bring to front', onSelect: () => focusPanel(t.iid) },
      ...(suite && hasSetup(suite) ? [setupEntry(suite)] : []),
      'separator',
      { kind: 'action', label: `Remove ${name}`, danger: true, onSelect: () => removePanel(t.iid) }
    ];
  }

  const entries = target.kind === 'canvas' ? canvasEntries() : panelEntries(target);

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: x, top: y }}>
      <MenuList entries={entries} onClose={closeMenu} />
    </div>
  );
}

interface ListProps {
  entries: Entry[];
  onClose(): void;
}

function MenuList({ entries, onClose }: ListProps) {
  const [openSub, setOpenSub] = useState<string | null>(null);

  return (
    <div className="menu__list">
      {entries.map((entry, i) => {
        if (entry === 'separator') return <hr key={`sep-${i}`} className="menu__sep" />;
        if (entry.kind === 'heading') {
          return (
            <div key={`h-${entry.label}`} className="menu__heading" role="presentation">
              {entry.label}
            </div>
          );
        }
        if (entry.kind === 'submenu') {
          const isOpen = openSub === entry.label;
          return (
            <div
              key={entry.label}
              className={`menu__sub${isOpen ? ' is-open' : ''}`}
              onPointerEnter={() => setOpenSub(entry.label)}
              onPointerLeave={() => setOpenSub((current) => (current === entry.label ? null : current))}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className="menu__item"
                onClick={() => setOpenSub(isOpen ? null : entry.label)}
              >
                <span>{entry.label}</span>
                <span className="menu__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="menu menu--flyout" role="menu" aria-label={entry.label}>
                  {entry.items.length > 0 ? (
                    <MenuList entries={entry.items} onClose={onClose} />
                  ) : (
                    <div className="menu__heading">Nothing available</div>
                  )}
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={`menu__item${entry.danger ? ' is-danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span>{entry.label}</span>
            {entry.hint && <span className="menu__hint">{entry.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
