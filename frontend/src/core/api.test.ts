import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createToken, fetchMe, listTokens, publishCatalogue, remoteLayoutBackend, revokeTokens, sendChat, signIn, signOut } from './api';

const user = { id: 'u1', name: 'alice', displayName: 'Alice' };
const fetchMock = vi.fn();

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Headers };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('always sends the CSRF header and cookies', async () => {
    fetchMock.mockResolvedValue(reply(200, { user }));
    await fetchMe();
    const { url, init, headers } = lastCall();
    expect(url).toBe('/api/me');
    expect(init.credentials).toBe('include');
    expect(headers.get('X-Requested-With')).toBe('SpotCanvas');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('fetchMe returns the user, null for 401, and throws otherwise', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user }));
    expect(await fetchMe()).toEqual(user);
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'unauthenticated' }));
    expect(await fetchMe()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(500, { error: 'internal_error' }));
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError);
  });

  it('signIn posts the credentials as JSON and maps failures to messages', async () => {
    const creds = { clusterUrl: 'my.thoughtspot.cloud', username: 'jdoe', password: 'pw' };
    fetchMock.mockResolvedValueOnce(reply(200, { user }));
    expect(await signIn(creds)).toEqual(user);
    const { url, init, headers } = lastCall();
    expect(url).toBe('/api/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(creds));
    expect(headers.get('Content-Type')).toBe('application/json');

    fetchMock.mockResolvedValueOnce(reply(401));
    await expect(signIn(creds)).rejects.toThrow(/not accepted/);
    fetchMock.mockResolvedValueOnce(reply(400, { error: 'invalid_cluster_url', message: 'The cluster URL must use https.' }));
    await expect(signIn(creds)).rejects.toThrow(/must use https/);
    fetchMock.mockResolvedValueOnce(reply(400, 'garbage'));
    await expect(signIn(creds)).rejects.toThrow(/Check the cluster URL/);
    fetchMock.mockResolvedValueOnce(reply(429));
    await expect(signIn(creds)).rejects.toThrow(/Too many/);
    fetchMock.mockResolvedValueOnce(reply(502));
    await expect(signIn(creds)).rejects.toThrow(/could not be reached/);
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(signIn(creds)).rejects.toMatchObject({ status: 500 });
  });

  it('signOut deletes the session', async () => {
    fetchMock.mockResolvedValueOnce(reply(204));
    await signOut();
    expect(lastCall().url).toBe('/api/logout');
    expect(lastCall().init.method).toBe('POST');
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(signOut()).rejects.toBeInstanceOf(ApiError);
  });

  it('remote layout backend reads raw JSON text and writes it back', async () => {
    fetchMock.mockResolvedValueOnce(reply(204));
    expect(await remoteLayoutBackend.read()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(200, '{"version":1,"panels":[]}'));
    expect(await remoteLayoutBackend.read()).toBe('{"version":1,"panels":[]}');
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(remoteLayoutBackend.read()).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(reply(204));
    await remoteLayoutBackend.write('{"version":1,"panels":[]}');
    expect(lastCall().init).toMatchObject({ method: 'PUT', body: '{"version":1,"panels":[]}' });
    fetchMock.mockResolvedValueOnce(reply(400));
    await expect(remoteLayoutBackend.write('{}')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('sendChat', () => {
  it('posts message, history and catalogue and maps status codes to messages', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { reply: 'ok', changed: false, actions: [] }));
    const catalogue = [{ id: 'a.b', name: 'A', kind: 'widget', size: [200, 120] as [number, number] }];
    expect(await sendChat('hi', [{ role: 'user', content: 'earlier' }], catalogue)).toEqual({ reply: 'ok', changed: false, actions: [] });
    const { url, init } = lastCall();
    expect(url).toBe('/api/chat');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'hi', history: [{ role: 'user', content: 'earlier' }], catalogue });

    for (const [status, pattern] of [[503, /not configured/], [429, /busy/], [502, /reach the model/], [500, /could not answer/]] as const) {
      fetchMock.mockResolvedValueOnce(reply(status));
      await expect(sendChat('x', [], [])).rejects.toThrow(pattern);
    }
  });
});

describe('catalogue and tokens', () => {
  it('publishes the catalogue and manages tokens', async () => {
    fetchMock.mockResolvedValueOnce(reply(204));
    await publishCatalogue([{ id: 'a.b', name: 'A', kind: 'widget', size: [4, 3] }]);
    expect(lastCall()).toMatchObject({ url: '/api/catalogue', init: { method: 'PUT' } });
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(publishCatalogue([])).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(reply(201, { token: 'sc_x', tokens: [{ label: 'MCP', createdAt: 1 }] }));
    expect(await createToken('MCP')).toEqual({ token: 'sc_x', tokens: [{ label: 'MCP', createdAt: 1 }] });
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ label: 'MCP' });
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(createToken('MCP')).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(reply(200, { tokens: [] }));
    expect(await listTokens()).toEqual([]);
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(listTokens()).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(reply(200, { revoked: 2 }));
    expect(await revokeTokens()).toBe(2);
    expect(lastCall().init.method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(revokeTokens()).rejects.toBeInstanceOf(ApiError);
  });
});
