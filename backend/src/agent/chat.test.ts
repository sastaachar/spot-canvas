import { describe, expect, it } from 'vitest';
import type { Layout } from '../layouts.ts';
import { AgentError, runChat, type ChatRequest } from './chat.ts';

const gateway = { url: 'https://llm.example/v1', key: 'secret-key', model: 'm' };
const user = { id: 'u1', name: 'alice', displayName: 'Alice' };
const layout: Layout = { version: 1, panels: [], suites: {}, groups: [], preferences: {} };
const catalogue = [{ id: 'spotcanvas.note', name: 'Sticky note', kind: 'widget', size: [220, 160] as [number, number] }];
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
    const out = await runChat(base, gateway, fetchImpl);
    expect(out).toMatchObject({ reply: 'Added a note.', changed: true, actions: ['add_panel'] });
    expect(out.layout.panels).toHaveLength(1);
    expect(layout.panels).toHaveLength(0);

    expect(calls[0]!.url).toBe('https://llm.example/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: Array<{ role: string; content: string }>; tools: unknown[] };
    expect(body.model).toBe('m');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(body.messages[0]!.content).toContain('spotcanvas.note');
    expect(body.messages[0]!.content).toContain('Alice');
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
    const out = await runChat(base, gateway, fetchImpl);
    expect(out).toMatchObject({ reply: 'Done. Take a look at the page.', changed: false, actions: [] });
    const second = JSON.parse(String(calls[1]!.init.body)) as { messages: Array<{ role: string; content: string }> };
    expect(second.messages.at(-1)!.content).toContain('not valid JSON');
  });

  it('stops after the round limit', async () => {
    const turns = Array.from({ length: 10 }, () => toolTurn([{ id: 'g', name: 'get_homepage', args: {} }]));
    const { fetchImpl, calls } = scripted(...turns);
    const out = await runChat(base, gateway, fetchImpl);
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
      await expect(runChat(base, gateway, fetchImpl)).rejects.toBeInstanceOf(AgentError);
    }
  });
});
