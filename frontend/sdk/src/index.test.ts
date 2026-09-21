import { describe, expect, it } from 'vitest';
import {
  PluginManifestSchema,
  SuiteManifestSchema,
  definePlugin,
  defineSuite,
  isSpotCanvasPlugin,
  isSpotCanvasSuite,
  missingRequiredSettings,
  type PluginManifestInput
} from './index';

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

describe('suites', () => {
  const plugin = definePlugin({ manifest: valid, mount() {} });
  const manifest = { apiVersion: 1 as const, id: 'acme.suite', name: 'Acme', version: '1.0.0' };

  it('validates the manifest, defaults settings, and enforces select options and unique keys', () => {
    expect(SuiteManifestSchema.parse(manifest).settings).toEqual([]);
    const field = { key: 'host', label: 'Host' };
    expect(SuiteManifestSchema.parse({ ...manifest, settings: [field] }).settings[0]).toMatchObject({ type: 'text', required: false });
    expect(SuiteManifestSchema.safeParse({ ...manifest, settings: [{ ...field, type: 'select' }] }).success).toBe(false);
    expect(SuiteManifestSchema.safeParse({ ...manifest, settings: [field, field] }).success).toBe(false);
    expect(SuiteManifestSchema.safeParse({ ...manifest, settings: [{ ...field, key: '1bad' }] }).success).toBe(false);
    expect(SuiteManifestSchema.safeParse({ ...manifest, id: 'Acme' }).success).toBe(false);
  });

  it('defineSuite needs at least one distinct plugin and an optional setup function', () => {
    const suite = defineSuite({ manifest, plugins: [plugin] });
    expect(suite.setup).toBeUndefined();
    expect(isSpotCanvasSuite(suite)).toBe(true);
    const setup = () => {};
    expect(defineSuite({ manifest, plugins: [plugin], setup }).setup).toBe(setup);
    expect(() => defineSuite({ manifest, plugins: [] })).toThrow(/at least one/);
    expect(() => defineSuite({ manifest, plugins: [plugin, plugin] })).toThrow(/twice/);
    expect(() => defineSuite({ manifest, plugins: [{} as never] })).toThrow(/not a plugin/);
    expect(() => defineSuite({ manifest, plugins: [plugin], setup: 'nope' as never })).toThrow(/function/);
  });

  it('isSpotCanvasSuite rejects near misses', () => {
    expect(isSpotCanvasSuite(null)).toBe(false);
    expect(isSpotCanvasSuite({ manifest, plugins: [] })).toBe(false);
    expect(isSpotCanvasSuite({ manifest, plugins: [{}] })).toBe(false);
    expect(isSpotCanvasSuite({ manifest, plugins: [plugin], setup: 1 })).toBe(false);
    expect(isSpotCanvasSuite(plugin)).toBe(false);
  });

  it('missingRequiredSettings treats blanks as missing', () => {
    const m = SuiteManifestSchema.parse({
      ...manifest,
      settings: [
        { key: 'host', label: 'Host', required: true },
        { key: 'flag', label: 'Flag', type: 'boolean', required: true },
        { key: 'opt', label: 'Opt' }
      ]
    });
    expect(missingRequiredSettings(m, {}).map((f) => f.key)).toEqual(['host', 'flag']);
    expect(missingRequiredSettings(m, { host: '  ', flag: false }).map((f) => f.key)).toEqual(['host']);
    expect(missingRequiredSettings(m, { host: 'x', flag: false })).toEqual([]);
  });
});
