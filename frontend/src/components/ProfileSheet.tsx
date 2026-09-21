import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePluginRegistry } from '../core/registry';
import { useSession } from '../core/session';
import { useCanvasStore, type ThemePreference } from '../core/store';
import { hasSetup, needsSetup, useSetupStore } from '../core/suites';
import { useUiStore } from '../core/ui';

const THEMES: Array<{ id: ThemePreference; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function ProfileButton() {
  const user = useSession((s) => s.user);
  const open = useUiStore((s) => s.profileOpen);
  const setOpen = useUiStore((s) => s.setProfileOpen);
  if (!user) return null;
  return (
    <button
      type="button"
      className="avatar"
      aria-label="Profile"
      aria-expanded={open}
      title={user.displayName}
      onClick={() => setOpen(!open)}
    >
      {initials(user.displayName)}
    </button>
  );
}

export function ProfileSheet() {
  const open = useUiStore((s) => s.profileOpen);
  const setOpen = useUiStore((s) => s.setProfileOpen);
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const theme = useCanvasStore((s) => s.preferences.theme);
  const setPreferences = useCanvasStore((s) => s.setPreferences);
  const suiteStates = useCanvasStore((s) => s.suites);
  const panels = useCanvasStore((s) => s.panels);
  const plugins = usePluginRegistry(useShallow((s) => Object.values(s.plugins)));
  const suites = usePluginRegistry(useShallow((s) => Object.values(s.suites)));
  const suiteOf = usePluginRegistry((s) => s.suiteOf);
  const openSetup = useSetupStore((s) => s.open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || !user) return null;

  const inUse = (pluginId: string) => Object.values(panels).filter((p) => p.pluginId === pluginId).length;
  const standalone = plugins.filter((p) => !suiteOf[p.manifest.id]);

  return (
    <div className="sheet-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Profile">
        <header className="sheet__head">
          <span className="avatar avatar--static" aria-hidden="true">
            {initials(user.displayName)}
          </span>
          <div className="sheet__who">
            <strong>{user.displayName}</strong>
            <span>{user.cluster ? `${user.name} · ${user.cluster}` : user.name}</span>
          </div>
          <button type="button" className="sheet__close" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </header>

        <section className="sheet__section">
          <h2>Appearance</h2>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                onClick={() => setPreferences({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet__section">
          <h2>Suites</h2>
          {suites.length === 0 ? (
            <p className="sheet__empty">No suites yet. Load one from the canvas menu.</p>
          ) : (
            <ul className="sheet__list">
              {suites.map((suite) => {
                const state = suiteStates[suite.manifest.id];
                const pending = needsSetup(suite, state);
                return (
                  <li key={suite.manifest.id}>
                    <div className="sheet__row">
                      <div>
                        <strong>{suite.manifest.name}</strong>
                        <span className="sheet__meta">
                          {suite.plugins.length} plugins · v{suite.manifest.version}
                          {hasSetup(suite) && ` · ${pending ? 'needs setup' : 'configured'}`}
                        </span>
                      </div>
                      {hasSetup(suite) && (
                        <button type="button" className="tb-btn" onClick={() => openSetup(suite.manifest.id)}>
                          {pending ? 'Set up' : 'Settings'}
                        </button>
                      )}
                    </div>
                    <ul className="sheet__sublist">
                      {suite.plugins.map((p) => (
                        <li key={p.manifest.id}>
                          <span>{p.manifest.name}</span>
                          <span className="sheet__meta">{inUse(p.manifest.id) > 0 ? `${inUse(p.manifest.id)} on page` : p.manifest.kind}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sheet__section">
          <h2>Plugins</h2>
          <ul className="sheet__list sheet__list--plain">
            {standalone.map((p) => (
              <li key={p.manifest.id} className="sheet__row">
                <span>{p.manifest.name}</span>
                <span className="sheet__meta">{inUse(p.manifest.id) > 0 ? `${inUse(p.manifest.id)} on page` : p.manifest.kind}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="sheet__foot">
          <button type="button" className="tb-btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </footer>
      </aside>
    </div>
  );
}
