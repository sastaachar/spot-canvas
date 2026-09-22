import { z } from 'zod';
import type { Layout } from '../layouts.ts';
import { ThoughtSpotError, type ThoughtSpotClient } from './thoughtspot.ts';

export const CataloguePluginSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(60),
  kind: z.string().min(1).max(20),
  size: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  suiteId: z.string().max(200).nullable().optional()
});

export type CataloguePlugin = z.infer<typeof CataloguePluginSchema>;

export interface ToolContext {
  layout: Layout;
  catalogue: CataloguePlugin[];
  thoughtSpot?: ThoughtSpotClient | null;
}

export interface ToolOutcome {
  result: unknown;
  changed: boolean;
}

type Panel = Layout['panels'][number];
type Group = NonNullable<Layout['groups']>[number];

const CANVAS = { w: 1400, h: 860 };
const GUTTER = 24;
const STEP = 40;
const GROUP_PADDING = { x: 16, top: 44, bottom: 16 };
const DEFAULT_GROUP = { w: 560, h: 380 };
const GROUP_COLORS = ['blue', 'amber', 'green', 'violet', 'slate'] as const;
const THEMES = ['system', 'light', 'dark'] as const;

interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

const num = (description: string) => ({ type: 'number', description });
const str = (description: string) => ({ type: 'string', description });

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_homepage',
      description: 'Read the current homepage: panels, groups, theme and the plugins that can be added. Call this before changing existing content.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_panel',
      description: 'Add a plugin panel to the homepage. Omit x/y to auto-place it; pass group_id to place it inside a group.',
      parameters: {
        type: 'object',
        properties: {
          plugin_id: str('id from available_plugins, e.g. spotcanvas.note'),
          title: str('optional header title override'),
          data: { type: 'object', description: 'plugin data, shape depends on the plugin (see system prompt)' },
          x: num('left edge in px'),
          y: num('top edge in px'),
          w: num('width in px'),
          h: num('height in px'),
          group_id: str('gid of a group to place the panel in')
        },
        required: ['plugin_id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_panel',
      description: 'Change a panel: title, data (shallow-merged into existing data), position, size or group (null to ungroup).',
      parameters: {
        type: 'object',
        properties: {
          iid: str('panel iid'),
          title: { type: ['string', 'null'], description: 'new header title, null to restore the plugin name' },
          data: { type: 'object', description: 'fields to merge into the plugin data' },
          x: num('left edge'),
          y: num('top edge'),
          w: num('width'),
          h: num('height'),
          group_id: { type: ['string', 'null'], description: 'group gid or null' }
        },
        required: ['iid'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_panel',
      description: 'Remove a panel from the homepage.',
      parameters: { type: 'object', properties: { iid: str('panel iid') }, required: ['iid'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_group',
      description: 'Create a titled rectangle that visually groups panels. Returns its gid. Omit x/y to auto-place.',
      parameters: {
        type: 'object',
        properties: {
          title: str('group title, short'),
          color: { type: 'string', enum: [...GROUP_COLORS] },
          x: num('left edge'),
          y: num('top edge'),
          w: num('width, default 560'),
          h: num('height, default 380')
        },
        required: ['title'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_group',
      description: 'Rename, recolour, move or resize a group. Moving a group moves the panels inside it.',
      parameters: {
        type: 'object',
        properties: {
          gid: str('group gid'),
          title: str('new title'),
          color: { type: 'string', enum: [...GROUP_COLORS] },
          x: num('left edge'),
          y: num('top edge'),
          w: num('width'),
          h: num('height')
        },
        required: ['gid'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_group',
      description: 'Remove a group. By default its panels stay on the page; with_panels removes them too.',
      parameters: {
        type: 'object',
        properties: { gid: str('group gid'), with_panels: { type: 'boolean' } },
        required: ['gid'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_theme',
      description: 'Set the colour theme preference.',
      parameters: {
        type: 'object',
        properties: { theme: { type: 'string', enum: [...THEMES] } },
        required: ['theme'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_homepage',
      description: 'Remove every panel and group. Only when the user clearly asks for a fresh start.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  }
];

const AddPanelArgs = z.object({
  plugin_id: z.string(),
  title: z.string().max(60).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional(),
  group_id: z.string().optional()
});

const UpdatePanelArgs = z.object({
  iid: z.string(),
  title: z.string().max(60).nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional(),
  group_id: z.string().nullable().optional()
});

const IdArgs = z.object({ iid: z.string() });

const CreateGroupArgs = z.object({
  title: z.string().min(1).max(60),
  color: z.enum(GROUP_COLORS).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional()
});

const UpdateGroupArgs = z.object({
  gid: z.string(),
  title: z.string().min(1).max(60).optional(),
  color: z.enum(GROUP_COLORS).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional()
});

const RemoveGroupArgs = z.object({ gid: z.string(), with_panels: z.boolean().optional() });
const ThemeArgs = z.object({ theme: z.enum(THEMES) });

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w + GUTTER && a.x + a.w + GUTTER > b.x && a.y < b.y + b.h + GUTTER && a.y + a.h + GUTTER > b.y;

function nextFreeSpot(taken: Rect[], w: number, h: number, bounds: Rect): { x: number; y: number } {
  const startX = bounds.x;
  const startY = bounds.y;
  const maxX = Math.max(startX, bounds.x + bounds.w - w);
  const maxY = Math.max(startY, bounds.y + bounds.h - h);
  for (let y = startY; y <= maxY; y += STEP) {
    for (let x = startX; x <= maxX; x += STEP) {
      const candidate = { x, y, w, h };
      if (!taken.some((r) => overlaps(candidate, r))) return { x, y };
    }
  }
  const last = taken.reduce((acc, r) => Math.max(acc, r.y + r.h), startY);
  return { x: startX, y: last + GUTTER };
}

const nextId = (ids: string[], prefix: string): string => {
  let max = 0;
  for (const id of ids) {
    const n = Number(id.split('#')[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `${prefix}#${max + 1}`;
};

const groupsOf = (layout: Layout): Group[] => layout.groups ?? [];

function summary(ctx: ToolContext): unknown {
  return {
    theme: ctx.layout.preferences?.theme ?? 'system',
    groups: groupsOf(ctx.layout).map((g) => ({ gid: g.gid, title: g.title, x: g.x, y: g.y, w: g.w, h: g.h, color: g.color })),
    panels: ctx.layout.panels.map((p) => ({
      iid: p.iid,
      plugin_id: p.pluginId,
      title: p.title ?? null,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      group_id: p.groupId ?? null,
      data: p.data ?? null
    })),
    available_plugins: ctx.catalogue.map((c) => ({ id: c.id, name: c.name, kind: c.kind, default_size: c.size }))
  };
}

const fail = (message: string): ToolOutcome => ({ result: { error: message }, changed: false });

function placePanel(ctx: ToolContext, w: number, h: number, group: Group | undefined): { x: number; y: number } {
  if (group) {
    const members = ctx.layout.panels.filter((p) => p.groupId === group.gid);
    const inner = {
      x: group.x + GROUP_PADDING.x,
      y: group.y + GROUP_PADDING.top,
      w: Math.max(w, group.w - GROUP_PADDING.x * 2),
      h: Math.max(h, group.h - GROUP_PADDING.top - GROUP_PADDING.bottom)
    };
    return nextFreeSpot(members, w, h, inner);
  }
  const taken: Rect[] = [...ctx.layout.panels.filter((p) => !p.groupId), ...groupsOf(ctx.layout)];
  return nextFreeSpot(taken, w, h, { x: 40, y: 40, w: CANVAS.w - 80, h: CANVAS.h - 80 });
}

function addPanel(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = AddPanelArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for add_panel');
  const plugin = ctx.catalogue.find((c) => c.id === args.data.plugin_id);
  if (!plugin) return fail(`unknown plugin ${args.data.plugin_id}; use one of available_plugins`);
  const group = args.data.group_id ? groupsOf(ctx.layout).find((g) => g.gid === args.data.group_id) : undefined;
  if (args.data.group_id && !group) return fail(`unknown group ${args.data.group_id}`);
  const w = args.data.w ?? plugin.size[0];
  const h = args.data.h ?? plugin.size[1];
  const at = args.data.x !== undefined && args.data.y !== undefined ? { x: args.data.x, y: args.data.y } : placePanel(ctx, w, h, group);
  const panel: Panel = {
    iid: nextId(ctx.layout.panels.map((p) => p.iid), plugin.id),
    pluginId: plugin.id,
    x: Math.max(0, at.x),
    y: Math.max(0, at.y),
    w,
    h,
    z: ctx.layout.panels.reduce((acc, p) => Math.max(acc, p.z), 0) + 1,
    data: args.data.data ?? null,
    title: args.data.title ?? null,
    groupId: group?.gid ?? null
  };
  ctx.layout.panels.push(panel);
  return { result: { iid: panel.iid, x: panel.x, y: panel.y, w, h, group_id: panel.groupId }, changed: true };
}

function updatePanel(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = UpdatePanelArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for update_panel');
  const panel = ctx.layout.panels.find((p) => p.iid === args.data.iid);
  if (!panel) return fail(`unknown panel ${args.data.iid}`);
  if (args.data.group_id) {
    if (!groupsOf(ctx.layout).some((g) => g.gid === args.data.group_id)) return fail(`unknown group ${args.data.group_id}`);
  }
  if (args.data.title !== undefined) panel.title = args.data.title;
  if (args.data.data !== undefined) {
    const existing = typeof panel.data === 'object' && panel.data !== null && !Array.isArray(panel.data) ? (panel.data as Record<string, unknown>) : {};
    panel.data = { ...existing, ...args.data.data };
  }
  if (args.data.x !== undefined) panel.x = Math.max(0, args.data.x);
  if (args.data.y !== undefined) panel.y = Math.max(0, args.data.y);
  if (args.data.w !== undefined) panel.w = args.data.w;
  if (args.data.h !== undefined) panel.h = args.data.h;
  if (args.data.group_id !== undefined) panel.groupId = args.data.group_id;
  return { result: { ok: true, iid: panel.iid }, changed: true };
}

function removePanel(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = IdArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for remove_panel');
  const before = ctx.layout.panels.length;
  ctx.layout.panels = ctx.layout.panels.filter((p) => p.iid !== args.data.iid);
  if (ctx.layout.panels.length === before) return fail(`unknown panel ${args.data.iid}`);
  return { result: { ok: true }, changed: true };
}

function createGroup(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = CreateGroupArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for create_group');
  const groups = groupsOf(ctx.layout);
  const w = args.data.w ?? DEFAULT_GROUP.w;
  const h = args.data.h ?? DEFAULT_GROUP.h;
  const at =
    args.data.x !== undefined && args.data.y !== undefined
      ? { x: args.data.x, y: args.data.y }
      : nextFreeSpot([...ctx.layout.panels.filter((p) => !p.groupId), ...groups], w, h, { x: 40, y: 40, w: CANVAS.w - 80, h: CANVAS.h - 80 });
  const group: Group = {
    gid: nextId(groups.map((g) => g.gid), 'group'),
    title: args.data.title,
    x: Math.max(0, at.x),
    y: Math.max(0, at.y),
    w,
    h,
    color: args.data.color ?? GROUP_COLORS[groups.length % GROUP_COLORS.length] ?? 'blue'
  };
  ctx.layout.groups = [...groups, group];
  return { result: { gid: group.gid, x: group.x, y: group.y, w, h }, changed: true };
}

function updateGroup(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = UpdateGroupArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for update_group');
  const group = groupsOf(ctx.layout).find((g) => g.gid === args.data.gid);
  if (!group) return fail(`unknown group ${args.data.gid}`);
  if (args.data.title !== undefined) group.title = args.data.title;
  if (args.data.color !== undefined) group.color = args.data.color;
  if (args.data.x !== undefined || args.data.y !== undefined) {
    const nx = Math.max(0, args.data.x ?? group.x);
    const ny = Math.max(0, args.data.y ?? group.y);
    const dx = nx - group.x;
    const dy = ny - group.y;
    for (const p of ctx.layout.panels) {
      if (p.groupId === group.gid) {
        p.x = Math.max(0, p.x + dx);
        p.y = Math.max(0, p.y + dy);
      }
    }
    group.x = nx;
    group.y = ny;
  }
  if (args.data.w !== undefined) group.w = args.data.w;
  if (args.data.h !== undefined) group.h = args.data.h;
  return { result: { ok: true, gid: group.gid }, changed: true };
}

function removeGroup(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = RemoveGroupArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for remove_group');
  const groups = groupsOf(ctx.layout);
  if (!groups.some((g) => g.gid === args.data.gid)) return fail(`unknown group ${args.data.gid}`);
  ctx.layout.groups = groups.filter((g) => g.gid !== args.data.gid);
  ctx.layout.panels = ctx.layout.panels.flatMap((p) => {
    if (p.groupId !== args.data.gid) return [p];
    return args.data.with_panels ? [] : [{ ...p, groupId: null }];
  });
  return { result: { ok: true }, changed: true };
}

function setTheme(ctx: ToolContext, raw: unknown): ToolOutcome {
  const args = ThemeArgs.safeParse(raw);
  if (!args.success) return fail('invalid arguments for set_theme');
  ctx.layout.preferences = { ...ctx.layout.preferences, theme: args.data.theme };
  return { result: { ok: true, theme: args.data.theme }, changed: true };
}

function clearHomepage(ctx: ToolContext): ToolOutcome {
  const had = ctx.layout.panels.length + groupsOf(ctx.layout).length;
  ctx.layout.panels = [];
  ctx.layout.groups = [];
  return { result: { ok: true, removed: had }, changed: had > 0 };
}

const OBJECT_TYPES = ['liveboard', 'answer'] as const;
const DEFAULT_ACTIVITY_DAYS = 90;
const MAX_ACTIVITY_DAYS = 365;

export const THOUGHTSPOT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_recent_activity',
      description:
        "Liveboards and answers this user opened recently on their ThoughtSpot cluster, most recent first, with per-user last_accessed, global views and is_favorite. Use it to learn what they actually work with.",
      parameters: {
        type: 'object',
        properties: {
          days: num(`look back this many days, default ${DEFAULT_ACTIVITY_DAYS}`),
          limit: num('max objects, default 30'),
          types: { type: 'array', items: { type: 'string', enum: [...OBJECT_TYPES] }, description: 'default both' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_favorites',
      description: "The user's favourite liveboards and answers on their ThoughtSpot cluster, in the order they arranged them.",
      parameters: {
        type: 'object',
        properties: { types: { type: 'array', items: { type: 'string', enum: [...OBJECT_TYPES] } } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_thoughtspot',
      description: 'Find liveboards and answers on the cluster by name. Use when the user names something you have not seen in activity or favourites.',
      parameters: {
        type: 'object',
        properties: {
          query: str('part of the name; empty lists the most recently modified'),
          types: { type: 'array', items: { type: 'string', enum: [...OBJECT_TYPES] } },
          limit: num('max results, default 30')
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  }
];

const TypesArg = z.array(z.enum(OBJECT_TYPES)).min(1).optional();
const ActivityArgs = z.object({
  days: z.number().int().min(1).max(MAX_ACTIVITY_DAYS).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  types: TypesArg
});
const FavoritesArgs = z.object({ types: TypesArg });
const SearchArgs = z.object({ query: z.string().max(200), types: TypesArg, limit: z.number().int().min(1).max(100).optional() });

async function thoughtSpotTool(name: string, raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const ts = ctx.thoughtSpot;
  if (!ts) return fail('this user is not signed in to a ThoughtSpot cluster, so cluster tools are unavailable');
  try {
    if (name === 'list_recent_activity') {
      const args = ActivityArgs.safeParse(raw ?? {});
      if (!args.success) return fail('invalid arguments for list_recent_activity');
      const objects = await ts.recentActivity(args.data.days ?? DEFAULT_ACTIVITY_DAYS, args.data.limit, args.data.types);
      return { result: { cluster: ts.host, days: args.data.days ?? DEFAULT_ACTIVITY_DAYS, objects }, changed: false };
    }
    if (name === 'list_favorites') {
      const args = FavoritesArgs.safeParse(raw ?? {});
      if (!args.success) return fail('invalid arguments for list_favorites');
      return { result: { cluster: ts.host, objects: await ts.favorites(args.data.types) }, changed: false };
    }
    const args = SearchArgs.safeParse(raw ?? {});
    if (!args.success) return fail('invalid arguments for search_thoughtspot');
    return { result: { cluster: ts.host, objects: await ts.search(args.data.query, args.data.types, args.data.limit) }, changed: false };
  } catch (error) {
    if (error instanceof ThoughtSpotError) return fail(error.message);
    throw error;
  }
}

export function toolsFor(ctx: ToolContext): ToolDefinition[] {
  return ctx.thoughtSpot ? [...TOOLS, ...THOUGHTSPOT_TOOLS] : TOOLS;
}

export async function applyTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (name === 'list_recent_activity' || name === 'list_favorites' || name === 'search_thoughtspot') {
    return thoughtSpotTool(name, args, ctx);
  }
  switch (name) {
    case 'get_homepage':
      return { result: summary(ctx), changed: false };
    case 'add_panel':
      return addPanel(ctx, args);
    case 'update_panel':
      return updatePanel(ctx, args);
    case 'remove_panel':
      return removePanel(ctx, args);
    case 'create_group':
      return createGroup(ctx, args);
    case 'update_group':
      return updateGroup(ctx, args);
    case 'remove_group':
      return removeGroup(ctx, args);
    case 'set_theme':
      return setTheme(ctx, args);
    case 'clear_homepage':
      return clearHomepage(ctx);
    default:
      return fail(`unknown tool ${name}`);
  }
}
