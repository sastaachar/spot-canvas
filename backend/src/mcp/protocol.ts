import { z } from 'zod';
import type { FetchLike } from '../auth.ts';

export interface McpDeps {
  baseUrl: string;
  token: string;
  fetchImpl: FetchLike;
}

export const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'spot-canvas', version: '0.1.0' };
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

const RequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional()
});

const CallParamsSchema = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

const ToolListSchema = z.object({
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.unknown() }))
});

type Id = string | number;

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const err = (id: Id | null, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });

async function api(deps: McpDeps, path: string, init: RequestInit = {}): Promise<Response> {
  return deps.fetchImpl(`${deps.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${deps.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
  });
}

async function listTools(deps: McpDeps): Promise<unknown> {
  const res = await api(deps, '/api/tools');
  if (!res.ok) throw new Error(`Spot Canvas answered ${res.status} for the tool list`);
  const parsed = ToolListSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('Spot Canvas returned an unexpected tool list');
  return { tools: parsed.data.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) };
}

async function callTool(deps: McpDeps, raw: unknown): Promise<unknown> {
  const params = CallParamsSchema.safeParse(raw);
  if (!params.success) throw new Error('tools/call needs { name, arguments }');
  const res = await api(deps, `/api/tools/${encodeURIComponent(params.data.name)}`, {
    method: 'POST',
    body: JSON.stringify(params.data.arguments ?? {})
  });
  if (res.status === 404) return { content: [{ type: 'text', text: `Unknown tool ${params.data.name}` }], isError: true };
  if (res.status === 401) return { content: [{ type: 'text', text: 'Spot Canvas rejected the token; create a new one from the profile sheet.' }], isError: true };
  if (!res.ok) return { content: [{ type: 'text', text: `Spot Canvas answered ${res.status}` }], isError: true };
  const body = (await res.json()) as { result: unknown; changed: boolean; summary: string | null };
  const isError = typeof body.result === 'object' && body.result !== null && 'error' in (body.result as object);
  const text = body.summary ? `${body.summary}\n${JSON.stringify(body.result)}` : JSON.stringify(body.result);
  return { content: [{ type: 'text', text }], isError };
}

/** Handle one JSON-RPC line. Returns the reply, or null for notifications. */
export async function handleMcpMessage(line: string, deps: McpDeps): Promise<unknown | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return err(null, PARSE_ERROR, 'invalid JSON');
  }
  const req = RequestSchema.safeParse(raw);
  if (!req.success) return err(null, INVALID_REQUEST, 'invalid JSON-RPC request');
  const { id, method, params } = req.data;
  if (id === undefined) return null; // notifications (e.g. notifications/initialized) need no reply
  try {
    switch (method) {
      case 'initialize':
        return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, await listTools(deps));
      case 'tools/call':
        return ok(id, await callTool(deps, params));
      default:
        return err(id, METHOD_NOT_FOUND, `unknown method ${method}`);
    }
  } catch (error) {
    return err(id, INTERNAL_ERROR, error instanceof Error ? error.message : 'internal error');
  }
}
