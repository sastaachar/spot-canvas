import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, CSRF_VALUE } from './app.ts';
import { devAuthenticator, UpstreamError, type Authenticator } from './auth.ts';
import type { Config, Identity } from './config.ts';
import { LayoutStore } from './layouts.ts';
import { RateLimiter } from './rateLimit.ts';
import { SessionStore } from './sessions.ts';

const ALICE = 'alice-token-12345';
const BOB = 'bob-token-1234567';
const users = new Map<string, Identity>([
  [ALICE, { id: 'u-alice', name: 'alice', displayName: 'Alice' }],
  [BOB, { id: 'u-bob', name: 'bob', displayName: 'Bob' }]
]);

const config: Config = {
  host: '127.0.0.1',
  port: 0,
  frontendOrigin: 'http://localhost:5173',
  thoughtSpotHost: null,
  devUsers: users,
  devDefaultUserId: null,
  dataDir: '',
  sessionTtlMs: 60_000,
  cookieSecure: false,
  gateway: { url: 'https://llm.example/v1', key: 'test-key', model: 'test-model' },
  allowLocalClusters: false
};

const LOGIN_LIMIT = 6;
const flakyAuth: Authenticator = {
  async authenticate(token) {
    if (token === 'upstream-down') throw new UpstreamError('down');
    if (token === 'explode') throw new Error('boom');
    return devAuthenticator(users).authenticate(token);
  }
};

interface Running {
  server: Server;
  base: string;
}

async function start(dir: string, loginLimit: number, overrides: Partial<Config> = {}): Promise<Running> {
  const layouts = new LayoutStore(dir);
  await layouts.init();
  const app = createApp({
    config: { ...config, dataDir: dir, ...overrides },
    auth: flakyAuth,
    sessions: new SessionStore(config.sessionTtlMs),
    layouts,
    limiter: new RateLimiter(1000, 60_000),
    loginLimiter: new RateLimiter(loginLimit, 60_000),
    chatLimiter: new RateLimiter(1000, 60_000),
    gatewayFetch: fakeGateway,
    clusterFetch: fakeCluster,
    log: () => {}
  });
  const server = createServer((req, res) => void app(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` };
}

const stop = (running: Running) => new Promise<void>((resolve) => running.server.close(() => resolve()));

const gatewayScript: Array<(body: { messages: unknown[] }) => unknown> = [];
const fakeGateway = async (_url: string, init?: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init?.body)) as { messages: unknown[]; tools?: unknown[] };
  const next = gatewayScript.shift();
  if (!next) return new Response(JSON.stringify({ choices: [{ message: { content: 'Nothing to do.' } }] }), { status: 200 });
  const out = next(body);
  return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
};

const fakeCluster = async (url: string, init?: RequestInit): Promise<Response> => {
  if (url.includes('/callosum/v1/metadata/list/withstats')) {
    return new Response(
      JSON.stringify({ objects: [{ header: { id: 'lb-9', name: 'Ops board' }, type: 'PINBOARD_ANSWER_BOOK', stats: { lastAccessed: Date.now() } }], isLastBatch: true }),
      { status: 200 }
    );
  }
  if (url.endsWith('/auth/session/login')) {
    const body = JSON.parse(String(init?.body)) as { username: string; password: string };
    if (body.password !== 'right') return new Response('{}', { status: 401 });
    const headers = new Headers();
    headers.append('Set-Cookie', 'JSESSIONID=cluster-session; Path=/; HttpOnly');
    return new Response('{}', { status: 200, headers });
  }
  return new Response(JSON.stringify({ id: 'guid-42', name: 'jdoe', display_name: 'Jane Doe' }), { status: 200 });
};

let main: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spot-canvas-'));
  main = await start(dir, 1000);
  base = main.base;
});

afterAll(async () => {
  await stop(main);
  await rm(dir, { recursive: true, force: true });
});

const csrf = { 'X-Requested-With': CSRF_VALUE };
const json = { 'Content-Type': 'application/json' };

function api(p: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  return fetch(base + p, { ...init, headers });
}

async function login(token: string): Promise<{ res: Response; cookie: string }> {
  const res = await api('/api/session', { method: 'POST', headers: { ...json, ...csrf }, body: JSON.stringify({ token }) });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { res, cookie };
}

const layout = {
  version: 1,
  panels: [{ iid: 'spotcanvas.note#1', pluginId: 'spotcanvas.note', x: 1, y: 2, w: 200, h: 120, z: 1, data: { text: 'hi' } }]
};

describe('public surface', () => {
  it('answers health with hardening headers', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('rejects unauthenticated access to user routes', async () => {
    expect((await api('/api/me')).status).toBe(401);
    expect((await api('/api/layout')).status).toBe(401);
    expect((await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: '{}' })).status).toBe(401);
  });

  it('answers 401 for unknown routes until signed in, then 404', async () => {
    expect((await api('/api/nope')).status).toBe(401);
    const { cookie } = await login(ALICE);
    expect((await api('/api/nope', {}, cookie)).status).toBe(404);
  });

  it('handles CORS for the configured origin only', async () => {
    const ok = await api('/api/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const preflight = await api('/api/layout', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(preflight.status).toBe(204);
    const bad = await api('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: 'origin_not_allowed' });
  });
});

describe('sign in', () => {
  it('requires the CSRF header on mutating requests', async () => {
    const res = await api('/api/session', { method: 'POST', headers: json, body: JSON.stringify({ token: ALICE }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'missing_csrf_header' });
  });

  it('rejects malformed bodies', async () => {
    const empty = await api('/api/session', { method: 'POST', headers: { ...json, ...csrf } });
    expect(await empty.json()).toEqual({ error: 'empty_body' });
    const garbage = await api('/api/session', { method: 'POST', headers: { ...json, ...csrf }, body: '{nope' });
    expect(await garbage.json()).toEqual({ error: 'invalid_json' });
    const shape = await api('/api/session', { method: 'POST', headers: { ...json, ...csrf }, body: '{"token":""}' });
    expect(shape.status).toBe(400);
    expect(await shape.json()).toEqual({ error: 'invalid_body' });
  });

  it('rejects an unknown token without leaking why', async () => {
    const { res } = await login('not-a-real-token');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('maps upstream failures to 502 and unexpected errors to 500', async () => {
    const down = await login('upstream-down');
    expect(down.res.status).toBe(502);
    expect(await down.res.json()).toEqual({ error: 'auth_unavailable' });
    const boom = await login('explode');
    expect(boom.res.status).toBe(500);
    expect(await boom.res.json()).toEqual({ error: 'internal_error' });
  });

  it('sets a hardened session cookie and identifies the user', async () => {
    const { res, cookie } = await login(ALICE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: 'u-alice', name: 'alice', displayName: 'Alice', cluster: null } });
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).toContain('Max-Age=60');
    expect(cookie.startsWith('sc_session=')).toBe(true);

    const me = await api('/api/me', {}, cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: { id: 'u-alice', name: 'alice', displayName: 'Alice', cluster: null } });
  });

  it('signs in at /api/login with cluster url, username and password', async () => {
    const res = await api('/api/login', {
      method: 'POST',
      headers: { ...json, ...csrf },
      body: JSON.stringify({ clusterUrl: 'my.thoughtspot.cloud', username: 'jdoe', password: 'right' })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: 'my.thoughtspot.cloud/guid-42', name: 'jdoe', displayName: 'Jane Doe', cluster: 'my.thoughtspot.cloud' } });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const me = await api('/api/me', {}, cookie);
    expect(((await me.json()) as { user: { cluster: string } }).user.cluster).toBe('my.thoughtspot.cloud');

    const wrong = await api('/api/session', {
      method: 'POST',
      headers: { ...json, ...csrf },
      body: JSON.stringify({ clusterUrl: 'my.thoughtspot.cloud', username: 'jdoe', password: 'wrong' })
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invalid_credentials' });

    const local = await api('/api/session', {
      method: 'POST',
      headers: { ...json, ...csrf },
      body: JSON.stringify({ clusterUrl: 'localhost', username: 'jdoe', password: 'right' })
    });
    expect(local.status).toBe(400);
    expect(await local.json()).toMatchObject({ error: 'invalid_cluster_url' });
  });

  it('refreshes the session cookie once the session is past half its life', async () => {
    let now = Date.now();
    const sliding = await start(dir, 1000, {});
    await stop(sliding);
    const layouts = new LayoutStore(dir);
    const sessions = new SessionStore(1000, () => now);
    const app = createApp({
      config: { ...config, dataDir: dir, sessionTtlMs: 1000 },
      auth: flakyAuth,
      sessions,
      layouts,
      limiter: new RateLimiter(1000, 60_000),
      loginLimiter: new RateLimiter(1000, 60_000),
      chatLimiter: new RateLimiter(1000, 60_000),
      log: () => {}
    });
    const server = createServer((req, res) => void app(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const localBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    try {
      const res = await fetch(`${localBase}/api/login`, { method: 'POST', headers: { ...json, ...csrf }, body: JSON.stringify({ token: ALICE }) });
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const early = await fetch(`${localBase}/api/me`, { headers: { Cookie: cookie } });
      expect(early.headers.get('set-cookie')).toBeNull();
      now += 700;
      const late = await fetch(`${localBase}/api/me`, { headers: { Cookie: cookie } });
      expect(late.status).toBe(200);
      expect(late.headers.get('set-cookie')).toContain(cookie);
      now += 900;
      expect((await fetch(`${localBase}/api/me`, { headers: { Cookie: cookie } })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('signs out and invalidates the cookie', async () => {
    const { cookie } = await login(ALICE);
    const out = await api('/api/logout', { method: 'POST', headers: csrf }, cookie);
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await api('/api/me', {}, cookie)).status).toBe(401);
    expect((await api('/api/session', { method: 'DELETE', headers: csrf })).status).toBe(204);
  });
});

describe('layouts', () => {
  it('stores a layout per user and keeps users apart', async () => {
    const alice = (await login(ALICE)).cookie;
    const bob = (await login(BOB)).cookie;

    expect((await api('/api/layout', {}, alice)).status).toBe(204);

    const put = await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: JSON.stringify(layout) }, alice);
    expect(put.status).toBe(204);

    const got = await api('/api/layout', {}, alice);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(layout);

    expect((await api('/api/layout', {}, bob)).status).toBe(204);
  });

  it('stores suite state alongside panels and validates suite urls', async () => {
    const alice = (await login(ALICE)).cookie;
    const withSuites = {
      ...layout,
      suites: { 'acme.suite': { url: 'https://plugins.example.com/acme.js', settings: { host: 'https://x', retries: 3, dark: true }, configured: true } },
      groups: [{ gid: 'group#1', title: 'Sales', x: 0, y: 0, w: 400, h: 300, color: 'amber' }],
      preferences: { theme: 'dark' }
    };
    const put = await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: JSON.stringify(withSuites) }, alice);
    expect(put.status).toBe(204);
    expect(await (await api('/api/layout', {}, alice)).json()).toEqual(withSuites);

    const badColor = { ...layout, groups: [{ gid: 'g', title: '', x: 0, y: 0, w: 1, h: 1, color: 'pink' }] };
    expect((await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: JSON.stringify(badColor) }, alice)).status).toBe(400);

    const insecure = { ...layout, suites: { 'acme.suite': { url: 'http://plugins.example.com/acme.js', settings: {}, configured: false } } };
    const bad = await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: JSON.stringify(insecure) }, alice);
    expect(bad.status).toBe(400);
  });

  it('rejects layouts that fail validation', async () => {
    const alice = (await login(ALICE)).cookie;
    const bad = await api(
      '/api/layout',
      { method: 'PUT', headers: { ...json, ...csrf }, body: JSON.stringify({ version: 2, panels: [] }) },
      alice
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_layout' });
  });

  it('refuses oversized bodies', async () => {
    const alice = (await login(ALICE)).cookie;
    const huge = JSON.stringify({ version: 1, panels: [], pad: 'x'.repeat(300 * 1024) });
    const res = await api('/api/layout', { method: 'PUT', headers: { ...json, ...csrf }, body: huge }, alice);
    expect(res.status).toBe(413);
  });
});

describe('dev default user', () => {
  it('opens a session for the default dev user when none exists, and never without the setting', async () => {
    const auto = await start(dir, 1000, { devDefaultUserId: 'u-bob' });
    try {
      const me = await fetch(`${auto.base}/api/me`);
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({ user: { id: 'u-bob', name: 'bob', displayName: 'Bob', cluster: null } });
      const cookie = (me.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      expect(cookie.startsWith('sc_session=')).toBe(true);
      const again = await fetch(`${auto.base}/api/me`, { headers: { Cookie: cookie } });
      expect(again.headers.get('set-cookie')).toBeNull();
      expect((await fetch(`${auto.base}/api/layout`)).status).toBe(204);
    } finally {
      await stop(auto);
    }
    expect((await api('/api/me')).status).toBe(401);
  });

  it('rejects a default user that is not a dev user', async () => {
    const bad = await start(dir, 1000, { devDefaultUserId: 'u-nobody' });
    try {
      expect((await fetch(`${bad.base}/api/me`)).status).toBe(401);
    } finally {
      await stop(bad);
    }
  });
});

describe('rate limiting', () => {
  it('throttles repeated sign-in attempts from one address', async () => {
    const limited = await start(dir, LOGIN_LIMIT);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < LOGIN_LIMIT + 2; i += 1) {
        const res = await fetch(`${limited.base}/api/session`, {
          method: 'POST',
          headers: { ...json, ...csrf },
          body: JSON.stringify({ token: 'not-a-real-token' })
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, LOGIN_LIMIT).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(LOGIN_LIMIT)).toEqual([429, 429]);
    } finally {
      await stop(limited);
    }
  });
});

describe('chat', () => {
  const catalogue = [{ id: 'spotcanvas.note', name: 'Sticky note', kind: 'widget', size: [220, 160] }];
  const chat = (cookie: string, body: unknown) =>
    api('/api/chat', { method: 'POST', headers: { ...json, ...csrf }, body: JSON.stringify(body) }, cookie);

  it('runs tool calls against the user layout and saves the result', async () => {
    const alice = (await login(BOB)).cookie;
    gatewayScript.push(
      () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'create_group', arguments: JSON.stringify({ title: 'Today' }) } },
                {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'add_panel', arguments: JSON.stringify({ plugin_id: 'spotcanvas.note', group_id: 'group#1', data: { text: 'Standup 9:30' } }) }
                }
              ]
            }
          }
        ]
      }),
      (body) => {
        const tools = body.messages.filter((m) => (m as { role: string }).role === 'tool');
        expect(tools).toHaveLength(2);
        return { choices: [{ message: { content: 'Added a Today group with a note.' } }] };
      }
    );
    const res = await chat(alice, { message: 'add a note for standup', catalogue });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { reply: string; changed: boolean; actions: string[]; layout: { panels: unknown[]; groups: unknown[] } };
    expect(out.reply).toBe('Added a Today group with a note.');
    expect(out.changed).toBe(true);
    expect(out.actions).toEqual(['create_group', 'add_panel']);
    expect(out.layout.groups).toHaveLength(1);
    expect(out.layout.panels[0]).toMatchObject({ pluginId: 'spotcanvas.note', groupId: 'group#1', data: { text: 'Standup 9:30' } });

    const saved = await (await api('/api/layout', {}, alice)).json();
    expect(saved).toEqual(out.layout);
  });

  it('gives the agent cluster tools when the session came from a cluster sign-in', async () => {
    const res = await api('/api/session', {
      method: 'POST',
      headers: { ...json, ...csrf },
      body: JSON.stringify({ clusterUrl: 'my.thoughtspot.cloud', username: 'jdoe', password: 'right' })
    });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    gatewayScript.push(
      (body) => {
        const tools = (body as unknown as { tools: Array<{ function: { name: string } }> }).tools.map((t) => t.function.name);
        expect(tools).toContain('list_recent_activity');
        return {
          choices: [{ message: { content: null, tool_calls: [{ id: 'r', type: 'function', function: { name: 'list_recent_activity', arguments: '{}' } }] } }]
        };
      },
      (body) => {
        const last = body.messages.at(-1) as { content: string };
        expect(JSON.parse(last.content).objects[0]).toMatchObject({ id: 'lb-9', name: 'Ops board' });
        return { choices: [{ message: { content: 'You use Ops board most.' } }] };
      }
    );
    const out = await chat(cookie, { message: 'what do I use?' });
    expect(await out.json()).toEqual({ reply: 'You use Ops board most.', changed: false, actions: [] });
  });

  it('answers without changes when the model only talks, and validates the body', async () => {
    const alice = (await login(ALICE)).cookie;
    gatewayScript.push(() => ({ choices: [{ message: { content: 'Hello!' } }] }));
    const res = await chat(alice, { message: 'hi' });
    expect(await res.json()).toEqual({ reply: 'Hello!', changed: false, actions: [] });
    expect((await chat(alice, { message: '' })).status).toBe(400);
    expect((await chat(alice, { message: 'x', catalogue: [{ id: 'a' }] })).status).toBe(400);
  });

  it('maps gateway failures to 502', async () => {
    const alice = (await login(ALICE)).cookie;
    gatewayScript.push(() => new Response('nope', { status: 500 }));
    const res = await chat(alice, { message: 'hi' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'agent_unavailable' });
  });

  it('is disabled without a gateway', async () => {
    const off = await start(dir, 1000, { gateway: null, devDefaultUserId: 'u-alice' });
    try {
      const res = await fetch(`${off.base}/api/chat`, { method: 'POST', headers: { ...json, ...csrf }, body: JSON.stringify({ message: 'hi' }) });
      expect(res.status).toBe(503);
    } finally {
      await stop(off);
    }
  });
});
