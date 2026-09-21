import { definePlugin, h } from '@spot-canvas/sdk';
import appConfigDefaults from './app-config.json';
import translations from './translations.json';
import { listen, request, SKIP } from './bridge';
import {
  buildRequest,
  bundleFolder,
  editUrl,
  fetchDiscoveredTsHost,
  parsePayload,
  projectRows,
  resolveTsHost,
  toChartSource,
  type ChartSource
} from './chart-source';

/**
 * Renders a saved ThoughtSpot Answer's chart with ThoughtSpot's own hosted chart
 * engine (valkyrie), without loading the ThoughtSpot app: one API call for the
 * chart model + rows, then the Chart SDK handshake over postMessage with the chart
 * bundle running in a same-origin iframe.
 */

interface State {
  answerId: string;
  /** hosted-chart-model API; `/prism` is the web app's dev proxy to prism (adds the cluster token). */
  endpoint: string;
  /** where the built valkyrie-charts bundle is served from. */
  bundleBase: string;
  /** ThoughtSpot URL for "Edit in ThoughtSpot"; derived from a cluster endpoint when empty. */
  tsHost: string;
}

const DEFAULTS: State = { answerId: '', endpoint: '/prism', bundleBase: '/valkyrie/', tsHost: '' };

/** Chart features the bundle reads from its own URL. */
const CHART_FLAGS = [
  'muzeChartPhase1Enabled',
  'muzeDonutChartEnabled',
  'muzeScatterChartEnabled',
  'muzeBubbleChartEnabled',
  'muzeCandlestickChartEnabled',
  'muzeHeatmapChartEnabled',
  'muzeWaterfallChartEnabled',
  'muzeParetoChartEnabled',
  'muzeFunnelChartEnabled'
];

const CSS = `
.ts-chart { display: flex; flex-direction: column; height: 100%; }
.ts-chart form { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
.ts-chart form[hidden] { display: none; }
.ts-chart input { flex: 1; min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; background: var(--bg); color: var(--ink); font-family: var(--mono); font-size: 11.5px; }
.ts-chart a.tb-btn { text-decoration: none; display: inline-flex; align-items: center; }
.ts-chart a.tb-btn[aria-disabled="true"] { pointer-events: none; opacity: 0.5; }
.ts-chart__hint { padding: 6px 8px 0; color: var(--negative); font-size: 12px; }
.ts-chart__stage { flex: 1; min-height: 0; position: relative; background: var(--surface); }
.ts-chart__stage iframe { width: 100%; height: 100%; border: 0; display: block; }
.ts-chart__empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 13px; text-align: center; padding: 16px; }
`;

interface ChartQuery {
  queryColumns: Array<{ id: string }>;
}

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.thoughtspot-chart',
    name: 'ThoughtSpot chart',
    kind: 'embed',
    version: '0.1.0',
    size: [520, 380],
    permissions: ['storage', 'network']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state: State = { ...DEFAULTS, ...(api.storage.get<Partial<State>>() ?? {}) };
    const pageOrigin = new URL(document.baseURI).origin;

    const root = h('div', 'ts-chart');
    const form = h('form');
    const input = h('input');
    input.type = 'text';
    input.placeholder = 'Answer ID, e.g. 0fb54198-868d-45de-8929-139b0089e964';
    input.value = state.answerId;
    input.setAttribute('aria-label', 'ThoughtSpot Answer ID');
    const go = h('button', 'tb-btn tb-btn--primary', 'Load');
    go.type = 'submit';
    const refresh = h('button', 'tb-btn', 'Refresh');
    refresh.type = 'button';
    refresh.title = 'Reload the chart with current data';
    const edit = h('a', 'tb-btn', 'Edit in ThoughtSpot ↗');
    edit.target = '_blank';
    edit.rel = 'noopener noreferrer';
    const settingsToggle = h('button', 'tb-btn', '⚙');
    settingsToggle.type = 'button';
    settingsToggle.setAttribute('aria-label', 'Settings');
    form.append(input, go, refresh, edit, settingsToggle);

    // Settings row: the ThoughtSpot URL used by "Edit in ThoughtSpot" (hidden behind ⚙).
    const settings = h('form');
    settings.hidden = true;
    const tsHostInput = h('input');
    tsHostInput.type = 'url';
    tsHostInput.placeholder = 'ThoughtSpot URL, e.g. https://my-cluster.thoughtspot.cloud';
    tsHostInput.value = state.tsHost;
    tsHostInput.setAttribute('aria-label', 'ThoughtSpot URL');
    const saveSettings = h('button', 'tb-btn tb-btn--primary', 'Save');
    saveSettings.type = 'submit';
    settings.append(tsHostInput, saveSettings);

    const hint = h('div', 'ts-chart__hint');
    hint.hidden = true;
    const stage = h('div', 'ts-chart__stage');
    root.append(form, settings, hint, stage);
    host.append(root);

    /** Cluster the site's credentials belong to (TS_HOST behind the proxy); user override wins. */
    let discoveredTsHost = '';

    /** Keeps Refresh / Edit in sync with what is loaded and where the cluster is. */
    const updateActions = () => {
      refresh.disabled = !state.answerId;
      const endpoint = new URL(state.endpoint, document.baseURI);
      const link = editUrl(resolveTsHost(state.tsHost, endpoint, discoveredTsHost), state.answerId);
      if (link) {
        edit.href = link;
        edit.removeAttribute('aria-disabled');
        edit.title = 'Open this answer in ThoughtSpot';
      } else {
        edit.removeAttribute('href');
        edit.setAttribute('aria-disabled', 'true');
        edit.title = state.answerId ? 'Set the ThoughtSpot URL in ⚙ to enable' : 'Load an answer first';
      }
    };

    let stopListening: (() => void) | null = null;
    let generation = 0;

    const showEmpty = (text: string) => stage.replaceChildren(h('div', 'ts-chart__empty', text));
    const showError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      hint.textContent = message;
      hint.hidden = false;
      showEmpty('Could not load this chart.');
      api.ui.notify(message, 'error');
    };

    /** Boots the chart bundle in an iframe and drives the Chart SDK handshake with `source`. */
    const mountChart = (source: ChartSource) => {
      const bundleBase = new URL(state.bundleBase, document.baseURI);
      const frameUrl = new URL(`src/exports/${bundleFolder(source.chartType)}/index.html`, bundleBase);
      frameUrl.searchParams.set('chartType', source.chartType);
      for (const flag of CHART_FLAGS) frameUrl.searchParams.set(flag, 'true');

      const frame = h('iframe');
      frame.title = 'ThoughtSpot chart';
      frame.src = frameUrl.toString();

      const componentId = `spot-canvas-${crypto.randomUUID()}`;
      const chartModel = {
        columns: source.columns,
        config: { chartConfig: source.chartConfig },
        visualProps: source.visualProps
      };
      const appConfig = {
        ...appConfigDefaults,
        appUrl: frameUrl.toString(),
        appOptions: { ...appConfigDefaults.appOptions, isDarkMode: api.theme.get() === 'dark' },
        initFlags: {
          ...appConfigDefaults.initFlags,
          // The API returns real columns only; the chart derives Measure Names/Values itself.
          enableClientSideMnMvCalculation: { flagId: 'enableClientSideMnMvCalculation', flagValue: true }
        }
      };
      const send = (eventType: string, payload: unknown) =>
        request(frame.contentWindow as Window, { componentId, eventType, payload, source: 'spot-canvas' }) as Promise<
          Record<string, unknown>
        >;
      const dataFor = (queries: ChartQuery[]) =>
        queries.map((q) => projectRows(source, q.queryColumns.map((c) => c.id)));

      let started = false;
      const runInit = async () => {
        const init = await send('Initialize', {
          chartModel,
          appConfig,
          componentId,
          hostUrl: pageOrigin,
          containerElSelector: '#root-container'
        });
        // The chart proposes its own axis mapping when the saved one is empty or invalid.
        const proposed = init.defaultChartConfig as unknown[] | undefined;
        if (proposed?.length && !init.isConfigValid) chartModel.config.chartConfig = proposed;
        const q = await send('GetDataQuery', { config: chartModel.config.chartConfig });
        const queries = (q.queries as ChartQuery[] | undefined) ?? [];
        await send('ChartModelUpdate', { chartModel: { ...chartModel, data: dataFor(queries) } });
        await send('InitializeComplete', {});
      };

      stopListening = listen(
        () => frame.contentWindow,
        (raw, e) => {
          const data = raw as Record<string, any>;
          // Asset lookups (CSS, fonts) come as plain messages and are answered on the window.
          if (data?.type === 'resolveAssetUrl') {
            const filename = String(data.filename);
            const result = filename.startsWith('/') ? new URL(filename, pageOrigin).href : new URL(filename, bundleBase).href;
            (e.source as Window).postMessage({ type: 'resolvedAssetUrl', result, requestId: data.requestId }, '*');
            return SKIP;
          }
          if (!data?.eventType) return SKIP;
          switch (data.eventType) {
            case 'InitStart':
              if (!started) {
                started = true;
                runInit().catch(showError);
              }
              return { hasError: false };
            case 'GetDataForQuery':
              return { hasError: false, data: dataFor((data.payload?.queries as ChartQuery[]) ?? []) };
            case 'GetLDFlags':
            case 'GetBlinkFlags':
              return { hasError: false, data: {} };
            case 'GetLabelTranslation':
              return { hasError: false, data: translations };
            default:
              return { hasError: false };
          }
        }
      );
      stage.replaceChildren(frame);
    };

    const render = async (answerId: string) => {
      const gen = ++generation;
      stopListening?.();
      stopListening = null;
      hint.hidden = true;
      showEmpty('Loading chart…');
      const endpoint = new URL(state.endpoint, document.baseURI);
      const res = await api.net.fetch(endpoint, buildRequest(endpoint, answerId));
      const source = toChartSource(parsePayload(endpoint, await res.json()));
      if (gen !== generation) return; // a newer load superseded this one
      mountChart(source);
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const answerId = input.value.trim();
      if (!answerId) return;
      state.answerId = answerId;
      api.storage.set(state);
      updateActions();
      render(answerId).catch(showError);
    };
    refresh.onclick = () => {
      if (state.answerId) render(state.answerId).catch(showError);
    };
    settingsToggle.onclick = () => {
      settings.hidden = !settings.hidden;
      if (!settings.hidden) tsHostInput.focus();
    };
    settings.onsubmit = (e) => {
      e.preventDefault();
      state.tsHost = tsHostInput.value.trim();
      api.storage.set(state);
      settings.hidden = true;
      updateActions();
      api.ui.notify(state.tsHost ? 'ThoughtSpot URL saved.' : 'ThoughtSpot URL cleared.', 'success');
    };

    api.theme.onChange(() => {
      if (state.answerId) render(state.answerId).catch(showError);
    });
    api.onUnmount(() => {
      generation += 1;
      stopListening?.();
    });

    updateActions();
    fetchDiscoveredTsHost((url) => api.net.fetch(url), new URL(state.endpoint, document.baseURI)).then((tsHost) => {
      discoveredTsHost = tsHost;
      tsHostInput.placeholder = tsHost ? `${tsHost} (from the site's config)` : tsHostInput.placeholder;
      updateActions();
    });
    if (state.answerId) render(state.answerId).catch(showError);
    else showEmpty('Enter a ThoughtSpot Answer ID above and press Load.');
  }
});
