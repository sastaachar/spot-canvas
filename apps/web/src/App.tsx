import { useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { PluginDrawer } from './components/PluginDrawer';
import { Rail } from './components/Rail';
import { Toasts } from './components/Toasts';
import { useCanvasStore } from './core/store';

export function App() {
  const drawerOpen = useCanvasStore((s) => s.drawerOpen);
  const setDrawer = useCanvasStore((s) => s.setDrawer);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerOpen) setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawer]);

  return (
    <div className="app">
      <Rail />
      <PluginDrawer />
      <Canvas />
      <Toasts />
    </div>
  );
}
