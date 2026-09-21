import { z } from 'zod';

export const API_VERSION = 1;

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const MAX_SETTINGS = 20;

export const PluginKindSchema = z.enum(['workflow', 'embed', 'widget']);
export const PluginPermissionSchema = z.enum(['storage', 'events', 'network']);

export const MIN_PANEL_WIDTH = 200;
export const MIN_PANEL_HEIGHT = 120;

export const PluginManifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  id: z.string().regex(ID_PATTERN, 'id must be dotted lowercase, e.g. acme.hello'),
  name: z.string().min(1).max(40),
  kind: PluginKindSchema,
  version: z.string().regex(SEMVER_PATTERN, 'version must be semver'),
  size: z.tuple([z.number().int().min(MIN_PANEL_WIDTH), z.number().int().min(MIN_PANEL_HEIGHT)]),
  permissions: z.array(PluginPermissionSchema).default([])
});

export type PluginKind = z.infer<typeof PluginKindSchema>;
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;

export const SuiteSettingTypeSchema = z.enum(['text', 'url', 'secret', 'number', 'boolean', 'select']);

export const SuiteSettingFieldSchema = z
  .object({
    key: z.string().regex(SETTING_KEY_PATTERN, 'key must be an identifier, e.g. tsHost'),
    label: z.string().min(1).max(60),
    type: SuiteSettingTypeSchema.default('text'),
    required: z.boolean().default(false),
    help: z.string().max(200).optional(),
    placeholder: z.string().max(100).optional(),
    options: z.array(z.object({ value: z.string().max(100), label: z.string().min(1).max(60) })).min(1).optional()
  })
  .refine((f) => f.type !== 'select' || f.options !== undefined, { message: 'select fields need options' });

export const SuiteManifestSchema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    id: z.string().regex(ID_PATTERN, 'id must be dotted lowercase, e.g. acme.suite'),
    name: z.string().min(1).max(40),
    version: z.string().regex(SEMVER_PATTERN, 'version must be semver'),
    description: z.string().max(200).optional(),
    settings: z.array(SuiteSettingFieldSchema).max(MAX_SETTINGS).default([])
  })
  .refine((m) => new Set(m.settings.map((f) => f.key)).size === m.settings.length, { message: 'setting keys must be unique' });

export type SuiteSettingType = z.infer<typeof SuiteSettingTypeSchema>;
export type SuiteSettingField = z.infer<typeof SuiteSettingFieldSchema>;
export type SuiteManifest = z.infer<typeof SuiteManifestSchema>;
export type SuiteManifestInput = z.input<typeof SuiteManifestSchema>;
export type SuiteSettingValue = string | number | boolean;
export type SuiteSettings = Record<string, SuiteSettingValue>;

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
  settings: {
    get(): Readonly<SuiteSettings>;
  };
  onUnmount(fn: () => void): void;
}

export interface SuiteSetupApi {
  settings: { get(): Readonly<SuiteSettings> };
  complete(settings: SuiteSettings): void;
  cancel(): void;
  ui: { notify(message: string, kind?: NotifyKind): void };
  theme: { get(): ThemeName };
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

export type SuiteSetup = (host: HTMLElement, api: SuiteSetupApi) => void | Unmount;

export interface SpotCanvasSuite {
  manifest: SuiteManifest;
  plugins: SpotCanvasPlugin[];
  setup?: SuiteSetup;
}

export interface SpotCanvasSuiteInput {
  manifest: SuiteManifestInput;
  plugins: SpotCanvasPlugin[];
  setup?: SuiteSetup;
}

export function defineSuite(suite: SpotCanvasSuiteInput): SpotCanvasSuite {
  const manifest = SuiteManifestSchema.parse(suite.manifest);
  if (!Array.isArray(suite.plugins) || suite.plugins.length === 0) {
    throw new TypeError(`suite ${manifest.id} must bundle at least one plugin`);
  }
  const ids = new Set<string>();
  for (const plugin of suite.plugins) {
    if (!isSpotCanvasPlugin(plugin)) throw new TypeError(`suite ${manifest.id} bundles something that is not a plugin`);
    if (ids.has(plugin.manifest.id)) throw new TypeError(`suite ${manifest.id} bundles ${plugin.manifest.id} twice`);
    ids.add(plugin.manifest.id);
  }
  if (suite.setup !== undefined && typeof suite.setup !== 'function') {
    throw new TypeError(`suite ${manifest.id} setup must be a function`);
  }
  return suite.setup ? { manifest, plugins: suite.plugins, setup: suite.setup } : { manifest, plugins: suite.plugins };
}

export function isSpotCanvasSuite(value: unknown): value is SpotCanvasSuite {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SpotCanvasSuite>;
  return (
    SuiteManifestSchema.safeParse(candidate.manifest).success &&
    Array.isArray(candidate.plugins) &&
    candidate.plugins.length > 0 &&
    candidate.plugins.every(isSpotCanvasPlugin) &&
    (candidate.setup === undefined || typeof candidate.setup === 'function')
  );
}

const isBlank = (value: SuiteSettingValue | undefined): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export function missingRequiredSettings(manifest: SuiteManifest, settings: SuiteSettings): SuiteSettingField[] {
  return manifest.settings.filter((field) => field.required && isBlank(settings[field.key]));
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
