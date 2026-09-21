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
      frontendOrigin: 'http://localhost:5173',
      thoughtSpotHost: null,
      dataDir: 'data',
      cookieSecure: true
    });
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

  it('rejects bad values', () => {
    expect(() => loadConfig({ THOUGHTSPOT_HOST: 'http://insecure.example' })).toThrow(/https/);
    expect(() => loadConfig({ THOUGHTSPOT_HOST: 'not a url' })).toThrow(/URL/);
    expect(() => loadConfig({ DEV_USERS: '{bad' })).toThrow(/JSON/);
    expect(() => loadConfig({ DEV_USERS: '[{"token":"short","id":"a","name":"a"}]' })).toThrow(/malformed/);
    expect(() => loadConfig({ DEV_USERS: devUsers, PORT: '70000' })).toThrow(/PORT/);
  });
});
