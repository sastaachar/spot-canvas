import { describe, expect, it } from 'vitest';
import { PluginManifestSchema, definePlugin, isSpotCanvasPlugin, type PluginManifestInput } from './index';

const valid: PluginManifestInput = {
  apiVersion: 1,
  id: 'acme.hello',
  name: 'Hello',
  kind: 'widget',
  version: '0.1.0',
  size: [240, 160]
};

describe('PluginManifestSchema', () => {
  it('accepts a minimal manifest and defaults permissions', () => {
    const parsed = PluginManifestSchema.parse(valid);
    expect(parsed.permissions).toEqual([]);
  });

  it('requires the supported api version', () => {
    expect(PluginManifestSchema.safeParse({ ...valid, apiVersion: 2 }).success).toBe(false);
    const { apiVersion: _omitted, ...withoutVersion } = valid;
    expect(PluginManifestSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it('rejects an id that is not dotted lowercase', () => {
    expect(PluginManifestSchema.safeParse({ ...valid, id: 'Hello' }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({ ...valid, id: 'hello' }).success).toBe(false);
  });

  it('rejects a panel smaller than the minimum', () => {
    expect(PluginManifestSchema.safeParse({ ...valid, size: [100, 100] }).success).toBe(false);
  });

  it('rejects an unknown permission', () => {
    expect(PluginManifestSchema.safeParse({ ...valid, permissions: ['fs'] }).success).toBe(false);
  });
});

describe('definePlugin', () => {
  it('returns the plugin with a parsed manifest', () => {
    const plugin = definePlugin({ manifest: valid, mount() {} });
    expect(plugin.manifest.permissions).toEqual([]);
    expect(isSpotCanvasPlugin(plugin)).toBe(true);
  });

  it('throws on an invalid manifest', () => {
    expect(() => definePlugin({ manifest: { ...valid, version: 'x' }, mount() {} })).toThrow();
  });
});

describe('isSpotCanvasPlugin', () => {
  it('rejects non-plugins', () => {
    expect(isSpotCanvasPlugin(null)).toBe(false);
    expect(isSpotCanvasPlugin({ manifest: valid })).toBe(false);
    expect(isSpotCanvasPlugin({ mount() {} })).toBe(false);
  });
});
