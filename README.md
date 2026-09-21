# Spot Canvas

A blank canvas. Nothing on it until you add a plugin. One codebase, running in the browser and as a desktop app.

```
packages/sdk        plugin contract: manifest schema, PluginApi types, definePlugin()
plugins/*           first-party plugins (workflow, embed, note, timer), vanilla TS against the SDK
apps/web            the product: Vite + React + Zustand
apps/desktop        Electron shell around apps/web; adds a layout file in userData
```

## Run

```sh
pnpm install
pnpm dev            # web at http://localhost:5173
pnpm desktop        # electron, pointed at the dev server (run pnpm dev first)
pnpm test
pnpm typecheck
pnpm build
```

## Plugin contract

```ts
import { definePlugin } from '@spot-canvas/sdk';

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
    const s = api.storage.get<{ n: number }>() ?? { n: 0 };
    const b = document.createElement('button');
    b.textContent = `Clicked ${s.n}× on ${api.host.kind}`;
    b.onclick = () => { s.n++; api.storage.set(s); b.textContent = `Clicked ${s.n}×`; };
    host.append(b);
    return () => {};      // optional cleanup
  }
});
```

The core never special-cases a plugin kind. It mounts panels on the canvas and hands each one a narrow API. A permission a plugin did not declare throws when used.

A plugin gets two things: its host element and `api`. Everything else goes through API calls. Plugins must not touch `document`, `window.fetch`, `localStorage` or other panels directly; the API is the whole contract, and it is versioned.

### API v1

| Call | Needs | Notes |
|---|---|---|
| `api.host.kind` | | `"desktop"` or `"web"` |
| `api.storage.get()` / `.set(v)` | `storage` | per-panel JSON, survives reloads |
| `api.events.emit(name, payload)` / `.on(name, fn)` | `events` | canvas-wide bus; handlers that throw are contained |
| `api.net.fetch(url, init)` | `network` | http and https only |
| `api.ui.resize(w, h)` / `.close()` | | own panel only |
| `api.ui.style(css)` | | injected once, scoped to the panel's shadow root |
| `api.ui.setTitle(text)` | | overrides the panel header, `null` restores |
| `api.ui.notify(msg, kind?)` | | toast; `info`, `success` or `error` |
| `api.theme.get()` / `.onChange(fn)` | | `"light"` or `"dark"` |
| `api.onUnmount(fn)` | | cleanup hook, also called on close |

Each panel mounts inside its own shadow root, so plugin CSS cannot leak out and app CSS cannot leak in. Design tokens (`--bg`, `--ink`, `--accent`, `--border`, `--muted`, `--surface`) inherit through the boundary, and the `.tb-btn` / `.tb-btn--primary` classes are available inside every panel.
