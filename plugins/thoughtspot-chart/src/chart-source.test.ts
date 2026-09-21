import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  bundleFolder,
  editUrl,
  fetchDiscoveredTsHost,
  parsePayload,
  projectRows,
  resolveTsHost,
  toChartSource,
  type HostedChartModelPayload
} from './chart-source';

const payload: HostedChartModelPayload = {
  chart_type: 'advanced_stacked_bar',
  hosted_chart_url: 'https://hc-advanced.pdom.thoughtspot.com?chartType=advanced_stacked_bar',
  chart_model: {
    columns: [
      { id: 'a', name: 'Ship Mode', type: 2, dataType: 2, timeBucket: 0, chartSpecificColumnType: 0 },
      { id: 'm', name: 'Total Tax', type: 1, dataType: 4, timeBucket: 0, chartSpecificColumnType: 0 }
    ],
    config: { chartConfig: [{ key: 'column' }] },
    visualProps: { legend: true }
  },
  data: { data: { columns: ['a', 'm'], dataValue: [['fob', 7], ['mail', 2]] }, totalRowCount: 2 }
};

describe('chart-source', () => {
  it('speaks GraphQL to a /prism endpoint and REST 2.0 otherwise', () => {
    const gql = JSON.parse(String(buildRequest(new URL('http://localhost:5173/prism'), 'guid').body));
    expect(gql.variables).toEqual({ request: { answerId: 'guid' } });
    const rest = JSON.parse(
      String(buildRequest(new URL('https://cluster/api/rest/2.0/metadata/answer/hosted-chart-model'), 'guid').body)
    );
    expect(rest).toEqual({ metadata_identifier: 'guid' });
  });

  it('unwraps the GraphQL envelope and surfaces errors', () => {
    const gqlUrl = new URL('http://localhost/prism');
    expect(parsePayload(gqlUrl, { data: { getAnswerHostedChartModel: payload } })).toBe(payload);
    expect(parsePayload(new URL('https://cluster/api/rest/2.0/x'), payload)).toBe(payload);
    expect(() => parsePayload(gqlUrl, { errors: [{ message: 'no access' }] })).toThrow('no access');
    expect(() => parsePayload(gqlUrl, { data: {} })).toThrow('Unexpected API response');
  });

  it('keys rows by column id and rejects answers without a hostable chart', () => {
    const source = toChartSource(payload);
    expect(source.rows).toEqual([{ a: 'fob', m: 7 }, { a: 'mail', m: 2 }]);
    expect(source.chartConfig).toEqual([{ key: 'column' }]);
    expect(() => toChartSource({ ...payload, chart_type: null })).toThrow('no chart');
  });

  it('resolves the ThoughtSpot host and builds the edit link', () => {
    const local = new URL('http://localhost:5175/prism');
    expect(resolveTsHost('https://ts.example.com/', local)).toBe('https://ts.example.com');
    expect(resolveTsHost('', local)).toBe('');
    // the site's TS_HOST wins over nothing, the user's override wins over the site
    expect(resolveTsHost('', local, 'https://172.32.87.105:8443/')).toBe('https://172.32.87.105:8443');
    expect(resolveTsHost('https://override', local, 'https://172.32.87.105:8443')).toBe('https://override');
    expect(resolveTsHost('', new URL('https://cluster:8443/api/rest/2.0/metadata/answer/hosted-chart-model'))).toBe(
      'https://cluster:8443'
    );
    expect(editUrl('https://ts.example.com', 'abc-123')).toBe('https://ts.example.com/#/insights/saved-answer/abc-123');
    expect(editUrl('', 'abc-123')).toBeNull();
    expect(editUrl('https://ts.example.com', '')).toBeNull();
  });

  it('discovers the site host from /thoughtspot/config and tolerates its absence', async () => {
    const endpoint = new URL('http://localhost:5175/prism');
    const ok = async () => new Response(JSON.stringify({ tsHost: 'https://172.32.87.105:8443' }));
    expect(await fetchDiscoveredTsHost(ok, endpoint)).toBe('https://172.32.87.105:8443');
    const missing = async () => new Response('not found', { status: 404 });
    expect(await fetchDiscoveredTsHost(missing, endpoint)).toBe('');
    const failing = async () => { throw new Error('offline'); };
    expect(await fetchDiscoveredTsHost(failing, endpoint)).toBe('');
  });

  it('maps chart types to bundle folders and projects rows onto a query', () => {
    expect(bundleFolder('advanced_stacked_bar')).toBe('stacked-bar');
    expect(bundleFolder('advanced_column')).toBe('column');
    const source = toChartSource(payload);
    expect(projectRows(source, ['m'])).toEqual({
      data: { columns: ['m'], dataValue: [[7], [2]] },
      totalRowCount: 2
    });
  });
});
