/**
 * The hosted-chart-model API payload and the pure transformations the plugin applies
 * to it. No DOM here so it can be unit-tested directly.
 */

/** Chart SDK `ChartColumn` as returned by the API (numeric SDK enums). */
export interface SdkColumn {
  id: string;
  name: string;
  type: number;
  dataType: number;
  timeBucket: number;
  chartSpecificColumnType: number;
}

/** Response of POST /metadata/answer/hosted-chart-model (also the GraphQL field's value). */
export interface HostedChartModelPayload {
  chart_type: string | null;
  hosted_chart_url: string | null;
  chart_model: {
    columns: SdkColumn[];
    config: { chartConfig: unknown[] };
    visualProps: unknown;
  };
  data: {
    data: { columns: string[]; dataValue: unknown[][] };
    totalRowCount: number;
  };
}

/** What the host needs to drive the chart: rows keyed by column id, plus the model bits. */
export interface ChartSource {
  chartType: string;
  columns: SdkColumn[];
  rows: Array<Record<string, unknown>>;
  chartConfig: unknown[];
  visualProps: unknown;
}

/** Chart SDK `QueryData` for one query. */
export interface QueryData {
  data: { columns: string[]; dataValue: unknown[][] };
  totalRowCount: number;
}

const GRAPHQL_QUERY =
  'query HostedChartModel($request: HostedChartModelRequestInput!) { getAnswerHostedChartModel(request: $request) }';

const isGraphqlEndpoint = (url: URL): boolean => /\/prism\/?$/.test(url.pathname);

/**
 * Request for `answerId`: prism's internal GraphQL field when the endpoint is a `/prism`
 * URL (local development), otherwise the public REST 2.0 body.
 */
export function buildRequest(endpoint: URL, answerId: string): RequestInit {
  const body = isGraphqlEndpoint(endpoint)
    ? { operationName: 'HostedChartModel', query: GRAPHQL_QUERY, variables: { request: { answerId } } }
    : { metadata_identifier: answerId };
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Unwraps the GraphQL envelope when needed and surfaces API errors as exceptions. */
export function parsePayload(endpoint: URL, json: unknown): HostedChartModelPayload {
  const value = json as { errors?: Array<{ message?: string }>; data?: Record<string, unknown> } | null;
  if (value?.errors?.length) throw new Error(value.errors[0]?.message ?? 'The API returned an error');
  const payload = isGraphqlEndpoint(endpoint) ? value?.data?.getAnswerHostedChartModel : json;
  if (!payload || typeof payload !== 'object') throw new Error('Unexpected API response');
  return payload as HostedChartModelPayload;
}

/** Rows keyed by column id so they can be projected onto any query the chart asks for. */
export function toChartSource(payload: HostedChartModelPayload): ChartSource {
  if (!payload.chart_type) throw new Error('This answer has no chart that can be hosted');
  const ids = payload.data.data.columns;
  return {
    chartType: payload.chart_type,
    columns: payload.chart_model.columns,
    rows: payload.data.data.dataValue.map((row) => Object.fromEntries(ids.map((id, i) => [id, row[i]]))),
    chartConfig: payload.chart_model.config.chartConfig ?? [],
    visualProps: payload.chart_model.visualProps ?? {}
  };
}

/** Folder of the built valkyrie entry for a hosted chart type: advanced_stacked_bar -> stacked-bar. */
export const bundleFolder = (chartType: string): string => chartType.replace(/^advanced_/, '').replace(/_/g, '-');

/**
 * ThoughtSpot host to deep-link into, in order of precedence: the user's override,
 * the host the site reports (`GET /thoughtspot/config`, the cluster its credentials
 * belong to), else the API endpoint's own origin when it points at a cluster.
 */
export function resolveTsHost(configured: string, endpoint: URL, discovered = ''): string {
  const trim = (s: string) => s.trim().replace(/\/+$/, '');
  if (configured.trim()) return trim(configured);
  if (discovered.trim()) return trim(discovered);
  return /^(localhost|127\.0\.0\.1)$/.test(endpoint.hostname) ? '' : endpoint.origin;
}

/** The site's ThoughtSpot host, served next to the API proxy; '' when the site has none. */
export async function fetchDiscoveredTsHost(
  fetch: (url: URL) => Promise<Response>,
  endpoint: URL
): Promise<string> {
  try {
    const res = await fetch(new URL('/thoughtspot/config', endpoint));
    if (!res.ok) return '';
    const body = (await res.json()) as { tsHost?: unknown };
    return typeof body.tsHost === 'string' ? body.tsHost : '';
  } catch {
    return '';
  }
}

/** Link that opens the answer in ThoughtSpot, or null when the host is unknown. */
export function editUrl(tsHost: string, answerId: string): string | null {
  if (!tsHost || !answerId) return null;
  try {
    return new URL(`#/insights/saved-answer/${encodeURIComponent(answerId)}`, `${tsHost.replace(/\/+$/, '')}/`).toString();
  } catch {
    return null;
  }
}

/** Projects the rows onto the column ids of one chart query. */
export function projectRows(source: ChartSource, columnIds: string[]): QueryData {
  return {
    data: { columns: columnIds, dataValue: source.rows.map((row) => columnIds.map((id) => row[id])) },
    totalRowCount: source.rows.length
  };
}
