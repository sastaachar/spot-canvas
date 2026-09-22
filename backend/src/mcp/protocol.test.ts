import { describe, expect, it, vi } from 'vitest';
import { handleMcpMessage, PROTOCOL_VERSION, type McpDeps } from './protocol.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const deps = (fetchImpl: McpDeps['fetchImpl']): McpDeps => ({ baseUrl: 'http://sc.local', token: 'sc_abc', fetchImpl });
const rpc = (method: string, params?: unknown, id: number | string = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

describe('MCP protocol', () => {
  it('initializes, pings, and ignores notifications', async () => {
    const d = deps(async () => json({}));
    expect(await handleMcpMessage(rpc('initialize', { protocolVersion: '2024-11-05' }), d)).toMatchObject({
      id: 1,
      result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'spot-canvas' } }
    });
    expect(await handleMcpMessage(rpc('ping', undefined, 'p'), d)).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
    expect(await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), d)).toBeNull();
    expect(await handleMcpMessage('not json', d)).toMatchObject({ error: { code: -32700 } });
    expect(await handleMcpMessage(JSON.stringify({ nope: 1 }), d)).toMatchObject({ error: { code: -32600 } });
    expect(await handleMcpMessage(rpc('resources/list'), d)).toMatchObject({ error: { code: -32601 } });
  });

  it('lists tools from the backend with the bearer token', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://sc.local/api/tools');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sc_abc');
      return json({ tools: [{ name: 'add_panel', description: 'Add', parameters: { type: 'object', properties: {} } }] });
    });
    const reply = await handleMcpMessage(rpc('tools/list'), deps(fetchImpl));
    expect(reply).toMatchObject({ result: { tools: [{ name: 'add_panel', description: 'Add', inputSchema: { type: 'object' } }] } });
    expect(await handleMcpMessage(rpc('tools/list'), deps(async () => json({}, 500)))).toMatchObject({ error: { code: -32603 } });
  });

  it('calls tools and reports results, errors and bad tokens as MCP content', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://sc.local/api/tools/create_group');
      expect(JSON.parse(String(init?.body))).toEqual({ title: 'Today' });
      return json({ result: { gid: 'group#1' }, changed: true, summary: 'Created group Today' });
    });
    const reply = (await handleMcpMessage(rpc('tools/call', { name: 'create_group', arguments: { title: 'Today' } }), deps(fetchImpl))) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(reply.result.isError).toBe(false);
    expect(reply.result.content[0]!.text).toContain('Created group Today');
    expect(reply.result.content[0]!.text).toContain('group#1');

    const toolError = await handleMcpMessage(rpc('tools/call', { name: 'add_panel' }), deps(async () => json({ result: { error: 'unknown plugin' }, changed: false, summary: null })));
    expect(toolError).toMatchObject({ result: { isError: true } });
    expect(await handleMcpMessage(rpc('tools/call', { name: 'nope' }), deps(async () => json({}, 404)))).toMatchObject({ result: { isError: true } });
    expect(await handleMcpMessage(rpc('tools/call', { name: 'x' }), deps(async () => json({}, 401)))).toMatchObject({ result: { isError: true } });
    expect(await handleMcpMessage(rpc('tools/call', { name: 'x' }), deps(async () => json({}, 500)))).toMatchObject({ result: { isError: true } });
    expect(await handleMcpMessage(rpc('tools/call', { nope: true }), deps(async () => json({})))).toMatchObject({ error: { code: -32603 } });
  });
});
