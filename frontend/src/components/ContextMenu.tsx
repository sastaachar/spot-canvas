import type { SpotCanvasPlugin, SpotCanvasSuite } from '@spot-canvas/sdk';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePanelCommands } from '../core/commands';
import { pointToUnits } from '../core/grid';
import { useMenuStore, type MenuTarget } from '../core/menu';
import { getPlugin, suiteForPlugin, usePluginRegistry } from '../core/registry';
import { GROUP_COLORS, useCanvasStore, type GroupColor } from '../core/store';
import { hasSetup, needsSetup, runAfterSetup, useSetupStore } from '../core/suites';
import { useUiStore } from '../core/ui';

interface Action {
  kind: 'action';
  label: string;
  onSelect(): void;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  checked?: boolean;
}

interface Submenu {
  kind: 'submenu';
  label: string;
  icon?: string;
  items: Entry[];
}

interface Heading {
  kind: 'heading';
  label: string;
}

type Entry = Action | Submenu | Heading | 'separator';

const VIEWPORT_MARGIN = 8;
const COLOR_LABEL: Record<GroupColor, string> = { blue: 'Blue', amber: 'Amber', green: 'Green', violet: 'Violet', slate: 'Slate' };

const canvasPoint = (x: number, y: number) => pointToUnits(x, y, document.getElementById('canvas'));

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
  const groups = useCanvasStore((s) => s.groups);
  const hasContent = useCanvasStore((s) => Object.keys(s.panels).length > 0 || Object.keys(s.groups).length > 0);
  const panel = useCanvasStore((s) => (target.kind === 'panel' ? s.panels[target.iid] : undefined));
  const pluginCommands = usePanelCommands((s) => (target.kind === 'panel' ? s.byPanel[target.iid] : undefined));
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
    icon: '＋',
    hint: plugin.manifest.kind,
    onSelect: () =>
      runAfterSetup(plugin.manifest.id, () => {
        const store = useCanvasStore.getState();
        store.settlePanel(store.addPanel(plugin.manifest, at));
      })
  });

  const setupEntry = (suite: SpotCanvasSuite): Action => {
    const configured = !needsSetup(suite, suiteStates[suite.manifest.id]);
    return {
      kind: 'action',
      label: `${suite.manifest.name} settings…`,
      icon: '⚙',
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
    const { clearPanels, setDrawer, addGroup } = useCanvasStore.getState();
    const at = canvasPoint(x, y);
    const configurable = suites.filter(hasSetup);
    return [
      { kind: 'submenu', label: 'Add plugin', icon: '＋', items: addMenu(at) },
      {
        kind: 'action',
        label: 'New group here',
        icon: '▧',
        onSelect: () => {
          const gid = addGroup(at);
          useUiStore.getState().setRenaming(gid);
        }
      },
      ...(configurable.length > 0
        ? [{ kind: 'submenu', label: 'Suites', icon: '◱', items: configurable.map(setupEntry) } as Submenu]
        : []),
      { kind: 'action', label: 'Load plugin from URL…', icon: '⚓', onSelect: () => setDrawer(true, 'developer') },
      'separator',
      { kind: 'action', label: 'Clear homepage', icon: '⌫', danger: true, disabled: !hasContent, onSelect: clearPanels },
      'separator',
      { kind: 'action', label: 'Profile & appearance…', icon: '☺', onSelect: () => useUiStore.getState().setProfileOpen(true) }
    ];
  }

  function panelEntries(t: Extract<MenuTarget, { kind: 'panel' }>): Entry[] {
    const { removePanel, focusPanel, assignPanel, raisePanel, lowerPanel } = useCanvasStore.getState();
    const plugin = panel ? getPlugin(panel.pluginId) : undefined;
    const suite = panel ? suiteForPlugin(panel.pluginId) : undefined;
    const name = panel?.title ?? plugin?.manifest.name ?? t.iid;
    const groupItems: Entry[] = [
      { kind: 'action', label: 'No group', checked: !panel?.groupId, onSelect: () => assignPanel(t.iid, null) },
      ...Object.values(groups).map<Entry>((g) => ({
        kind: 'action',
        label: g.title,
        checked: panel?.groupId === g.gid,
        onSelect: () => assignPanel(t.iid, g.gid)
      }))
    ];
    // Plugin-contributed actions come first — this is the whole menu for a chromeless widget.
    const commandEntries: Entry[] = (pluginCommands ?? []).map<Entry>((c) => ({
      kind: 'action',
      label: c.label,
      icon: c.icon,
      danger: c.danger,
      disabled: c.disabled,
      onSelect: c.onSelect
    }));
    return [
      { kind: 'action', label: 'Edit', icon: '✎', hint: 'name', onSelect: () => useUiStore.getState().setRenamingPanel(t.iid) },
      { kind: 'action', label: 'Move', icon: '✥', hint: 'drag, then it locks', onSelect: () => useUiStore.getState().setMoving(t.iid) },
      ...(commandEntries.length > 0 ? [...commandEntries] : []),
      'separator',
      { kind: 'action', label: 'Bring forward', icon: '▴', onSelect: () => raisePanel(t.iid) },
      { kind: 'action', label: 'Send backward', icon: '▾', onSelect: () => lowerPanel(t.iid) },
      { kind: 'action', label: 'Bring to front', icon: '⤒', onSelect: () => focusPanel(t.iid) },
      ...(Object.keys(groups).length > 0 ? [{ kind: 'submenu', label: 'Group', icon: '▧', items: groupItems } as Submenu] : []),
      ...(suite && hasSetup(suite) ? [setupEntry(suite)] : []),
      'separator',
      { kind: 'action', label: `Remove ${name}`, icon: '⌫', danger: true, onSelect: () => removePanel(t.iid) }
    ];
  }

  function groupEntries(t: Extract<MenuTarget, { kind: 'group' }>): Entry[] {
    const { removeGroup, recolorGroup } = useCanvasStore.getState();
    const group = groups[t.gid];
    const members = Object.values(useCanvasStore.getState().panels).filter((p) => p.groupId === t.gid).length;
    return [
      { kind: 'action', label: 'Rename', icon: '✎', onSelect: () => useUiStore.getState().setRenaming(t.gid) },
      {
        kind: 'submenu',
        label: 'Colour',
        icon: '◑',
        items: GROUP_COLORS.map<Entry>((c) => ({
          kind: 'action',
          label: COLOR_LABEL[c],
          checked: group?.color === c,
          onSelect: () => recolorGroup(t.gid, c)
        }))
      },
      'separator',
      { kind: 'action', label: 'Ungroup', icon: '⤢', hint: members > 0 ? 'keeps panels' : undefined, onSelect: () => removeGroup(t.gid, false) },
      {
        kind: 'action',
        label: members > 0 ? `Remove group and ${members === 1 ? 'its panel' : `${members} panels`}` : 'Remove group',
        icon: '⌫',
        danger: true,
        onSelect: () => removeGroup(t.gid, true)
      }
    ];
  }

  const entries = target.kind === 'canvas' ? canvasEntries() : target.kind === 'panel' ? panelEntries(target) : groupEntries(target);

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
                <span className="menu__icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <span className="menu__label">{entry.label}</span>
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
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.checked}
            className={`menu__item${entry.danger ? ' is-danger' : ''}${entry.checked ? ' is-checked' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span className="menu__icon" aria-hidden="true">
              {entry.icon}
            </span>
            <span className="menu__label">{entry.label}</span>
            {entry.hint && <span className="menu__hint">{entry.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
