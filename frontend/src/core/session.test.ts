import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchMe: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

vi.mock('./api', () => ({
  ...api,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

import { ApiError } from './api';
import { useSession } from './session';

const user = { id: 'u1', name: 'alice', displayName: 'Alice' };

beforeEach(() => {
  useSession.setState({ status: 'loading', user: null, error: null });
  api.fetchMe.mockReset();
  api.signIn.mockReset();
  api.signOut.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('session store', () => {
  it('bootstraps to signed-in or anonymous', async () => {
    api.fetchMe.mockResolvedValueOnce(user);
    await useSession.getState().bootstrap();
    expect(useSession.getState()).toMatchObject({ status: 'signed-in', user });

    api.fetchMe.mockResolvedValueOnce(null);
    await useSession.getState().bootstrap();
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', user: null, error: null });
  });

  it('reports an unreachable API on bootstrap', async () => {
    api.fetchMe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await useSession.getState().bootstrap();
    expect(useSession.getState().error).toContain('not reachable');
  });

  it('signs in, surfaces API messages on failure, and signs out even if the server call fails', async () => {
    const creds = { clusterUrl: 'my.thoughtspot.cloud', username: 'alice', password: 'pw' };
    api.signIn.mockResolvedValueOnce(user);
    expect(await useSession.getState().signIn(creds)).toBe(true);
    expect(api.signIn).toHaveBeenCalledWith(creds);
    expect(useSession.getState().status).toBe('signed-in');

    api.signIn.mockRejectedValueOnce(new ApiError(401, 'That username or password was not accepted by the cluster.'));
    expect(await useSession.getState().signIn(creds)).toBe(false);
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', error: 'That username or password was not accepted by the cluster.' });

    api.signOut.mockRejectedValueOnce(new Error('offline'));
    await useSession.getState().signOut();
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', user: null, error: null });
  });
});
