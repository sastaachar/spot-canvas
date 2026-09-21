import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchMe, remoteLayoutBackend, signIn, signOut } from './api';

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

  it('signIn posts the token as JSON and maps failures to messages', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user }));
    expect(await signIn('tok')).toEqual(user);
    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ token: 'tok' }));
    expect(headers.get('Content-Type')).toBe('application/json');

    fetchMock.mockResolvedValueOnce(reply(401));
    await expect(signIn('bad')).rejects.toThrow(/not accepted/);
    fetchMock.mockResolvedValueOnce(reply(429));
    await expect(signIn('bad')).rejects.toThrow(/Too many/);
    fetchMock.mockResolvedValueOnce(reply(502));
    await expect(signIn('bad')).rejects.toMatchObject({ status: 502 });
  });

  it('signOut deletes the session', async () => {
    fetchMock.mockResolvedValueOnce(reply(204));
    await signOut();
    expect(lastCall().init.method).toBe('DELETE');
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
