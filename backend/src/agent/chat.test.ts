import { describe, expect, it, vi } from 'vitest';
import type { Layout } from '../layouts.ts';
import { AgentError, runChat, type ChatRequest } from './chat.ts';

const gateway = { url: 'https://llm.example/v1', key: 'secret-key', model: 'm' };
const user = { id: 'u1', name: 'alice', displayName: 'Alice' };
const layout: Layout = { version: 1, panels: [], suites: {}, groups: [], preferences: {} };
const catalogue = [{ id: 'spotcanvas.note', name: 'Sticky note', kind: 'widget', size: [4, 3] as [number, number] }];
const base: ChatRequest = { message: 'add a note', history: [{ role: 'user', content: 'earlier' }], catalogue, layout, user };

const scripted = (...turns: Array<unknown | Response>) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = turns.shift();
    return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
  };
  return { fetchImpl, calls };
};

const toolTurn = (calls: Array<{ id: string; name: string; args: unknown }>) => ({
  choices: [{ message: { content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }]
});

describe('runChat', () => {
  it('sends the system prompt, history and tools with the bearer key, then applies tool calls', async () => {
    const { fetchImpl, calls } = scripted(
      toolTurn([{ id: 'a', name: 'add_panel', args: { plugin_id: 'spotcanvas.note', data: { text: 'hi' } } }]),
      { choices: [{ message: { content: '  Added a note.  ' } }] }
    );
    const out = await runChat(base, gateway, { fetchImpl });
    expect(out).toMatchObject({ reply: 'Added a note.', changed: true, actions: [{ tool: 'add_panel', summary: 'Added Sticky note', changed: true }] });
    expect(out.layout.panels).toHaveLength(1);
    expect(layout.panels).toHaveLength(0);

    expect(calls[0]!.url).toBe('https://llm.example/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: Array<{ role: string; content: string }>; tools: unknown[] };
    expect(body.model).toBe('m');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(body.messages[0]!.content).toContain('spotcanvas.note');
    expect(body.messages[0]!.content).toContain('Alice');
    expect(body.messages[0]!.content).toContain('24 columns by 16 rows');
    expect(body.tools.length).toBeGreaterThan(5);
    const second = JSON.parse(String(calls[1]!.init.body)) as { messages: Array<{ role: string; tool_call_id?: string }> };
    expect(second.messages.at(-2)?.role).toBe('assistant');
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'a' });
  });

  it('feeds tool errors back to the model instead of failing, and falls back on empty replies', async () => {
    const { fetchImpl, calls } = scripted(
      { choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'add_panel', arguments: '{not json' } }] } }] },
      { choices: [{ message: { content: '' } }] }
    );
    const out = await runChat(base, gateway, { fetchImpl });
    expect(out).toMatchObject({ reply: 'Done. Take a look at the page.', changed: false });
    expect(out.actions).toEqual([{ tool: 'add_panel', summary: 'add panel: arguments were not valid JSON', changed: false }]);
    const second = JSON.parse(String(calls[1]!.init.body)) as { messages: Array<{ role: string; content: string }> };
    expect(second.messages.at(-1)!.content).toContain('not valid JSON');
  });

  it('stops after the round limit', async () => {
    const turns = Array.from({ length: 10 }, () => toolTurn([{ id: 'g', name: 'get_homepage', args: {} }]));
    const { fetchImpl, calls } = scripted(...turns);
    const out = await runChat(base, gateway, { fetchImpl });
    expect(out.reply).toContain('changes I could');
    expect(calls).toHaveLength(8);
  });

  it('raises AgentError for outages, error statuses and bad payloads', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new Error('ECONNRESET');
      },
      async () => new Response('busy', { status: 503 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })
    ];
    for (const fetchImpl of cases) {
      await expect(runChat(base, gateway, { fetchImpl })).rejects.toBeInstanceOf(AgentError);
    }
  });
});

describe('runChat with a cluster', () => {
  const cluster = { host: 'https://ts.example.com', cookie: 'JSESSIONID=ct', expiresAt: Date.now() + 60_000 };

  it('offers the cluster tools, describes the cluster in the prompt, and runs cluster calls through clusterFetch', async () => {
    const { fetchImpl, calls } = scripted(
      toolTurn([{ id: 'r', name: 'list_recent_activity', args: { days: 30 } }]),
      { choices: [{ message: { content: 'You opened Sales KPIs recently.' } }] }
    );
    const clusterFetch = vi.fn(async (url: string) => {
      expect(url).toContain('https://ts.example.com/callosum/v1/metadata/list/withstats');
      return new Response(
        JSON.stringify({
          objects: [{ header: { id: 'lb-1', name: 'Sales KPIs' }, type: 'PINBOARD_ANSWER_BOOK', isFavorite: true, stats: { views: 12, lastAccessed: Date.now() } }],
          isLastBatch: true
        }),
        { status: 200 }
      );
    });
    const out = await runChat({ ...base, cluster, catalogue: [...catalogue, { id: 'spotcanvas.embed', name: 'Embed', kind: 'embed', size: [7, 5] }] }, gateway, { fetchImpl, clusterFetch });
    expect(out.reply).toContain('Sales KPIs');
    expect(out.changed).toBe(false);
    expect(out.actions).toEqual([{ tool: 'list_recent_activity', summary: 'Looked at your last 30 days on ThoughtSpot', changed: false }]);
    const body = JSON.parse(String(calls[0]!.init.body)) as { messages: Array<{ content: string }>; tools: Array<{ function: { name: string } }> };
    expect(body.tools.map((t) => t.function.name)).toContain('list_recent_activity');
    expect(body.messages[0]!.content).toContain('ts.example.com/#/pinboard/<id>');
    expect(body.messages[0]!.content).toContain('chart plugin is not installed');
    const toolMsg = JSON.parse(String(calls[1]!.init.body)).messages.at(-1) as { content: string };
    expect(JSON.parse(toolMsg.content)).toMatchObject({ objects: [{ id: 'lb-1', name: 'Sales KPIs', type: 'liveboard', is_favorite: true, views: 12 }] });
  });

  it('turns cluster failures into tool errors the model can read', async () => {
    const { fetchImpl } = scripted(toolTurn([{ id: 's', name: 'search_thoughtspot', args: { query: 'x' } }]), { choices: [{ message: { content: 'Could not reach it.' } }] });
    const out = await runChat({ ...base, cluster }, gateway, { fetchImpl, clusterFetch: async () => new Response('', { status: 401 }) });
    expect(out.reply).toBe('Could not reach it.');
  });

  it('omits cluster tools without a cluster and refuses them if called anyway', async () => {
    const { fetchImpl, calls } = scripted(toolTurn([{ id: 'f', name: 'list_favorites', args: {} }]), { choices: [{ message: { content: 'No cluster.' } }] });
    await runChat(base, gateway, { fetchImpl });
    const body = JSON.parse(String(calls[0]!.init.body)) as { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> };
    expect(body.tools.map((t) => t.function.name)).not.toContain('list_favorites');
    expect(body.messages[0]!.content).toContain('not signed in to a ThoughtSpot cluster');
    const toolMsg = JSON.parse(String(calls[1]!.init.body)).messages.at(-1) as { content: string };
    expect(JSON.parse(toolMsg.content).error).toContain('not signed in');
  });
});
