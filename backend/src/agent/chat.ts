import { z } from 'zod';
import type { FetchLike } from '../auth.ts';
import type { GatewayConfig, Identity } from '../config.ts';
import type { Layout } from '../layouts.ts';
import { applyTool, TOOLS, type CataloguePlugin } from './tools.ts';

export class AgentError extends Error {
  override name = 'AgentError';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  catalogue: CataloguePlugin[];
  layout: Layout;
  user: Identity;
}

export interface ChatResult {
  reply: string;
  layout: Layout;
  changed: boolean;
  actions: string[];
}

const MAX_ROUNDS = 8;
const MAX_HISTORY = 12;
const MAX_TOKENS = 900;
const TEMPERATURE = 0.2;
const REQUEST_TIMEOUT_MS = 60_000;
const FALLBACK_REPLY = 'Done. Take a look at the page.';
const ROUND_LIMIT_REPLY = 'I made the changes I could. Tell me what to adjust next.';

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() })
});

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(ToolCallSchema).optional()
        })
      })
    )
    .min(1)
});

type GatewayMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: z.infer<typeof ToolCallSchema>[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function systemPrompt(user: Identity, catalogue: CataloguePlugin[]): string {
  const plugins = catalogue.map((c) => `- ${c.id} ("${c.name}", ${c.kind}, ${c.size[0]}x${c.size[1]})`).join('\n');
  return `You are Spotter, the assistant inside Spot Canvas: a personal ThoughtSpot homepage where ${user.displayName} arranges plugin panels on a canvas and groups related panels inside titled rectangles.

You change the page only through the tools. Every tool call is applied immediately and saved.
The visible canvas is about 1400x860 px; panels are absolutely positioned (x,y from the top-left) and must not overlap. When you omit x/y the tool auto-places the panel, which is usually best. Put related panels in one group: create the group first, then add panels with group_id.

Plugins available right now:
${plugins || '- (none)'}

Data shapes for first-party plugins (pass as "data"):
- spotcanvas.note: { "text": string }  — a note the user can edit.
- spotcanvas.links: { "items": [{ "label": string, "url": string }] } — http(s) links.
- spotcanvas.workflow: { "current": number, "steps": [{ "title": string, "detail": string }] } — a step-by-step checklist.
- spotcanvas.embed: { "url": string } — a web page in an iframe.
- spotcanvas.thoughtspot-chart: { "answerId": string, "tsHost": string } — a saved ThoughtSpot Answer's chart.
- spotcanvas.timer: {} — no data.
Other plugins: leave data empty unless the user tells you what to put in.

Rules:
- Call get_homepage first whenever the request refers to existing panels or groups.
- Never invent plugin ids. If nothing fits, say so briefly.
- Do not remove or clear things the user did not ask to remove.
- Reply in one or two short sentences describing what changed. No markdown headings, no lists of tool calls.`;
}

async function complete(gateway: GatewayConfig, messages: GatewayMessage[], fetchImpl: FetchLike): Promise<z.infer<typeof CompletionSchema>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${gateway.url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: gateway.model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: MAX_TOKENS, temperature: TEMPERATURE }),
      signal: controller.signal
    });
  } catch {
    throw new AgentError('The LLM gateway is unreachable');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new AgentError(`The LLM gateway answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AgentError('The LLM gateway returned a non-JSON body');
  }
  const parsed = CompletionSchema.safeParse(body);
  if (!parsed.success) throw new AgentError('The LLM gateway returned an unexpected completion shape');
  return parsed.data;
}

export async function runChat(req: ChatRequest, gateway: GatewayConfig, fetchImpl: FetchLike = fetch): Promise<ChatResult> {
  const layout: Layout = structuredClone(req.layout);
  const ctx = { layout, catalogue: req.catalogue };
  const actions: string[] = [];
  let changed = false;

  const messages: GatewayMessage[] = [
    { role: 'system', content: systemPrompt(req.user, req.catalogue) },
    ...req.history.slice(-MAX_HISTORY).map<GatewayMessage>((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: req.message }
  ];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const completion = await complete(gateway, messages, fetchImpl);
    const message = completion.choices[0]!.message;
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return { reply: message.content?.trim() || FALLBACK_REPLY, layout, changed, actions };
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: unknown = {};
      let outcome;
      try {
        args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
        outcome = applyTool(call.function.name, args, ctx);
      } catch {
        outcome = { result: { error: 'arguments were not valid JSON' }, changed: false };
      }
      if (outcome.changed) {
        changed = true;
        actions.push(call.function.name);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) });
    }
  }
  return { reply: ROUND_LIMIT_REPLY, layout, changed, actions };
}
