import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const devUsers = JSON.stringify([{ token: 'dev-alice-token', id: 'alice', name: 'alice' }]);

describe('loadConfig', () => {
  it('refuses to start without any authenticator', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('applies defaults and parses dev users', () => {
    const config = loadConfig({ DEV_USERS: devUsers });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      frontendOrigin: 'http://localhost:5173',
      thoughtSpotHost: null,
      dataDir: 'data',
      cookieSecure: true,
      allowLocalClusters: false
    });
    expect(loadConfig({ DEV_USERS: devUsers, ALLOW_LOCAL_CLUSTERS: 'true' }).allowLocalClusters).toBe(true);
    expect(config.devUsers.get('dev-alice-token')).toEqual({ id: 'alice', name: 'alice', displayName: 'alice' });
  });

  it('reads overrides', () => {
    const config = loadConfig({
      THOUGHTSPOT_HOST: 'https://ts.example.com/some/path',
      PORT: '9000',
      HOST: '0.0.0.0',
      COOKIE_SECURE: 'false',
      SESSION_TTL_MS: '1000',
      DATA_DIR: '/tmp/x',
      FRONTEND_ORIGIN: 'https://app.example'
    });
    expect(config).toMatchObject({
      thoughtSpotHost: 'https://ts.example.com',
      port: 9000,
      host: '0.0.0.0',
      cookieSecure: false,
      sessionTtlMs: 1000,
      dataDir: '/tmp/x',
      frontendOrigin: 'https://app.example'
    });
  });

  it('accepts a default dev user only when it is one of the dev users', () => {
    expect(loadConfig({ DEV_USERS: devUsers, DEV_DEFAULT_USER: 'alice' }).devDefaultUserId).toBe('alice');
    expect(loadConfig({ DEV_USERS: devUsers }).devDefaultUserId).toBeNull();
    expect(() => loadConfig({ DEV_USERS: devUsers, DEV_DEFAULT_USER: 'zed' })).toThrow(/DEV_DEFAULT_USER/);
  });

  it('parses the LLM gateway only when both key and url are present', () => {
    expect(loadConfig({ DEV_USERS: devUsers }).gateway).toBeNull();
    expect(loadConfig({ DEV_USERS: devUsers, API_GATEWAY_KEY: 'k', LLM_GATEWAY_URL: 'https://llm.example/v1/' }).gateway).toEqual({
      url: 'https://llm.example/v1',
      key: 'k',
      model: 'kimi-k3'
    });
    expect(loadConfig({ DEV_USERS: devUsers, API_GATEWAY_KEY: 'k', LLM_GATEWAY_URL: 'https://llm.example/v1', LLM_MODEL: 'other' }).gateway?.model).toBe('other');
    expect(() => loadConfig({ DEV_USERS: devUsers, API_GATEWAY_KEY: 'k' })).toThrow(/LLM_GATEWAY_URL/);
    expect(() => loadConfig({ DEV_USERS: devUsers, LLM_GATEWAY_URL: 'https://llm.example' })).toThrow(/API_GATEWAY_KEY/);
    expect(() => loadConfig({ DEV_USERS: devUsers, API_GATEWAY_KEY: 'k', LLM_GATEWAY_URL: 'http://llm.example' })).toThrow(/https/);
    expect(() => loadConfig({ DEV_USERS: devUsers, API_GATEWAY_KEY: 'k', LLM_GATEWAY_URL: 'nope' })).toThrow(/URL/);
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ THOUGHTSPOT_HOST: 'http://insecure.example' })).toThrow(/https/);
    expect(() => loadConfig({ THOUGHTSPOT_HOST: 'not a url' })).toThrow(/URL/);
    expect(() => loadConfig({ DEV_USERS: '{bad' })).toThrow(/JSON/);
    expect(() => loadConfig({ DEV_USERS: '[{"token":"short","id":"a","name":"a"}]' })).toThrow(/malformed/);
    expect(() => loadConfig({ DEV_USERS: devUsers, PORT: '70000' })).toThrow(/PORT/);
  });
});
