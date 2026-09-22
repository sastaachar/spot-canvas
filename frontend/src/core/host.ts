import type {
  EventHandler,
  HostKind,
  NotifyKind,
  PluginApi,
  PluginCommand,
  PluginManifest,
  PluginPermission,
  SuiteSettings,
  ThemeName
} from '@spot-canvas/sdk';

export class PluginPermissionError extends Error {
  constructor(pluginId: string, permission: PluginPermission) {
    super(`${pluginId} used "${permission}" without declaring it in manifest.permissions`);
    this.name = 'PluginPermissionError';
  }
}

export type PluginFault = (iid: string, phase: string, error: unknown) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly onFault: PluginFault = () => {}) {}

  emit(name: string, payload: unknown, from: string): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        handler(payload, from);
      } catch (error) {
        this.onFault(from, `events:${name}`, error);
      }
    }
  }

  on(name: string, handler: EventHandler): () => void {
    const set = this.handlers.get(name) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(name);
    };
  }

  count(name: string): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}

export type StyleRoot = ShadowRoot | Document;

export interface HostDeps {
  hostKind: HostKind;
  bus: EventBus;
  styleRoot: StyleRoot;
  getData(iid: string): unknown;
  setData(iid: string, data: unknown): void;
  resize(iid: string, w: number, h: number): void;
  close(iid: string): void;
  setTitle(iid: string, title: string | null): void;
  setCommands(iid: string, commands: PluginCommand[]): void;
  openMenu(iid: string, x: number, y: number): void;
  notify(message: string, kind: NotifyKind, from: string): void;
  theme(): ThemeName;
  onThemeChange(handler: (theme: ThemeName) => void): () => void;
  getSettings?(): SuiteSettings;
  fetch?: typeof fetch;
}

export interface PluginHandle {
  api: PluginApi;
  dispose(): void;
}

const STYLE_ATTR = 'data-spot-canvas-plugin';
const MAX_TITLE = 60;

export function ensurePluginStyle(pluginId: string, css: string, root: StyleRoot): void {
  const parent = root instanceof Document ? root.head : root;
  if (parent.querySelector(`style[${STYLE_ATTR}="${pluginId}"]`)) return;
  const style = parent.ownerDocument.createElement('style');
  style.setAttribute(STYLE_ATTR, pluginId);
  style.textContent = css;
  parent.append(style);
}

function assertSerialisable(value: unknown): void {
  try {
    structuredClone(value);
  } catch {
    throw new TypeError('storage.set() only accepts plain JSON-like data');
  }
}

function assertHttpUrl(input: string | URL): URL {
  const url = new URL(String(input));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('net.fetch() only accepts http and https URLs');
  }
  return url;
}

export function createPluginApi(iid: string, manifest: PluginManifest, deps: HostDeps): PluginHandle {
  const granted = new Set(manifest.permissions);
  const cleanups: Array<() => void> = [];
  let disposed = false;

  const require = (permission: PluginPermission) => {
    if (!granted.has(permission)) throw new PluginPermissionError(manifest.id, permission);
  };

  const track = (off: () => void) => {
    cleanups.push(off);
    return off;
  };

  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));

  const api: PluginApi = {
    host: { kind: deps.hostKind },
    storage: {
      get<T>() {
        require('storage');
        return deps.getData(iid) as T | null;
      },
      set<T>(value: T) {
        require('storage');
        assertSerialisable(value);
        deps.setData(iid, value);
      }
    },
    events: {
      emit(name, payload) {
        require('events');
        deps.bus.emit(name, payload, iid);
      },
      on(name, handler) {
        require('events');
        return track(deps.bus.on(name, handler));
      }
    },
    net: {
      fetch(input, init) {
        require('network');
        return doFetch(assertHttpUrl(input), init);
      }
    },
    ui: {
      resize(w, h) {
        deps.resize(iid, w, h);
      },
      close() {
        deps.close(iid);
      },
      style(css) {
        ensurePluginStyle(manifest.id, css, deps.styleRoot);
      },
      setTitle(title) {
        deps.setTitle(iid, title === null ? null : title.trim().slice(0, MAX_TITLE) || null);
      },
      setCommands(commands) {
        deps.setCommands(iid, Array.isArray(commands) ? commands : []);
      },
      openMenu(x, y) {
        deps.openMenu(iid, x, y);
      },
      notify(message, kind = 'info') {
        deps.notify(message, kind, iid);
      }
    },
    theme: {
      get: () => deps.theme(),
      onChange(handler) {
        return track(deps.onThemeChange(handler));
      }
    },
    settings: {
      get: () => Object.freeze({ ...(deps.getSettings?.() ?? {}) })
    },
    onUnmount(fn) {
      cleanups.push(fn);
    }
  };

  return {
    api,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch {
          // a plugin's cleanup must never take down the canvas
        }
      }
    }
  };
}
