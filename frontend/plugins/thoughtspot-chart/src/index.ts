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

// The chart is chromeless: no toolbar, just the stage. Actions live in the panel's
// right-click menu (api.ui.setCommands); the prompt card only appears when asked.
const CSS = `
.ts-chart { position: relative; height: 100%; background: var(--surface); }
.ts-chart__stage { position: absolute; inset: 0; }
.ts-chart__stage iframe { width: 100%; height: 100%; border: 0; display: block; }
.ts-chart__empty { position: absolute; inset: 0; display: grid; place-items: center; gap: 4px; color: var(--muted); font-size: 13px; text-align: center; padding: 16px; }
.ts-chart__empty small { color: var(--muted); opacity: 0.75; font-size: 11.5px; }
.ts-chart__card { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--surface) 82%, transparent); }
.ts-chart__card[hidden] { display: none; }
.ts-chart__form { width: min(440px, 100%); display: grid; gap: 8px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; padding: 14px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18); }
.ts-chart__form label { font-size: 11px; font-weight: 600; color: var(--muted); }
.ts-chart__form input { height: 30px; border: 1px solid var(--border); border-radius: 6px; padding: 0 9px; background: var(--bg); color: var(--ink); font-family: var(--mono); font-size: 11.5px; }
.ts-chart__row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; }
.ts-chart__hint { color: var(--negative); font-size: 12px; }
.ts-chart__hint[hidden] { display: none; }
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
    const stage = h('div', 'ts-chart__stage');

    // Prompt card — the only chrome, shown only when asking for an Answer ID or the
    // ThoughtSpot URL. Everything else is reached through the right-click menu.
    const card = h('div', 'ts-chart__card');
    card.hidden = true;
    const form = h('form', 'ts-chart__form');
    const label = h('label');
    const input = h('input');
    input.setAttribute('aria-label', 'ThoughtSpot value');
    const hint = h('div', 'ts-chart__hint');
    hint.hidden = true;
    const row = h('div', 'ts-chart__row');
    const cancel = h('button', 'tb-btn', 'Cancel');
    cancel.type = 'button';
    const submit = h('button', 'tb-btn tb-btn--primary', 'Load');
    submit.type = 'submit';
    row.append(cancel, submit);
    form.append(label, input, hint, row);
    card.append(form);
    root.append(stage, card);
    host.append(root);

    /** Cluster the site's credentials belong to (TS_HOST behind the proxy); user override wins. */
    let discoveredTsHost = '';
    type Prompt = 'none' | 'answer' | 'tshost';
    let prompt: Prompt = 'none';

    /** The "Open in ThoughtSpot" link for the current answer, or null when unavailable. */
    const currentEditUrl = (): string | null => {
      const endpoint = new URL(state.endpoint, document.baseURI);
      return editUrl(resolveTsHost(state.tsHost, endpoint, discoveredTsHost), state.answerId);
    };

    let stopListening: (() => void) | null = null;
    let generation = 0;

    const showEmpty = (text: string) => {
      const empty = h('div', 'ts-chart__empty');
      empty.append(h('div', undefined, text), h('small', undefined, 'Right-click or use ⋯ for options'));
      stage.replaceChildren(empty);
    };
    const showError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!card.hidden) {
        hint.textContent = message;
        hint.hidden = false;
      }
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
      // Right-clicks inside the (same-origin) chart iframe don't reach the host, so
      // forward them to the panel menu translated into page coordinates.
      frame.addEventListener('load', () => {
        frame.contentDocument?.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          const rect = frame.getBoundingClientRect();
          api.ui.openMenu(rect.left + ev.clientX, rect.top + ev.clientY);
        });
      });
      stage.replaceChildren(frame);
    };

    const render = async (answerId: string) => {
      const gen = ++generation;
      stopListening?.();
      stopListening = null;
      showEmpty('Loading chart…');
      const endpoint = new URL(state.endpoint, document.baseURI);
      const res = await api.net.fetch(endpoint, buildRequest(endpoint, answerId));
      const source = toChartSource(parsePayload(endpoint, await res.json()));
      if (gen !== generation) return; // a newer load superseded this one
      mountChart(source);
    };

    const closePrompt = () => {
      prompt = 'none';
      card.hidden = true;
      hint.hidden = true;
      if (!state.answerId) showEmpty('No answer loaded.');
    };

    // Show the prompt card for either the Answer ID or the ThoughtSpot URL.
    const openPrompt = (mode: 'answer' | 'tshost') => {
      prompt = mode;
      hint.hidden = true;
      if (mode === 'answer') {
        label.textContent = 'ThoughtSpot Answer ID';
        input.type = 'text';
        input.placeholder = 'e.g. 0fb54198-868d-45de-8929-139b0089e964';
        input.value = state.answerId;
        submit.textContent = 'Load';
      } else {
        label.textContent = 'ThoughtSpot URL (for “Open in ThoughtSpot”)';
        input.type = 'url';
        input.placeholder = discoveredTsHost || 'https://my-cluster.thoughtspot.cloud';
        input.value = state.tsHost;
        submit.textContent = 'Save';
      }
      // Cancelling only makes sense once something is already on screen.
      cancel.hidden = mode === 'answer' && !state.answerId;
      card.hidden = false;
      input.focus();
      input.select();
    };

    // Rebuild the right-click menu to match what is currently loaded.
    const updateCommands = () => {
      const loaded = Boolean(state.answerId);
      const link = currentEditUrl();
      api.ui.setCommands([
        {
          id: 'open',
          label: 'Open in ThoughtSpot ↗',
          icon: '↗',
          disabled: !link,
          onSelect: () => {
            if (link) window.open(link, '_blank', 'noopener,noreferrer');
          }
        },
        { id: 'refresh', label: 'Refresh', icon: '⟳', disabled: !loaded, onSelect: () => render(state.answerId).catch(showError) },
        { id: 'answer', label: loaded ? 'Change answer…' : 'Load answer…', icon: '◔', onSelect: () => openPrompt('answer') },
        { id: 'tshost', label: 'Set ThoughtSpot URL…', icon: '⚙', onSelect: () => openPrompt('tshost') }
      ]);
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (prompt === 'tshost') {
        state.tsHost = value;
        api.storage.set(state);
        closePrompt();
        updateCommands();
        api.ui.notify(value ? 'ThoughtSpot URL saved.' : 'ThoughtSpot URL cleared.', 'success');
        return;
      }
      if (!value) return;
      state.answerId = value;
      api.storage.set(state);
      closePrompt();
      updateCommands();
      render(value).catch(showError);
    };
    cancel.onclick = () => closePrompt();

    // Right-clicks on the chrome (empty state / card) open the same panel menu.
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      api.ui.openMenu(e.clientX, e.clientY);
    });

    api.theme.onChange(() => {
      if (state.answerId) render(state.answerId).catch(showError);
    });
    api.onUnmount(() => {
      generation += 1;
      stopListening?.();
    });

    updateCommands();
    fetchDiscoveredTsHost((url) => api.net.fetch(url), new URL(state.endpoint, document.baseURI)).then((tsHost) => {
      discoveredTsHost = tsHost;
      updateCommands();
    });
    if (state.answerId) render(state.answerId).catch(showError);
    else openPrompt('answer');
  }
});
