import { z } from 'zod';

export const API_VERSION = 1;

export const PluginKindSchema = z.enum(['workflow', 'embed', 'widget']);
export const PluginPermissionSchema = z.enum(['storage', 'events', 'network']);

export const MIN_PANEL_WIDTH = 200;
export const MIN_PANEL_HEIGHT = 120;

export const PluginManifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'id must be dotted lowercase, e.g. acme.hello'),
  name: z.string().min(1).max(40),
  kind: PluginKindSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  size: z.tuple([z.number().int().min(MIN_PANEL_WIDTH), z.number().int().min(MIN_PANEL_HEIGHT)]),
  permissions: z.array(PluginPermissionSchema).default([])
});

export type PluginKind = z.infer<typeof PluginKindSchema>;
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;

export type HostKind = 'desktop' | 'web';
export type ThemeName = 'light' | 'dark';
export type NotifyKind = 'info' | 'success' | 'error';

export type EventHandler = (payload: unknown, from: string) => void;

export interface PluginApi {
  host: { kind: HostKind };
  storage: {
    get<T>(): T | null;
    set<T>(value: T): void;
  };
  events: {
    emit(name: string, payload?: unknown): void;
    on(name: string, handler: EventHandler): () => void;
  };
  net: {
    fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  };
  ui: {
    resize(width: number, height: number): void;
    close(): void;
    style(css: string): void;
    setTitle(title: string | null): void;
    notify(message: string, kind?: NotifyKind): void;
  };
  theme: {
    get(): ThemeName;
    onChange(handler: (theme: ThemeName) => void): () => void;
  };
  onUnmount(fn: () => void): void;
}

export type Unmount = () => void;

export interface SpotCanvasPlugin {
  manifest: PluginManifest;
  mount(host: HTMLElement, api: PluginApi): void | Unmount;
}

export interface SpotCanvasPluginInput {
  manifest: PluginManifestInput;
  mount(host: HTMLElement, api: PluginApi): void | Unmount;
}

export function definePlugin(plugin: SpotCanvasPluginInput): SpotCanvasPlugin {
  return { manifest: PluginManifestSchema.parse(plugin.manifest), mount: plugin.mount };
}

export function isSpotCanvasPlugin(value: unknown): value is SpotCanvasPlugin {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SpotCanvasPlugin>;
  return typeof candidate.mount === 'function' && PluginManifestSchema.safeParse(candidate.manifest).success;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
