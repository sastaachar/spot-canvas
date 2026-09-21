# Spot Canvas

A personal ThoughtSpot homepage. Every user gets a blank canvas and arranges plugins on it; the layout is saved per user, so each person's homepage is their own.

```
frontend/           the homepage: Vite + React + Zustand, one canvas, right-click to add or remove plugins
frontend/sdk        plugin contract: manifest schema, PluginApi types, definePlugin()
frontend/plugins/*  first-party plugins (thoughtspot-chart, embed, note, workflow, links, timer), vanilla TS against the SDK
backend/            Node API: signs a user in, stores that user's layout (one JSON document per user)
```

`frontend/plugins/thoughtspot-chart` renders a saved ThoughtSpot Answer's chart with
ThoughtSpot's own chart engine from a single API call — no ThoughtSpot app in the
page. It needs the chart bundle under `frontend/public/valkyrie/` and the dev
proxy credentials described in [its README](frontend/plugins/thoughtspot-chart/README.md).

## Run

```sh
pnpm install
cp backend/.env.example backend/.env   # dev tokens are pre-filled
pnpm dev                                # API on :8787, homepage on http://localhost:5173
pnpm test
pnpm typecheck
pnpm build
```

With `DEV_DEFAULT_USER=alice` in `backend/.env` there is no sign-in step: the homepage opens as Alice. Remove that line to get the token sign-in screen instead; the tokens in `DEV_USERS` (`dev-alice-token`, `dev-bob-token`) are separate users with separate homepages. To sign real users in, set `THOUGHTSPOT_HOST` in `backend/.env`; a token presented at sign-in is then validated against that instance's `auth/session/user` endpoint.

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

## The page

- **Canvas.** Flat ThoughtSpot-blue surface. Panels are plugins; drag by the header, resize from the corner.
- **Groups.** Right-click → *New group here* draws a tinted rectangle with a title. Drop a panel inside and it joins the group; drag the group and its panels move with it. Rename by double-clicking the title; colour, ungroup or remove from the group's menu.
- **Profile** (avatar, top right). Who you are, light / dark / system theme (saved with your layout), every suite with its setup state, every plugin and how many are on the page, sign out.
- **Chat bar** (bottom). Talks to Spotter. The agent that edits the page is the next piece; today it acknowledges the message.

### Right-click menu

Everything on the homepage is driven from the context menu; there is no toolbar.

- **Canvas:** *Add plugin ▸* (standalone plugins first, then one group per suite; the panel lands where you clicked), *New group here*, *Suites ▸* (each suite's settings, marked `configured` or `needs setup`), *Load plugin from URL…*, *Clear homepage*, *Profile & appearance…*.
- **Panel header:** *Bring to front*, *Group ▸* (when groups exist), the owning suite's *settings…*, *Remove*.
- **Group title:** *Rename*, *Colour ▸*, *Ungroup* (keeps panels), *Remove group and its panels*.
- Right-clicking inside a plugin's body keeps the browser's own menu, so copy and paste still work.

## Suites

A suite publishes several plugins as one module and declares what it needs from the person adding it. Those details are collected once per user and stored with their layout; every plugin in the suite reads them through `api.settings.get()`.

```ts
import { defineSuite } from '@spot-canvas/sdk';
import liveboard from './liveboard';
import answer from './answer';

export default defineSuite({
  manifest: {
    apiVersion: 1,
    id: 'thoughtspot.suite',
    name: 'ThoughtSpot',
    version: '0.1.0',
    description: 'Liveboards, answers and Spotter from your cluster',
    settings: [
      { key: 'host',  label: 'Cluster URL', type: 'url',    required: true },
      { key: 'token', label: 'Token',       type: 'secret', required: true }
    ]
  },
  plugins: [liveboard, answer],
  // Optional. When present the suite owns the setup step: render a login here and
  // call api.complete({ host, token }) when done, or api.cancel().
  setup(host, api) {
    const button = document.createElement('button');
    button.textContent = 'Log in to ThoughtSpot';
    button.onclick = async () => api.complete(await loginSomehow());
    host.append(button);
  }
});
```

Field types: `text`, `url`, `secret`, `number`, `boolean`, `select` (with `options`). Without `setup`, Spot Canvas renders a form from `settings`. With `setup`, the suite draws its own step and `api.complete()` is checked against the `required` fields before it is accepted.

The first time someone adds a plugin from a suite that still needs setup, the setup dialog opens and the panel is added once it completes. Settings can be changed later from *Suites ▸* or a panel's menu. A suite loaded from a URL is remembered and reloaded from that URL the next time the homepage opens.

Suite settings, including `secret` fields, are stored server-side in the user's layout document and sent to that user's browser; they are never shared between users.
