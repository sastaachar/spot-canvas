import { useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isSpotCanvasSuite } from '@spot-canvas/sdk';
import { KIND_BLURB, PluginLoadError, usePluginRegistry } from '../core/registry';
import { selectInstalledIds, useCanvasStore, type DrawerTab } from '../core/store';

const CONTRACT = `import { definePlugin } from '@spot-canvas/sdk';

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'acme.hello',
    name: 'Hello',
    kind: 'widget',          // workflow | embed | widget
    version: '0.1.0',
    size: [240, 160],
    permissions: ['storage'] // storage | events | network
  },
  mount(host, api) {
    const s = api.storage.get() ?? { n: 0 };
    const b = document.createElement('button');
    b.textContent = \`Clicked \${s.n}× on \${api.host.kind}\`;
    b.onclick = () => { s.n++; api.storage.set(s); };
    host.append(b);
    return () => {};       // optional cleanup
  }
});

// api v1 handed to mount() — everything else is off limits
api.host.kind          "desktop" | "web"
api.storage.get/set    per-panel JSON            needs "storage"
api.events.emit/on     canvas-wide bus           needs "events"
api.net.fetch          http(s) only              needs "network"
api.ui.resize/close    own panel only
api.ui.style(css)      scoped to your panel
api.ui.setTitle(text)  panel header
api.ui.notify(msg)     toast, kind info|success|error
api.theme.get/onChange "light" | "dark"
api.settings.get()     the suite's settings (empty for a standalone plugin)
api.onUnmount(fn)      cleanup hook

// a suite bundles plugins and says what it needs from the person adding it
export default defineSuite({
  manifest: {
    apiVersion: 1, id: 'acme.suite', name: 'Acme', version: '0.1.0',
    settings: [{ key: 'host', label: 'Server URL', type: 'url', required: true }]
  },
  plugins: [helloPlugin],
  setup(host, api) {           // optional: own the setup step, e.g. a login
    // ... api.complete({ host, token }) or api.cancel()
  }
});`;

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'browse', label: 'Browse' },
  { id: 'developer', label: 'Developer' }
];

export function PluginDrawer() {
  const open = useCanvasStore((s) => s.drawerOpen);
  const tab = useCanvasStore((s) => s.drawerTab);
  const setDrawer = useCanvasStore((s) => s.setDrawer);

  return (
    <aside className={`drawer${open ? ' is-open' : ''}`} aria-label="Plugins" aria-hidden={!open}>
      <div className="drawer__head">
        <h2>Plugins</h2>
        <button type="button" aria-label="Close" onClick={() => setDrawer(false)}>
          ✕
        </button>
      </div>
      <div className="drawer__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setDrawer(true, t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="drawer__body">{tab === 'browse' ? <BrowseTab /> : <DeveloperTab />}</div>
    </aside>
  );
}

function BrowseTab() {
  const plugins = usePluginRegistry(useShallow((s) => Object.values(s.plugins)));
  const installed = useCanvasStore(useShallow(selectInstalledIds));
  const addPanel = useCanvasStore((s) => s.addPanel);

  return (
    <ul className="plugs">
      {plugins.map(({ manifest: m }) => {
        const has = installed.has(m.id);
        return (
          <li key={m.id} className={`plug${has ? ' is-installed' : ''}`}>
            <div className="plug__name">{m.name}</div>
            <button type="button" className="plug__add" onClick={() => addPanel(m)}>
              {has ? 'Add another' : 'Add'}
            </button>
            <div className="plug__desc">{KIND_BLURB[m.kind]}</div>
            <div className="plug__meta">
              {m.id} · {m.kind} · v{m.version}
              {m.permissions.length > 0 && ` · ${m.permissions.join(', ')}`}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DeveloperTab() {
  const loadFromUrl = usePluginRegistry((s) => s.loadFromUrl);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const loaded = await loadFromUrl(url);
      if (isSpotCanvasSuite(loaded)) {
        useCanvasStore.getState().trackSuite(loaded.manifest.id, url);
        setStatus({
          ok: true,
          text: `Loaded suite ${loaded.manifest.name} (${loaded.plugins.length} plugins). Right-click the canvas to add them.`
        });
      } else {
        setStatus({ ok: true, text: `Loaded ${loaded.manifest.name}. It is now in Browse and the right-click menu.` });
      }
      setUrl('');
    } catch (err) {
      setStatus({ ok: false, text: err instanceof PluginLoadError ? err.message : 'The plugin could not be loaded.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dev">
      <form className="dev__load" onSubmit={submit}>
        <label htmlFor="plugin-url">Load a plugin module</label>
        <div>
          <input
            id="plugin-url"
            type="url"
            placeholder="https://example.com/my-plugin.js"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button type="submit" className="tb-btn tb-btn--primary" disabled={busy}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
        {status && (
          <p className={`dev__status${status.ok ? '' : ' is-error'}`} role="status">
            {status.text}
          </p>
        )}
      </form>
      <p className="dev__note">A plugin is one ES module with a default export of this shape. The core only calls mount() and hands over the API.</p>
      <pre className="code">{CONTRACT}</pre>
    </div>
  );
}
