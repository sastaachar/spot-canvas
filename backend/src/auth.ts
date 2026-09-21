import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config, Identity } from './config.ts';

export interface Authenticator {
  authenticate(token: string): Promise<Identity | null>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class UpstreamError extends Error {
  override name = 'UpstreamError';
}

const SESSION_USER_PATH = '/api/rest/2.0/auth/session/user';

const SessionUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().optional()
});

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function tokensEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function devAuthenticator(users: Map<string, Identity>): Authenticator {
  return {
    async authenticate(token) {
      let match: Identity | null = null;
      for (const [known, identity] of users) {
        if (tokensEqual(known, token)) match = identity;
      }
      return match;
    }
  };
}

export function thoughtSpotAuthenticator(host: string, fetchImpl: FetchLike = fetch): Authenticator {
  const endpoint = new URL(SESSION_USER_PATH, host).toString();
  return {
    async authenticate(token) {
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
      } catch {
        throw new UpstreamError('ThoughtSpot is unreachable');
      }
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new UpstreamError(`ThoughtSpot answered ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new UpstreamError('ThoughtSpot returned a non-JSON session payload');
      }
      const parsed = SessionUserSchema.safeParse(body);
      if (!parsed.success) throw new UpstreamError('ThoughtSpot returned an unexpected session payload');
      return {
        id: parsed.data.id,
        name: parsed.data.name,
        displayName: parsed.data.display_name ?? parsed.data.name
      };
    }
  };
}

export function chain(...authenticators: Authenticator[]): Authenticator {
  return {
    async authenticate(token) {
      for (const a of authenticators) {
        const identity = await a.authenticate(token);
        if (identity) return identity;
      }
      return null;
    }
  };
}

export function authenticatorFor(config: Config, fetchImpl?: FetchLike): Authenticator {
  const list: Authenticator[] = [];
  if (config.devUsers.size > 0) list.push(devAuthenticator(config.devUsers));
  if (config.thoughtSpotHost) list.push(thoughtSpotAuthenticator(config.thoughtSpotHost, fetchImpl));
  return chain(...list);
}
