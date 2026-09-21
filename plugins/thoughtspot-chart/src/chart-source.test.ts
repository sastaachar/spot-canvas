import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  bundleFolder,
  parsePayload,
  projectRows,
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
