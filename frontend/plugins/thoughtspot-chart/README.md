# ThoughtSpot chart plugin

Renders a saved ThoughtSpot Answer's chart with ThoughtSpot's own hosted chart
engine (valkyrie) — no ThoughtSpot app, no login page, no `visual-embed-sdk`.
Type an Answer ID, press Load.

## How it works

1. One API call — `POST /metadata/answer/hosted-chart-model` (prism field
   `getAnswerHostedChartModel`) — returns only what the chart needs: `chart_type`,
   the Chart SDK `chart_model` (columns, chart config, visual props) and the rows
   as SDK `QueryData`.
2. The plugin loads the built chart bundle for that type in a **same-origin
   iframe** (`/valkyrie/src/exports/<type>/index.html`) and speaks the Chart SDK
   protocol over postMessage: `InitStart → Initialize → GetDataQuery →
   ChartModelUpdate → InitializeComplete`, answering `GetLDFlags`,
   `GetLabelTranslation` and `resolveAssetUrl` on the way (`src/bridge.ts` is a
   30-line stand-in for `promise-postmessage`).
3. Rows are projected onto whatever columns the chart asks for
   (`projectRows`); Measure Names/Values are derived by the chart itself.

Header actions: **Load** (fetch + render), **Refresh** (refetch the same answer),
**Edit in ThoughtSpot ↗** (opens `<cluster>/#/insights/saved-answer/<id>` in a new tab) and
**⚙** (override the cluster URL). The cluster comes from the customer's
configuration, in this order: the ⚙ override, `GET /thoughtspot/config`
(`{ tsHost }` — the dev server serves the `TS_HOST` its credentials belong to),
or the API endpoint's origin when the endpoint is the cluster itself.

Panel storage keeps `{ answerId, endpoint, bundleBase, tsHost }`. Defaults:
`endpoint` `/prism` (dev proxy), `bundleBase` `/valkyrie/`, `tsHost` empty.
Point `endpoint` at
`https://<cluster>/api/rest/2.0/metadata/answer/hosted-chart-model` once that
build is deployed — the plugin switches to the REST body automatically.

## Setup (local)

```sh
# 1. chart bundle (once): build valkyrie-charts in the ThoughtSpot repo and copy it
cd <scaligent>/js/ts-packages/valkyrie-charts && pnpm run bundle
cp -R dist <spot-canvas>/frontend/public/valkyrie        # gitignored, ~20 MB

# 2. prism with the hosted-chart-model field (branch feat/answer-svg-export)
cd <scaligent>/prism && pnpm run build
CLUSTER_IP=<cluster-ip> USE_HTTPS=true CALLOSUM_PORT=8443 ACCEPT_SELF_SIGNED_CERT=true \
  PORT=4124 ALTERNATE_PRISM_PORT=9100 node build/app/app

# 3. cluster credentials for the dev proxy (viz-embed style .dev.vars)
TS_DEV_VARS=/path/to/.dev.vars pnpm dev                 # TS_HOST + TS_USERNAME + TS_SECRET_KEY, or TS_TOKEN
```

`frontend/vite.config.ts` proxies `/prism` to `PRISM_URL` (default
`http://localhost:4124`) and adds a bearer token minted from those credentials,
so no token ever reaches the browser.

## Files

| File | Role |
|---|---|
| `src/index.ts` | the plugin: form, iframe, SDK handshake |
| `src/chart-source.ts` | pure: request/response shapes, rows keyed by column, query projection |
| `src/bridge.ts` | postMessage + MessageChannel request/response |
| `src/app-config.json` | ThoughtSpot's default hosted-chart `AppConfig` (palette, date formats) |
| `src/translations.json` | chart UI labels |

Known gap: the plugin listens for `message` events on `window` to talk to its
iframe — the SDK has no API for that yet.
