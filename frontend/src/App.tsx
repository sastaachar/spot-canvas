import { useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { ContextMenu } from './components/ContextMenu';
import { PluginDrawer } from './components/PluginDrawer';
import { SignIn } from './components/SignIn';
import { Toasts } from './components/Toasts';
import { remoteLayoutBackend } from './core/api';
import { attachPersistence, restoreLayout } from './core/persistence';
import { useSession } from './core/session';
import { useCanvasStore } from './core/store';

export function App() {
  const status = useSession((s) => s.status);
  const bootstrap = useSession((s) => s.bootstrap);
  const drawerOpen = useCanvasStore((s) => s.drawerOpen);
  const setDrawer = useCanvasStore((s) => s.setDrawer);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (status !== 'signed-in') return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    void restoreLayout(remoteLayoutBackend).then(() => {
      if (cancelled) return;
      detach = attachPersistence(remoteLayoutBackend);
      setReady(true);
    });
    return () => {
      cancelled = true;
      detach?.();
      useCanvasStore.getState().hydrate([]);
      useCanvasStore.getState().setDrawer(false);
      setReady(false);
    };
  }, [status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerOpen) setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawer]);

  if (status === 'loading') return null;
  if (status === 'anonymous') return <SignIn />;
  if (!ready) return null;

  return (
    <div className="app">
      <PluginDrawer />
      <Canvas />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
