# Spot Canvas

A personal ThoughtSpot homepage. Every user gets a blank canvas and arranges plugins on it; the layout is saved per user, so each person's homepage is their own.

```
frontend/           the homepage: Vite + React + Zustand, one canvas, right-click to add or remove plugins
frontend/sdk        plugin contract: manifest schema, PluginApi types, definePlugin()
frontend/plugins/*  first-party plugins (workflow, embed, note, timer), vanilla TS against the SDK
backend/            Node API: signs a user in, stores that user's layout (one JSON document per user)
```

## Run

```sh
pnpm install
cp backend/.env.example backend/.env   # dev tokens are pre-filled
pnpm dev                                # API on :8787, homepage on http://localhost:5173
pnpm test
pnpm typecheck
pnpm build
```

Sign in with one of the tokens from `DEV_USERS` in `backend/.env` (`dev-alice-token`, `dev-bob-token`). Each token is a different user with a different homepage. To sign real users in, set `THOUGHTSPOT_HOST` in `backend/.env`; a token presented at sign-in is then validated against that instance's `auth/session/user` endpoint.

## How it fits together

- The frontend never talks to ThoughtSpot for identity. It posts the token to the backend, which validates it and answers with an HttpOnly, SameSite=Strict session cookie.
- Every mutating request carries an `X-Requested-With` header; the backend rejects requests without it, and only accepts cross-origin calls from `FRONTEND_ORIGIN`.
- The layout is loaded on sign-in and saved (debounced) after every change. The backend validates the document shape and stores it under a hash of the user id, never the raw id.
- Sign-in attempts and overall traffic are rate limited per address. All responses are `no-store`.

### API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | liveness |
| `POST /api/session` `{ token }` | none | validate the token, start a session |
| `DELETE /api/session` | cookie | end the session |
| `GET /api/me` | cookie | current user |
| `GET /api/layout` | cookie | this user's layout, `204` when none |
| `PUT /api/layout` | cookie | replace this user's layout |

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
    b.textContent = `Clicked ${s.n}×`;
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
| `api.host.kind` | | `"web"` (the `"desktop"` value is reserved) |
| `api.storage.get()` / `.set(v)` | `storage` | per-panel JSON, saved with the layout |
| `api.events.emit(name, payload)` / `.on(name, fn)` | `events` | canvas-wide bus; handlers that throw are contained |
| `api.net.fetch(url, init)` | `network` | http and https only |
| `api.ui.resize(w, h)` / `.close()` | | own panel only |
| `api.ui.style(css)` | | injected once, scoped to the panel's shadow root |
| `api.ui.setTitle(text)` | | overrides the panel header, `null` restores |
| `api.ui.notify(msg, kind?)` | | toast; `info`, `success` or `error` |
| `api.theme.get()` / `.onChange(fn)` | | `"light"` or `"dark"` |
| `api.onUnmount(fn)` | | cleanup hook, also called on close |

Each panel mounts inside its own shadow root, so plugin CSS cannot leak out and app CSS cannot leak in. Design tokens (`--bg`, `--ink`, `--accent`, `--border`, `--muted`, `--surface`) inherit through the boundary, and the `.tb-btn` / `.tb-btn--primary` classes are available inside every panel.

Load a plugin you are developing from the canvas menu: right-click, "Load plugin from URL…", and point it at an `https://` ES module.
